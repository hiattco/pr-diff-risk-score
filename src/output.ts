import type { RiskResult } from "./types";

export function formatRiskResultJson(result: RiskResult): string {
  return JSON.stringify(result);
}
