import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectHistorySignals } from "../src/history";
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

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(repo: string, relativePath: string, content: string): void {
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function commit(repo: string, message: string): void {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
}

function tempGitRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pr-risk-history-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  return repo;
}

describe("collectHistorySignals", () => {
  it("Given history is disabled When collecting signals Then it returns an unavailable off summary", async () => {
    const config = mergeConfig({ history: { enabled: false, mode: "off" } });

    const summary = await collectHistorySignals([file({ filename: "src/app.ts" })], config, process.cwd());

    expect(summary).toMatchObject({
      enabled: false,
      available: false,
      mode: "off",
      hotspotFiles: []
    });
  });

  it("Given no git checkout When auto history runs Then it skips without throwing", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pr-risk-no-git-"));
    const config = mergeConfig({ history: { enabled: true, mode: "auto" } });

    const summary = await collectHistorySignals([file({ filename: "src/app.ts" })], config, workspace);

    expect(summary.available).toBe(false);
    expect(summary.skippedReason).toContain("Git history");
  });

  it("Given a hotspot file with spaces When collecting history Then churn and bugfix/revert signals are counted", async () => {
    const repo = tempGitRepo();
    const filename = "src/hot spot.ts";
    write(repo, filename, "export const value = 1;\n");
    commit(repo, "initial");
    write(repo, filename, "export const value = 2;\nexport const second = 2;\n");
    commit(repo, "fix regression in hotspot");
    write(repo, filename, "export const value = 3;\nexport const second = 2;\nexport const third = 3;\n");
    commit(repo, "revert risky hotspot behavior");
    const config = mergeConfig({
      history: {
        enabled: true,
        mode: "local-git",
        recentCommitThreshold: 2,
        churnThreshold: 2,
        bugfixCommitThreshold: 1,
        revertCommitThreshold: 1
      }
    });

    const summary = await collectHistorySignals([file({ filename })], config, repo);

    expect(summary.available).toBe(true);
    expect(summary.hotspotFiles).toHaveLength(1);
    expect(summary.hotspotFiles[0]).toMatchObject({
      filename,
      recentCommits: 3,
      bugfixCommits: 2,
      revertCommits: 1
    });
    expect(summary.hotspotFiles[0]?.recentChurn).toBeGreaterThanOrEqual(2);
    expect(summary.hotspotFiles[0]?.reasons).toEqual(expect.arrayContaining(["hotspot", "high-churn", "bugfix-history", "recent-revert"]));
  });

  it("Given deleted files When collecting history Then it does not crash", async () => {
    const repo = tempGitRepo();
    write(repo, "src/deleted.ts", "export const value = 1;\n");
    commit(repo, "initial");
    fs.rmSync(path.join(repo, "src/deleted.ts"));
    commit(repo, "remove deleted file");
    const config = mergeConfig({ history: { enabled: true, mode: "local-git" } });

    const summary = await collectHistorySignals([file({ filename: "src/deleted.ts", status: "removed" })], config, repo);

    expect(summary.available).toBe(true);
  });
});

describe("scorePullRequest history context", () => {
  it("Given hotspot history When scoring a PR Then history drivers labels and guidance are merged", () => {
    const config = mergeConfig({
      history: {
        enabled: true,
        recentCommitThreshold: 2,
        churnThreshold: 50,
        bugfixCommitThreshold: 1,
        revertCommitThreshold: 1
      }
    });

    const result = scorePullRequest([file({ filename: "src/auth/session.ts" })], config, {
      history: {
        enabled: true,
        available: true,
        mode: "auto",
        lookbackDays: 180,
        hotspotFiles: [
          {
            filename: "src/auth/session.ts",
            recentCommits: 3,
            recentChurn: 80,
            bugfixCommits: 1,
            revertCommits: 1,
            reasons: ["hotspot", "high-churn", "bugfix-history", "recent-revert"]
          }
        ]
      }
    });

    expect(result.history?.available).toBe(true);
    expect(result.drivers.map((driver) => driver.key)).toEqual(expect.arrayContaining(["hotspotTouched", "highChurnTouched", "bugfixHotspotTouched", "recentlyRevertedTouched"]));
    expect(result.recommendedLabels).toEqual(expect.arrayContaining(["risk:hotspot", "needs-regression-test", "needs-owner-context"]));
    expect(result.reviewGuidance).toEqual(expect.arrayContaining(["Review recent changes to hotspot files before approving."]));
  });
});
