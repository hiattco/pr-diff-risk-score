import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { assessArchitecture, mergeArchitectureAssessment } from "./architecture";
import { renderRiskComment } from "./comment";
import { getPullRequestContext, listChangedFiles, updateRiskComment, createRiskComment } from "./github";
import { collectHistorySignals } from "./history";
import { analyzePullRequestWithLlm } from "./llm";
import { mergeConfigWithActionInputs } from "./rules";
import { scorePullRequest } from "./riskScorer";
import { serializeRiskResult } from "./output";
import { resolveJudgeMode } from "./judge";
import type { ArchitectureMode, CommentMode, HistoryMode, PartialRiskConfig } from "./types";

function parseFailThreshold(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
    throw new Error("fail-threshold must be a number from 0 to 10.");
  }
  return parsed;
}

function parseCommentMode(value: string): CommentMode {
  if (value === "update" || value === "new" || value === "off") {
    return value;
  }
  throw new Error("comment-mode must be one of: update, new, off.");
}

function parseHistoryMode(value: string): HistoryMode {
  if (value === "off" || value === "auto" || value === "local-git") {
    return value;
  }
  throw new Error("history-mode must be one of: off, auto, local-git.");
}

function parseArchitectureMode(value: string): ArchitectureMode {
  if (value === "off" || value === "auto" || value === "llm") {
    return value;
  }
  throw new Error("architecture-mode must be one of: off, auto, llm.");
}

function parsePositiveInteger(value: string, inputName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${inputName} must be a positive integer.`);
  }
  return parsed;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function loadConfig(configPath: string): PartialRiskConfig | undefined {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const absolutePath = path.isAbsolute(configPath) ? configPath : path.join(workspace, configPath);

  if (!fs.existsSync(absolutePath)) {
    core.info(`No config file found at ${configPath}; using defaults.`);
    return undefined;
  }

  const loaded = yaml.load(fs.readFileSync(absolutePath, "utf8"));
  if (!loaded || typeof loaded !== "object") {
    return undefined;
  }
  return loaded as PartialRiskConfig;
}

function inputConfig(): PartialRiskConfig {
  const historyModeInput = core.getInput("history-mode");
  const historyDaysInput = core.getInput("history-days");
  const bugfixKeywordsInput = core.getInput("bugfix-keywords");
  const architectureModeInput = core.getInput("architecture-mode");
  const architectureMaxDocCharsInput = core.getInput("architecture-max-doc-chars");

  return {
    history: {
      ...(historyModeInput ? { mode: parseHistoryMode(historyModeInput), enabled: parseHistoryMode(historyModeInput) !== "off" } : {}),
      ...(historyDaysInput ? { lookbackDays: parsePositiveInteger(historyDaysInput, "history-days") } : {}),
      ...(bugfixKeywordsInput ? { bugfixKeywords: parseCsv(bugfixKeywordsInput) } : {})
    },
    architecture: {
      ...(architectureModeInput ? { mode: parseArchitectureMode(architectureModeInput), enabled: parseArchitectureMode(architectureModeInput) !== "off" } : {}),
      ...(architectureMaxDocCharsInput ? { maxDocChars: parsePositiveInteger(architectureMaxDocCharsInput, "architecture-max-doc-chars") } : {})
    }
  };
}

export async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const failThreshold = parseFailThreshold(core.getInput("fail-threshold") || "0");
  const commentMode = parseCommentMode(core.getInput("comment-mode") || "update");
  const judgeModeInput = core.getInput("mode");
  const configPath = core.getInput("config-path") || ".github/pr-risk-score.yml";
  const llmModelOverride = core.getInput("llm-model");

  const octokit = github.getOctokit(token);
  const prContext = getPullRequestContext();
  const loadedConfig = loadConfig(configPath);
  const actionInputConfig = inputConfig();
  const config = mergeConfigWithActionInputs(loadedConfig, actionInputConfig);
  const env = llmModelOverride ? { ...process.env, LLM_MODEL: llmModelOverride } : process.env;
  const judgeMode = resolveJudgeMode(judgeModeInput, config.mode, config);
  const files = await listChangedFiles(octokit, prContext);
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const history = await collectHistorySignals(files, config, workspace);
  if (history.skippedReason) {
    core.warning(history.skippedReason);
  }
  const heuristicResult = scorePullRequest(files, config, { history });
  const architecture = await assessArchitecture(files, config, workspace, env, judgeMode);
  if (architecture.skippedReason) {
    core.warning(architecture.skippedReason);
  }
  const contextualResult = mergeArchitectureAssessment(heuristicResult, architecture, config);
  const result = await analyzePullRequestWithLlm(files, contextualResult, config, judgeMode, env);
  const comment = renderRiskComment(result);
  core.info(`Using judge mode: ${judgeMode}.`);

  core.setOutput("risk-score", String(result.score));
  core.setOutput("slop-score", String(result.slopScore));
  core.setOutput("overall-score", String(result.overallScore));
  core.setOutput("risk-level", result.level);
  core.setOutput("json", serializeRiskResult(result));
  core.setOutput("risk-labels", result.recommendedLabels.join(","));
  core.info(comment);

  if (commentMode === "update") {
    const operation = await updateRiskComment(octokit, prContext, comment);
    core.info(`Risk comment ${operation}.`);
  } else if (commentMode === "new") {
    await createRiskComment(octokit, prContext, comment);
    core.info("Risk comment created.");
  } else {
    core.info("Comment mode is off; skipped PR comment.");
  }

  if (failThreshold > 0 && result.score >= failThreshold) {
    core.setFailed(`PR risk score ${result.score}/10 meets or exceeds fail threshold ${failThreshold}.`);
  }
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
