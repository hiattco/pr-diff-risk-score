export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type CommentMode = "update" | "new" | "off";

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
}

export interface PartialRiskConfig {
  weights?: Partial<ScoreWeights>;
  thresholds?: Partial<RiskThresholds>;
  patterns?: Partial<Record<keyof RiskPatterns, string[]>>;
  reviewers?: Partial<Record<keyof ReviewerMappings, string[]>>;
}

export interface RiskDriver {
  key: string;
  label: string;
  points: number;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  drivers: RiskDriver[];
  reviewerAreas: string[];
  reviewGuidance: string[];
  stats: {
    filesChanged: number;
    totalChanges: number;
    deletedFiles: number;
    testsChanged: boolean;
  };
}
