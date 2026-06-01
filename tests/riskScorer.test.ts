import { describe, expect, it } from "vitest";
import { mergeConfig } from "../src/rules";
import { scorePullRequest } from "../src/riskScorer";
import type { ChangedFile } from "../src/types";

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

describe("scorePullRequest", () => {
  it("keeps small tested PRs low risk", () => {
    const result = scorePullRequest([
      file({ filename: "src/app.ts", additions: 20, deletions: 4 }),
      file({ filename: "tests/app.test.ts", additions: 12, deletions: 2 })
    ]);

    expect(result.score).toBe(1);
    expect(result.level).toBe("Low");
    expect(result.reviewerAreas).toEqual(["codeowners/default"]);
  });

  it("scores migrations without tests as critical risk", () => {
    const result = scorePullRequest([
      file({ filename: "db/migrations/20260531_add_users.sql", additions: 120, deletions: 0 }),
      file({ filename: "src/auth/session.ts", additions: 80, deletions: 30 })
    ]);

    expect(result.score).toBe(10);
    expect(result.level).toBe("Critical");
    expect(result.drivers.map((driver) => driver.key)).toEqual(expect.arrayContaining(["migrationTouched", "sensitiveTouched", "noTestsChanged"]));
    expect(result.reviewerAreas).toEqual(expect.arrayContaining(["backend/security", "backend/database"]));
  });

  it("clamps very large risky PRs at 10", () => {
    const files = Array.from({ length: 35 }, (_, index) =>
      file({
        filename: index === 0 ? "src/security/access.ts" : `src/module-${index}.ts`,
        additions: 100,
        deletions: 20
      })
    );

    const result = scorePullRequest(files);

    expect(result.score).toBe(10);
    expect(result.level).toBe("Critical");
  });

  it("uses configured weights and reviewers", () => {
    const config = mergeConfig({
      weights: {
        noTestsChanged: 1,
        sensitiveTouched: 4
      },
      reviewers: {
        auth: ["security-team"]
      }
    });

    const result = scorePullRequest([file({ filename: "src/auth/login.ts" })], config);

    expect(result.score).toBe(6);
    expect(result.reviewerAreas).toEqual(["security-team"]);
  });

  it("treats exact auth module files as sensitive", () => {
    const result = scorePullRequest([file({ filename: "src/auth.ts" })]);

    expect(result.score).toBe(6);
    expect(result.drivers.map((driver) => driver.key)).toEqual(expect.arrayContaining(["sensitiveTouched", "noTestsChanged"]));
    expect(result.reviewerAreas).toEqual(["backend/security"]);
  });

  it("recognizes test-only PRs", () => {
    const result = scorePullRequest([file({ filename: "tests/riskScorer.test.ts" })]);

    expect(result.score).toBe(1);
    expect(result.reviewerAreas).toEqual(["standard-review"]);
  });
});
