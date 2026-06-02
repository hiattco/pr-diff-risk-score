import { describe, expect, it } from "vitest";
import { serializeRiskResult } from "../src/output";
import { scorePullRequest } from "../src/riskScorer";
import type { ChangedFile, RiskResult } from "../src/types";

function file(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    filename: "src/app.ts",
    status: "modified",
    additions: 10,
    deletions: 5,
    changes: 15,
    ...overrides
  };
}

describe("serializeRiskResult", () => {
  it("serializes full RiskResult fields in stable key order", () => {
    const result = scorePullRequest([
      file({ filename: "public/assets/app.min.css", additions: 80, deletions: 5 }),
      file({ filename: "tests/riskScorer.test.ts" })
    ]) satisfies RiskResult;

    const output = serializeRiskResult(result);
    const parsed = JSON.parse(output);

    expect(parsed.score).toBe(result.score);
    expect(parsed.level).toBe(result.level);
    expect(parsed.drivers).toEqual(result.drivers);
    expect(parsed.reviewerAreas).toEqual(result.reviewerAreas);
    expect(parsed.reviewGuidance).toEqual(result.reviewGuidance);
    expect(parsed.stats).toEqual(result.stats);
    expect(Object.keys(parsed)).toEqual(["score", "level", "drivers", "reviewerAreas", "reviewGuidance", "stats"]);
  });

  it("returns stable json for equivalent data with different insertion order", () => {
    const outOfOrder = {
      level: "Medium",
      stats: {
        testsChanged: false,
        deletedFiles: 1,
        totalChanges: 7,
        filesChanged: 1
      },
      reviewGuidance: ["Check auth and permissions."],
      reviewerAreas: ["backend/security"],
      score: 5,
      drivers: []
    } as RiskResult;

    const output = serializeRiskResult(outOfOrder);
    const parsed = JSON.parse(output);

    expect(parsed.score).toBe(5);
    expect(Object.keys(parsed)).toEqual(["score", "level", "drivers", "reviewerAreas", "reviewGuidance", "stats"]);
  });
});
