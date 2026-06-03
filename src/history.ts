import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import type { ChangedFile, FileHistorySignal, HistoryRiskSummary, RiskConfig } from "./types";

const execFileAsync = promisify(execFile);

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, nocase: true, matchBase: true }));
}

function hasLowExtensionSignal(filename: string): boolean {
  const lastSegment = filename.split("/").pop() ?? filename;
  return !lastSegment.includes(".") || /\.(txt|log|map|snap)$/i.test(lastSegment);
}

function looksGenerated(file: ChangedFile, config: RiskConfig): boolean {
  if (matchesAny(file.filename, config.patterns.generated)) {
    return true;
  }
  return file.additions >= 1000 && hasLowExtensionSignal(file.filename);
}

async function git(workspace: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024
  });
  return result.stdout;
}

async function hasGitHistory(workspace: string): Promise<boolean> {
  try {
    await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
    await git(workspace, ["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function countKeywordMatches(subjects: readonly string[], keywords: readonly string[]): number {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase()).filter((keyword) => keyword.length > 0);
  return subjects.filter((subject) => {
    const lowerSubject = subject.toLowerCase();
    return normalizedKeywords.some((keyword) => lowerSubject.includes(keyword));
  }).length;
}

function countReverts(subjects: readonly string[]): number {
  return subjects.filter((subject) => subject.toLowerCase().includes("revert")).length;
}

function parseHistory(filename: string, output: string, config: RiskConfig): FileHistorySignal | undefined {
  const subjects: string[] = [];
  let recentChurn = 0;
  let lastTouchedSeconds: number | undefined;

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const commit = line.match(/^[0-9a-f]{40}\t(\d+)\t(.+)$/);
    if (commit) {
      const timestamp = Number(commit[1]);
      if (Number.isFinite(timestamp)) {
        lastTouchedSeconds = Math.max(lastTouchedSeconds ?? 0, timestamp);
      }
      subjects.push(commit[2] ?? "");
      continue;
    }

    const numstat = line.split("\t");
    const additions = Number(numstat[0]);
    const deletions = Number(numstat[1]);
    if (Number.isFinite(additions) && Number.isFinite(deletions)) {
      recentChurn += additions + deletions;
    }
  }

  if (subjects.length === 0) {
    return undefined;
  }

  const bugfixCommits = countKeywordMatches(subjects, config.history.bugfixKeywords);
  const revertCommits = countReverts(subjects);
  const reasons: string[] = [];
  if (subjects.length >= config.history.recentCommitThreshold) {
    reasons.push("hotspot");
  }
  if (recentChurn >= config.history.churnThreshold) {
    reasons.push("high-churn");
  }
  if (bugfixCommits >= config.history.bugfixCommitThreshold) {
    reasons.push("bugfix-history");
  }
  if (revertCommits >= config.history.revertCommitThreshold) {
    reasons.push("recent-revert");
  }

  if (reasons.length === 0) {
    return undefined;
  }

  const lastTouchedDaysAgo =
    typeof lastTouchedSeconds === "number" ? Math.max(0, Math.floor((Date.now() / 1000 - lastTouchedSeconds) / 86400)) : undefined;

  return {
    filename,
    recentCommits: subjects.length,
    recentChurn,
    bugfixCommits,
    revertCommits,
    ...(typeof lastTouchedDaysAgo === "number" ? { lastTouchedDaysAgo } : {}),
    reasons
  };
}

export async function collectHistorySignals(files: readonly ChangedFile[], config: RiskConfig, workspace: string): Promise<HistoryRiskSummary> {
  if (!config.history.enabled || config.history.mode === "off") {
    return {
      enabled: false,
      available: false,
      mode: "off",
      lookbackDays: config.history.lookbackDays,
      skippedReason: "History scoring is disabled.",
      hotspotFiles: []
    };
  }

  if (!(await hasGitHistory(workspace))) {
    return {
      enabled: true,
      available: false,
      mode: config.history.mode,
      lookbackDays: config.history.lookbackDays,
      skippedReason: "Git history is not available in the current workspace.",
      hotspotFiles: []
    };
  }

  const since = `${config.history.lookbackDays} days ago`;
  const hotspotFiles: FileHistorySignal[] = [];
  const candidates = files.filter((file) => !looksGenerated(file, config));

  for (const file of candidates) {
    try {
      const output = await git(workspace, ["log", `--since=${since}`, "--format=%H%x09%ct%x09%s", "--numstat", "--", file.filename]);
      const signal = parseHistory(file.filename, output, config);
      if (signal) {
        hotspotFiles.push(signal);
      }
    } catch {
      if (config.history.mode === "local-git") {
        return {
          enabled: true,
          available: false,
          mode: config.history.mode,
          lookbackDays: config.history.lookbackDays,
          skippedReason: `Git history could not be read for ${file.filename}.`,
          hotspotFiles: []
        };
      }
    }
  }

  return {
    enabled: true,
    available: true,
    mode: config.history.mode,
    lookbackDays: config.history.lookbackDays,
    hotspotFiles: hotspotFiles.slice(0, config.history.maxHotspotFilesShown)
  };
}
