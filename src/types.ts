export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type CommentMode = "update" | "new" | "off";

export type JudgeMode = "heuristic" | "llm" | "hybrid";

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
}

export interface PartialRiskConfig {
  weights?: Partial<ScoreWeights>;
  thresholds?: Partial<RiskThresholds>;
  patterns?: Partial<Record<keyof RiskPatterns, string[]>>;
  reviewers?: Partial<Record<keyof ReviewerMappings, string[]>>;
  mode?: JudgeMode;
  llm?: Partial<LlmConfig>;
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
}

export interface LlmAssessment {
  score: number;
  level?: RiskLevel;
  summary?: string;
  reviewGuidance: string[];
  recommendedLabels: string[];
  reviewerAreas: string[];
}
