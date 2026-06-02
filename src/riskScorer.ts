import { minimatch } from "minimatch";
import { clampScore, defaultConfig, riskLevelForScore } from "./rules";
import type { ChangedFile, PullRequestMetadata, RiskConfig, RiskDriver, RiskResult } from "./types";

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, nocase: true, matchBase: true }));
}

function addDriver(drivers: RiskDriver[], key: string, label: string, points: number): void {
  if (points > 0) {
    drivers.push({ key, label, points });
  }
}

function fileCountPoints(count: number, config: RiskConfig): number {
  if (count >= 30) return config.weights.filesChanged30;
  if (count >= 15) return config.weights.filesChanged15;
  if (count >= 5) return config.weights.filesChanged5;
  return 0;
}

function lineCountPoints(count: number, config: RiskConfig): number {
  if (count >= 1500) return config.weights.linesChanged1500;
  if (count >= 700) return config.weights.linesChanged700;
  if (count >= 200) return config.weights.linesChanged200;
  return 0;
}

function deletedFilePoints(count: number, config: RiskConfig): number {
  if (count >= 5) return config.weights.manyDeletedFiles;
  if (count > 0) return config.weights.deletedFiles;
  return 0;
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeMetadata(metadata?: Partial<PullRequestMetadata>): PullRequestMetadata {
  const defaultTitle = "PR metadata not collected";
  const defaultBody = "PR description was not collected for scoring.";

  return {
    title: defaultTitle,
    body: defaultBody,
    authorAssociation: "UNKNOWN",
    labels: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 1,
    ...metadata
  };
}

function isWeakTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase();
  if (trimmed.length <= 8) {
    return true;
  }

  return /^(chore|fix|update|hotfix|wip|feat|test|refactor|bugfix|release)(\s+#?\d+)?$/.test(trimmed);
}

function isVagueBody(body: string): boolean {
  const normalized = body.replace(/\r/g, "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 20) {
    return true;
  }

  return /^(n\/a|none|tbd|todo|wip)$/.test(normalized) || /^(updating|update|chore)$/.test(normalized);
}

function hasExplanation(metadata: PullRequestMetadata): boolean {
  return !isWeakTitle(metadata.title) && !isVagueBody(metadata.body);
}

function buildReviewGuidance(drivers: RiskDriver[], reviewerAreas: string[]): string[] {
  const keys = new Set(drivers.map((driver) => driver.key));
  const guidance: string[] = [];

  if (keys.has("migrationTouched")) {
    guidance.push("Verify migration safety, rollback path, and data compatibility.");
  }
  if (keys.has("sensitiveTouched")) {
    guidance.push("Confirm auth, payment, privacy, or access-control behavior is covered by tests.");
  }
  if (keys.has("configTouched")) {
    guidance.push("Check deployment, CI, dependency, or runtime configuration impacts.");
  }
  if (keys.has("noTestsChanged")) {
    guidance.push("Look for missing test coverage around changed behavior.");
  }
  if (keys.has("generatedTouched")) {
    guidance.push("Confirm generated or bundled files match their source changes.");
  }
  if (keys.has("deletedFiles") || keys.has("manyDeletedFiles")) {
    guidance.push("Check references to deleted files and confirm removal is intentional.");
  }
  if (keys.has("filesChanged") || keys.has("linesChanged")) {
    guidance.push("Review broad changes by subsystem and prioritize the highest-impact paths.");
  }
  if (guidance.length === 0) {
    guidance.push(`Standard review by ${reviewerAreas.join(", ")} should be sufficient.`);
  }

  return guidance;
}

function reviewerAreasForFiles(files: ChangedFile[], config: RiskConfig, testsChanged: boolean): string[] {
  const paths = files.map((file) => file.filename);
  const areas: string[] = [];
  const nonTestFiles = paths.filter((path) => !matchesAny(path, config.patterns.tests));

  if (paths.some((path) => matchesAny(path, config.patterns.auth))) {
    areas.push(...config.reviewers.auth);
  }
  if (paths.some((path) => matchesAny(path, config.patterns.payments))) {
    areas.push(...config.reviewers.payments);
  }
  if (paths.some((path) => matchesAny(path, config.patterns.database))) {
    areas.push(...config.reviewers.database);
  }
  if (paths.some((path) => matchesAny(path, config.patterns.devops))) {
    areas.push(...config.reviewers.devops);
  }
  if (paths.some((path) => matchesAny(path, config.patterns.frontend))) {
    areas.push(...config.reviewers.frontend);
  }
  if (testsChanged && nonTestFiles.length === 0) {
    areas.push(...config.reviewers.testOnly);
  }

  return unique(areas.length > 0 ? areas : config.reviewers.default);
}

export function scorePullRequest(files: ChangedFile[], config: RiskConfig = defaultConfig, metadata?: PullRequestMetadata): RiskResult {
  const prMetadata = normalizeMetadata(metadata);
  const drivers: RiskDriver[] = [];
  const totalChanges = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const deletedFiles = files.filter((file) => file.status === "removed").length;
  const testsChanged = files.some((file) => matchesAny(file.filename, config.patterns.tests));

  addDriver(drivers, "filesChanged", `${files.length} files changed`, fileCountPoints(files.length, config));
  addDriver(drivers, "linesChanged", `${totalChanges} total line changes`, lineCountPoints(totalChanges, config));
  addDriver(drivers, "weakTitle", `PR title is weak (${prMetadata.title})`, config.weights.weakTitle * (isWeakTitle(prMetadata.title) ? 1 : 0));
  addDriver(drivers, "emptyOrVagueDescription", "PR description is empty or vague", config.weights.emptyOrVagueDescription * (isVagueBody(prMetadata.body) ? 1 : 0));
  addDriver(drivers, "manyCommits", `${prMetadata.commits} commits`, config.weights.manyCommits * (prMetadata.commits >= 10 ? 1 : 0));
  addDriver(
    drivers,
    "largeDiffWithoutExplanation",
    "Large diff changed with little explanation",
    config.weights.largeDiffWithoutExplanation * (prMetadata.changedFiles >= 30 && !hasExplanation(prMetadata) ? 1 : 0)
  );

  if (files.some((file) => matchesAny(file.filename, config.patterns.config))) {
    addDriver(drivers, "configTouched", "Configuration or dependency file changed", config.weights.configTouched);
  }
  if (files.some((file) => matchesAny(file.filename, config.patterns.migrations))) {
    addDriver(drivers, "migrationTouched", "Database or migration file changed", config.weights.migrationTouched);
  }
  if (!testsChanged) {
    addDriver(drivers, "noTestsChanged", "No tests changed", config.weights.noTestsChanged);
  }
  if (files.some((file) => matchesAny(file.filename, config.patterns.sensitive))) {
    addDriver(drivers, "sensitiveTouched", "Sensitive auth, payment, privacy, or data area touched", config.weights.sensitiveTouched);
  }
  if (files.some((file) => looksGenerated(file, config))) {
    addDriver(drivers, "generatedTouched", "Generated-looking or bundled files changed", config.weights.generatedTouched);
  }
  addDriver(drivers, deletedFiles >= 5 ? "manyDeletedFiles" : "deletedFiles", `${deletedFiles} files deleted`, deletedFilePoints(deletedFiles, config));

  const score = clampScore(1 + drivers.reduce((sum, driver) => sum + driver.points, 0));
  const reviewerAreas = reviewerAreasForFiles(files, config, testsChanged);

  return {
    score,
    level: riskLevelForScore(score, config),
    drivers,
    reviewerAreas,
    reviewGuidance: buildReviewGuidance(drivers, reviewerAreas),
    stats: {
      filesChanged: files.length,
      totalChanges,
      deletedFiles,
      testsChanged
    }
  };
}
