export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type CommentMode = "update" | "new" | "off";

export type JudgeMode = "heuristic" | "llm" | "hybrid";

export type HistoryMode = "off" | "auto" | "local-git";

export type ArchitectureMode = "off" | "auto" | "llm";

export type ArchitectureSeverity = "minor" | "moderate" | "major" | "critical";

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface ScoreWeights {
  filesChanged5: number;
  filesChanged15: number;
  filesChanged30: number;
  linesChanged200: number;
  linesChanged700: number;
  linesChanged1500: number;
  configTouched: number;
  migrationTouched: number;
  noTestsChanged: number;
  sensitiveTouched: number;
  generatedTouched: number;
  deletedFiles: number;
  manyDeletedFiles: number;
  hotspotTouched: number;
  highChurnTouched: number;
  bugfixHotspotTouched: number;
  recentlyRevertedTouched: number;
  architectureMinorDrift: number;
  architectureModerateDrift: number;
  architectureMajorDrift: number;
  architectureCriticalDrift: number;
}

export interface RiskThresholds {
  lowMax: number;
  mediumMax: number;
  highMax: number;
}

export interface RiskPatterns {
  config: string[];
  tests: string[];
  migrations: string[];
  sensitive: string[];
  auth: string[];
  payments: string[];
  database: string[];
  devops: string[];
  frontend: string[];
  generated: string[];
}

export interface LlmConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  maxDiffChars?: number;
  requireJson?: boolean;
}

export interface HistoryConfig {
  enabled: boolean;
  mode: HistoryMode;
  lookbackDays: number;
  recentCommitThreshold: number;
  churnThreshold: number;
  bugfixCommitThreshold: number;
  revertCommitThreshold: number;
  maxHotspotFilesShown: number;
  bugfixKeywords: string[];
}

export interface FileHistorySignal {
  filename: string;
  recentCommits: number;
  recentChurn: number;
  bugfixCommits: number;
  revertCommits: number;
  lastTouchedDaysAgo?: number;
  reasons: string[];
}

export interface HistoryRiskSummary {
  enabled: boolean;
  available: boolean;
  mode: HistoryMode;
  lookbackDays: number;
  skippedReason?: string;
  hotspotFiles: FileHistorySignal[];
}

export interface ArchitectureDocGroup {
  id: string;
  label?: string;
  paths: string[];
  appliesTo: string[];
}

export interface ArchitectureContextConfig {
  docs: ArchitectureDocGroup[];
}

export interface ArchitectureConfig {
  enabled: boolean;
  mode: ArchitectureMode;
  strict: boolean;
  maxDocChars: number;
  maxDiffChars: number;
  includePrBody: boolean;
  requireMappedDocs: boolean;
  maxFindingsShown: number;
  context: ArchitectureContextConfig;
  severityWeights: Record<ArchitectureSeverity, number>;
}

export interface ArchitectureFinding {
  severity: ArchitectureSeverity;
  docId: string;
  docPath?: string;
  changedFiles: string[];
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ArchitectureAssessment {
  enabled: boolean;
  available: boolean;
  mode: ArchitectureMode;
  skippedReason?: string;
  docsEvaluated: string[];
  changedFilesEvaluated: string[];
  adherenceScore?: number;
  driftRiskScore?: number;
  findings: ArchitectureFinding[];
}

export interface ReviewerMappings {
  auth: string[];
  payments: string[];
  database: string[];
  devops: string[];
  frontend: string[];
  testOnly: string[];
  default: string[];
}

export interface RiskConfig {
  weights: ScoreWeights;
  thresholds: RiskThresholds;
  patterns: RiskPatterns;
  reviewers: ReviewerMappings;
  mode: JudgeMode;
  llm: LlmConfig;
  history: HistoryConfig;
  architecture: ArchitectureConfig;
}

export interface PartialRiskConfig {
  weights?: Partial<ScoreWeights>;
  thresholds?: Partial<RiskThresholds>;
  patterns?: Partial<Record<keyof RiskPatterns, string[]>>;
  reviewers?: Partial<Record<keyof ReviewerMappings, string[]>>;
  mode?: JudgeMode;
  llm?: Partial<LlmConfig>;
  history?: Partial<HistoryConfig>;
  architecture?: Partial<Omit<ArchitectureConfig, "context" | "severityWeights">> & {
    context?: Partial<ArchitectureContextConfig>;
    severityWeights?: Partial<Record<ArchitectureSeverity, number>>;
  };
}

export interface RiskDriver {
  key: string;
  label: string;
  points: number;
}

export interface RiskResult {
  score: number;
  slopScore: number;
  overallScore: number;
  level: RiskLevel;
  drivers: RiskDriver[];
  slopDrivers: RiskDriver[];
  recommendedLabels: string[];
  reviewerAreas: string[];
  reviewGuidance: string[];
  stats: {
    filesChanged: number;
    totalChanges: number;
    deletedFiles: number;
    testsChanged: boolean;
  };
  history?: HistoryRiskSummary;
  architecture?: ArchitectureAssessment;
}

export interface LlmAssessment {
  score: number;
  level?: RiskLevel;
  summary?: string;
  reviewGuidance: string[];
  recommendedLabels: string[];
  reviewerAreas: string[];
}
