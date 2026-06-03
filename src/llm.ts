import * as core from "@actions/core";
import { HttpClient, HttpClientError } from "@actions/http-client";
import { riskLevelForScore } from "./rules";
import type { ChangedFile, JudgeMode, LlmAssessment, RiskConfig, RiskLevel, RiskResult } from "./types";

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type Env = Readonly<Record<string, string | undefined>>;

type ChatMessage = {
  readonly role: "system" | "user";
  readonly content: string;
};

type ChatRequest = {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature: number;
  readonly response_format?: {
    readonly type: "json_object";
  };
};

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function getProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return Reflect.get(value, key);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readRiskLevel(value: unknown): RiskLevel | undefined {
  if (value === "Low" || value === "Medium" || value === "High" || value === "Critical") {
    return value;
  }
  return undefined;
}

function parseScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("LLM JSON response must include an integer score from 1 to 10.");
  }
  return value;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildRequestHeaders(apiKey: string, config: RiskConfig, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  const openRouterHeaders = env.OPENROUTER_HTTP_REFERER || env.OPENROUTER_REFERER;
  const openRouterTitle = env.OPENROUTER_TITLE || env.OPENROUTER_SITE_NAME;
  if (config.llm.provider === "openrouter" && (openRouterHeaders || openRouterTitle)) {
    if (openRouterHeaders) {
      headers["HTTP-Referer"] = openRouterHeaders;
    }
    if (openRouterTitle) {
      headers["X-OpenRouter-Title"] = openRouterTitle;
    }
  }

  return headers;
}

function resolveApiKey(env: Env): string {
  const apiKey = [env.OPENAI_API_KEY, env.OPENROUTER_API_KEY].find((value) => value && value.length > 0);
  if (!apiKey) {
    throw new Error("LLM is enabled but no API key was found. Set OPENAI_API_KEY or OPENROUTER_API_KEY.");
  }
  return apiKey;
}

function resolveBaseUrl(config: RiskConfig, env: Env): string {
  const configured = config.llm.baseUrl ?? env.OPENAI_BASE_URL ?? env.OPENAI_API_BASE_URL ?? env.OPENROUTER_BASE_URL;
  if (configured) {
    return normalizeBaseUrl(configured);
  }
  return config.llm.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
}

function resolveModel(config: RiskConfig, env: Env): string {
  return env.LLM_MODEL ?? config.llm.model ?? "gpt-4o";
}

function changedFileSummary(file: ChangedFile): string {
  const patch = file.patch ? `\n${file.patch}` : "";
  return `File: ${file.filename}\nStatus: ${file.status}\nAdditions: ${file.additions}\nDeletions: ${file.deletions}${patch}`;
}

function buildDiffPrompt(files: readonly ChangedFile[], maxDiffChars: number): string {
  const fullDiff = files.map(changedFileSummary).join("\n\n---\n\n");
  return fullDiff.length > maxDiffChars ? `${fullDiff.slice(0, maxDiffChars)}\n\n[diff truncated]` : fullDiff;
}

function buildChatRequest(files: readonly ChangedFile[], baseline: RiskResult, config: RiskConfig, env: Env): ChatRequest {
  const maxDiffChars = config.llm.maxDiffChars ?? 6000;
  const model = resolveModel(config, env);
  const baseRequest = {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You assess pull request diff risk. Return only JSON with score, level, summary, reviewGuidance, recommendedLabels, and reviewerAreas."
      },
      {
        role: "user",
        content: `Heuristic score: ${baseline.score}/10 (${baseline.level}).\nReview guidance: ${baseline.reviewGuidance.join("; ")}\n\nDiff:\n${buildDiffPrompt(files, maxDiffChars)}`
      }
    ]
  } satisfies Omit<ChatRequest, "response_format">;

  if (config.llm.requireJson ?? true) {
    return {
      ...baseRequest,
      response_format: { type: "json_object" }
    };
  }

  return baseRequest;
}

function parseAssessment(content: string, requireJson: boolean, fallbackScore: number): LlmAssessment {
  if (!requireJson) {
    return {
      score: fallbackScore,
      reviewGuidance: [content],
      recommendedLabels: [],
      reviewerAreas: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("LLM response was not valid JSON.");
    }
    throw error;
  }

  const score = parseScore(getProperty(parsed, "score"));
  const level = readRiskLevel(getProperty(parsed, "level"));
  const summary = getProperty(parsed, "summary");
  const assessment = {
    score,
    reviewGuidance: readStringArray(getProperty(parsed, "reviewGuidance")),
    recommendedLabels: readStringArray(getProperty(parsed, "recommendedLabels")),
    reviewerAreas: readStringArray(getProperty(parsed, "reviewerAreas"))
  } satisfies Omit<LlmAssessment, "level" | "summary">;

  return {
    ...assessment,
    ...(level ? { level } : {}),
    ...(typeof summary === "string" ? { summary } : {})
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(headers: Record<string, string | string[] | undefined> | undefined, attempt: number): number {
  if (!headers) {
    return BASE_RETRY_DELAY_MS * 2 ** attempt;
  }

  const header = headers["retry-after"];
  if (typeof header === "string") {
    const value = Number.parseInt(header, 10);
    if (!Number.isNaN(value) && value > 0) {
      return value * 1000;
    }

    const retryAt = Date.parse(header);
    if (!Number.isNaN(retryAt)) {
      const delay = retryAt - Date.now();
      return delay > 0 ? delay : 0;
    }
  }

  return BASE_RETRY_DELAY_MS * 2 ** attempt;
}

function normalizeHttpClientError(error: unknown): { statusCode?: number; body: string } | undefined {
  if (!(error instanceof HttpClientError)) {
    return undefined;
  }

  if (typeof error.statusCode === "number" && Number.isFinite(error.statusCode) && error.statusCode > 0) {
    return {
      statusCode: error.statusCode,
      body: JSON.stringify(error.result ?? error.message)
    };
  }

  return {
    body: JSON.stringify(error.result ?? error.message)
  };
}

function isRetryableStatus(statusCode: number | undefined): boolean {
  if (typeof statusCode !== "number") {
    return false;
  }
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

function parseChatContent(body: unknown): string {
  const choices = getProperty(body, "choices");
  if (!Array.isArray(choices)) {
    throw new Error("LLM response did not include choices.");
  }

  const firstChoice = choices[0];
  if (!firstChoice) {
    throw new Error("LLM response did not include choices.");
  }

  const content = getProperty(getProperty(firstChoice, "message"), "content");
  if (typeof content !== "string") {
    throw new Error("LLM response did not include message content.");
  }
  return content;
}

function mergeAssessment(baseline: RiskResult, assessment: LlmAssessment, mode: JudgeMode): RiskResult {
  const score = mode === "hybrid" ? Math.max(baseline.score, assessment.score) : assessment.score;
  const level = score === assessment.score ? (assessment.level ?? riskLevelForScore(score)) : riskLevelForScore(score);
  const summaryGuidance = assessment.summary ? [`LLM summary: ${assessment.summary}`] : [];
  const driverPoints = Math.max(1, score - baseline.score);

  return {
    ...baseline,
    score,
    level,
    overallScore: Math.max(score, baseline.slopScore),
    recommendedLabels: unique([...baseline.recommendedLabels, ...assessment.recommendedLabels]),
    reviewerAreas: unique([...baseline.reviewerAreas, ...assessment.reviewerAreas]),
    reviewGuidance: unique([...summaryGuidance, ...assessment.reviewGuidance, ...baseline.reviewGuidance]),
    drivers: [
      ...baseline.drivers,
      {
        key: "llmAssessment",
        label: "LLM diff assessment",
        points: driverPoints
      }
    ]
  };
}

export async function analyzePullRequestWithLlm(
  files: readonly ChangedFile[],
  baseline: RiskResult,
  config: RiskConfig,
  mode: JudgeMode,
  env: Env = process.env
): Promise<RiskResult> {
  if (!config.llm.enabled || mode === "heuristic") {
    return baseline;
  }

  const apiKey = resolveApiKey(env);
  const baseUrl = resolveBaseUrl(config, env);
  const payload = buildChatRequest(files, baseline, config, env);
  const client = new HttpClient("pr-diff-risk-score");

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response;
      try {
        response = await client.postJson<unknown>(`${baseUrl}/chat/completions`, payload, {
          ...buildRequestHeaders(apiKey, config, env)
        });
      } catch (error) {
        const errorContext = normalizeHttpClientError(error);
        const statusCode = errorContext?.statusCode;
        if (isRetryableStatus(statusCode) && attempt < MAX_RETRIES) {
          const retryDelayMs = getRetryDelayMs(undefined, attempt);
          core.warning(`LLM request failed with HTTP ${statusCode}; retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES}).`);
          await sleep(retryDelayMs);
          continue;
        }

        const message = errorContext?.body ?? String(error);
        throw new Error(`LLM request failed with HTTP ${statusCode ?? "unknown"}: ${message}`);
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (isRetryableStatus(response.statusCode) && attempt < MAX_RETRIES) {
          const retryDelayMs = getRetryDelayMs(response.headers, attempt);
          core.warning(
            `LLM request failed with HTTP ${response.statusCode}; retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES}).`
          );
          await sleep(retryDelayMs);
          continue;
        }

        const responseBody = JSON.stringify(response.result ?? "");
        throw new Error(`LLM request failed with HTTP ${response.statusCode}: ${responseBody}`);
      }

      const assessment = parseAssessment(parseChatContent(response.result), config.llm.requireJson ?? true, baseline.score);

      return mergeAssessment(baseline, assessment, mode);
    }
    throw new Error(`LLM request failed after ${MAX_RETRIES + 1} attempts.`);
  } catch (error) {
    if (mode === "hybrid") {
      const message = error instanceof Error ? error.message : String(error);
      core.warning(`LLM analysis failed; using heuristic result. ${message}`);
      return baseline;
    }
    throw error;
  }
}
