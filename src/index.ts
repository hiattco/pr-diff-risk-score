import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { renderRiskComment } from "./comment";
import { getPullRequestContext, listChangedFiles, updateRiskComment, createRiskComment } from "./github";
import { mergeConfig } from "./rules";
import { scorePullRequest } from "./riskScorer";
import type { CommentMode, PartialRiskConfig } from "./types";

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

export async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const failThreshold = parseFailThreshold(core.getInput("fail-threshold") || "0");
  const commentMode = parseCommentMode(core.getInput("comment-mode") || "update");
  const configPath = core.getInput("config-path") || ".github/pr-risk-score.yml";

  const octokit = github.getOctokit(token);
  const prContext = getPullRequestContext();
  const config = mergeConfig(loadConfig(configPath));
  const files = await listChangedFiles(octokit, prContext);
  const result = scorePullRequest(files, config);
  const comment = renderRiskComment(result);

  core.setOutput("risk-score", String(result.score));
  core.setOutput("risk-level", result.level);
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
