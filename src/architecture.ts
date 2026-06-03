import { HttpClient } from "@actions/http-client";
import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { clampScore, riskLevelForScore } from "./rules";
import type {
  ArchitectureAssessment,
  ArchitectureDocGroup,
  ArchitectureFinding,
  ArchitectureMode,
  ArchitectureSeverity,
  ChangedFile,
  JudgeMode,
  RiskConfig,
  RiskDriver,
  RiskResult
} from "./types";

type Env = Readonly<Record<string, string | undefined>>;

type LoadedDoc = {
  readonly group: ArchitectureDocGroup;
  readonly path: string;
  readonly content: string;
  readonly changedFiles: readonly string[];
};

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

function readSeverity(value: unknown): ArchitectureSeverity {
  if (value === "minor" || value === "moderate" || value === "major" || value === "critical") {
    return value;
  }
  return "minor";
}

function readIntegerScore(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`Architecture LLM response must include integer ${name} from 1 to 10.`);
  }
  return value;
}

function matchesAny(filename: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { dot: true, nocase: true, matchBase: true }));
}

function modeUnavailable(mode: ArchitectureMode, reason: string, enabled = true): ArchitectureAssessment {
  return {
    enabled,
    available: false,
    mode,
    skippedReason: reason,
    docsEvaluated: [],
    changedFilesEvaluated: [],
    findings: []
  };
}

function shouldThrow(config: RiskConfig, judgeMode: JudgeMode): boolean {
  return config.architecture.strict && config.architecture.mode === "llm" && judgeMode === "llm";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
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

function resolveApiKey(env: Env): string | undefined {
  return [env.OPENAI_API_KEY, env.OPENROUTER_API_KEY].find((value) => value && value.length > 0);
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function changedFileSummary(file: ChangedFile): string {
  const patch = file.patch ? `\n${file.patch}` : "";
  return `File: ${file.filename}\nStatus: ${file.status}\nAdditions: ${file.additions}\nDeletions: ${file.deletions}${patch}`;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[truncated]` : value;
}

async function readDoc(workspace: string, docPath: string): Promise<string | undefined> {
  const absolutePath = path.join(workspace, docPath);
  const extension = path.extname(docPath).toLowerCase();
  if (extension !== ".md" && extension !== ".mdx" && extension !== ".markdown") {
    return undefined;
  }
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadDocs(files: readonly ChangedFile[], config: RiskConfig, workspace: string): Promise<readonly LoadedDoc[]> {
  const docs: LoadedDoc[] = [];

  for (const group of config.architecture.context.docs) {
    const changedFiles = files.map((file) => file.filename).filter((filename) => matchesAny(filename, group.appliesTo));
    if (changedFiles.length === 0) {
      continue;
    }

    for (const docPath of group.paths) {
      const content = await readDoc(workspace, docPath);
      if (content) {
        docs.push({ group, path: docPath, content, changedFiles });
      }
    }
  }

  return docs;
}

function buildArchitecturePrompt(files: readonly ChangedFile[], docs: readonly LoadedDoc[], config: RiskConfig): string {
  const docContext = docs
    .map((doc) => `Doc ${doc.group.id} (${doc.path}) applies to ${doc.changedFiles.join(", ")}\n${doc.content}`)
    .join("\n\n---\n\n");
  const diff = files.map(changedFileSummary).join("\n\n---\n\n");

  return `Evaluate this PR only against the configured Markdown docs below. Do not invent architecture rules. Return JSON only.\n\nArchitecture docs:\n${truncate(docContext, config.architecture.maxDocChars)}\n\nDiff:\n${truncate(diff, config.architecture.maxDiffChars)}`;
}

function buildChatRequest(files: readonly ChangedFile[], docs: readonly LoadedDoc[], config: RiskConfig, env: Env): ChatRequest {
  const baseRequest = {
    model: resolveModel(config, env),
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You assess architecture adherence for a pull request. Use only provided Markdown docs. Ignore style unless documented. Return JSON with adherenceScore, driftRiskScore, summary, findings, recommendedLabels, reviewGuidance, reviewerAreas."
      },
      {
        role: "user",
        content: buildArchitecturePrompt(files, docs, config)
      }
    ]
  } satisfies Omit<ChatRequest, "response_format">;

  if (config.llm.requireJson ?? true) {
    return { ...baseRequest, response_format: { type: "json_object" } };
  }
  return baseRequest;
}

function parseFinding(value: unknown): ArchitectureFinding | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const title = getProperty(value, "title");
  const evidence = getProperty(value, "evidence");
  const recommendation = getProperty(value, "recommendation");
  const docId = getProperty(value, "docId");
  const docPath = getProperty(value, "docPath");

  if (typeof title !== "string" || typeof evidence !== "string" || typeof recommendation !== "string" || typeof docId !== "string") {
    return undefined;
  }

  return {
    severity: readSeverity(getProperty(value, "severity")),
    docId,
    ...(typeof docPath === "string" ? { docPath } : {}),
    changedFiles: readStringArray(getProperty(value, "changedFiles")),
    title,
    evidence,
    recommendation
  };
}

function parseAssessment(content: string, mode: ArchitectureMode, docs: readonly LoadedDoc[]): ArchitectureAssessment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Architecture LLM response was not valid JSON.");
    }
    throw error;
  }

  const findingsValue = getProperty(parsed, "findings");
  const findings = Array.isArray(findingsValue) ? findingsValue.map(parseFinding).filter((finding): finding is ArchitectureFinding => Boolean(finding)) : [];

  return {
    enabled: true,
    available: true,
    mode,
    docsEvaluated: unique(docs.map((doc) => doc.path)),
    changedFilesEvaluated: unique(docs.flatMap((doc) => doc.changedFiles)),
    adherenceScore: readIntegerScore(getProperty(parsed, "adherenceScore"), "adherenceScore"),
    driftRiskScore: readIntegerScore(getProperty(parsed, "driftRiskScore"), "driftRiskScore"),
    findings
  };
}

async function callArchitectureLlm(files: readonly ChangedFile[], docs: readonly LoadedDoc[], config: RiskConfig, env: Env): Promise<ArchitectureAssessment> {
  const apiKey = resolveApiKey(env);
  if (!apiKey) {
    throw new Error("Architecture scoring requires OPENAI_API_KEY or OPENROUTER_API_KEY.");
  }

  const client = new HttpClient("pr-diff-risk-score");
  const response = await client.postJson<unknown>(
    `${resolveBaseUrl(config, env)}/chat/completions`,
    buildChatRequest(files, docs, config, env),
    requestHeaders(apiKey)
  );
  const content = getProperty(getProperty((getProperty(response.result, "choices") as readonly unknown[] | undefined)?.[0], "message"), "content");
  if (typeof content !== "string") {
    throw new Error("Architecture LLM response did not include message content.");
  }

  return parseAssessment(content, config.architecture.mode, docs);
}

export async function assessArchitecture(files: readonly ChangedFile[], config: RiskConfig, workspace: string, env: Env, judgeMode: JudgeMode): Promise<ArchitectureAssessment> {
  if (!config.architecture.enabled || config.architecture.mode === "off") {
    return modeUnavailable("off", "Architecture scoring is disabled.", false);
  }

  const docs = await loadDocs(files, config, workspace);
  if (docs.length === 0) {
    return modeUnavailable(config.architecture.mode, "No configured architecture docs matched changed files.");
  }

  try {
    return await callArchitectureLlm(files, docs, config, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldThrow(config, judgeMode)) {
      throw error;
    }
    return modeUnavailable(config.architecture.mode, message);
  }
}

function severityRank(severity: ArchitectureSeverity): number {
  const ranks: Record<ArchitectureSeverity, number> = {
    minor: 1,
    moderate: 2,
    major: 3,
    critical: 4
  };
  return ranks[severity];
}

function driverForSeverity(severity: ArchitectureSeverity, config: RiskConfig): RiskDriver {
  const driverKeys: Record<ArchitectureSeverity, string> = {
    minor: "architectureMinorDrift",
    moderate: "architectureModerateDrift",
    major: "architectureMajorDrift",
    critical: "architectureCriticalDrift"
  };
  const labels: Record<ArchitectureSeverity, string> = {
    minor: "Possible minor architecture drift",
    moderate: "Possible moderate architecture drift",
    major: "Possible major architecture drift",
    critical: "Possible critical architecture drift"
  };

  return {
    key: driverKeys[severity],
    label: labels[severity],
    points: config.architecture.severityWeights[severity]
  };
}

export function mergeArchitectureAssessment(baseline: RiskResult, assessment: ArchitectureAssessment, config: RiskConfig): RiskResult {
  if (!assessment.available || assessment.findings.length === 0) {
    return { ...baseline, architecture: assessment };
  }

  const highestSeverity = assessment.findings.reduce<ArchitectureSeverity>((highest, finding) => (severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest), "minor");
  const architectureDriver = driverForSeverity(highestSeverity, config);
  const drivers = [...baseline.drivers, architectureDriver];
  const score = clampScore(baseline.score + architectureDriver.points);
  const level = riskLevelForScore(score, config);
  const moderateOrHigher = severityRank(highestSeverity) >= severityRank("moderate");
  const majorOrHigher = severityRank(highestSeverity) >= severityRank("major");
  const critical = highestSeverity === "critical";

  return {
    ...baseline,
    score,
    level,
    overallScore: Math.max(score, baseline.slopScore),
    drivers,
    recommendedLabels: unique([
      ...baseline.recommendedLabels,
      "architecture-review",
      ...(moderateOrHigher ? ["architecture-drift"] : []),
      ...(majorOrHigher ? ["needs-design-context"] : []),
      ...(critical ? ["review-carefully"] : [])
    ]),
    reviewerAreas: unique([...baseline.reviewerAreas, "architecture"]),
    reviewGuidance: unique([
      ...baseline.reviewGuidance,
      "Check whether the changed files still follow the documented service and dependency boundaries.",
      "Ask the author to update the architecture docs or add an explicit architecture exception if the design intentionally changed.",
      "Verify that Mermaid diagrams and architecture docs remain accurate after this PR."
    ]),
    architecture: assessment
  };
}
