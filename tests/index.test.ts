import { describe, expect, it } from "vitest";
import { formatRiskResultJson } from "../src/output";
import type { RiskResult } from "../src/types";

describe("formatRiskResultJson", () => {
  it("serializes the full risk result", () => {
    const result: RiskResult = {
      score: 4,
      level: "Medium",
      drivers: [{ key: "noTestsChanged", label: "No tests changed", points: 2 }],
      reviewerAreas: ["codeowners/default"],
      reviewGuidance: ["Look for missing test coverage around changed behavior."],
      stats: {
        filesChanged: 2,
        totalChanges: 30,
        deletedFiles: 0,
        testsChanged: false
      }
    };

    expect(formatRiskResultJson(result)).toBe(JSON.stringify(result));
  });
});
