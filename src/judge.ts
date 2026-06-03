import * as core from "@actions/core";
import type { JudgeMode, RiskConfig } from "./types";

export function parseJudgeMode(value: string): JudgeMode {
  if (value === "heuristic" || value === "llm" || value === "hybrid") {
    return value;
  }
  throw new Error("mode must be one of: heuristic, llm, hybrid.");
}

export function resolveJudgeMode(actionModeInput: string, configMode: string, config: RiskConfig): JudgeMode {
  const mode = actionModeInput ? parseJudgeMode(actionModeInput) : parseJudgeMode(configMode);

  if (mode === "heuristic") {
    return mode;
  }

  if (config.llm.enabled) {
    return mode;
  }

  core.warning("judge mode is llm/hybrid but llm is disabled; falling back to heuristic.");
  return "heuristic";
}
