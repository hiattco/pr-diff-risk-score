import type { PartialRiskConfig, RiskConfig, RiskLevel } from "./types";

export const defaultConfig: RiskConfig = {
  weights: {
    filesChanged5: 1,
    filesChanged15: 2,
    filesChanged30: 3,
    linesChanged200: 1,
    linesChanged700: 2,
    linesChanged1500: 3,
    configTouched: 2,
    migrationTouched: 3,
    noTestsChanged: 2,
    sensitiveTouched: 3,
    generatedTouched: 2,
    deletedFiles: 1,
    manyDeletedFiles: 2
  },
  thresholds: {
    lowMax: 3,
    mediumMax: 6,
    highMax: 8
  },
  patterns: {
    config: [
      ".github/workflows/**",
      "Dockerfile",
      "docker-compose.yml",
      "*.yaml",
      "*.yml",
      "*.toml",
      "*.ini",
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "requirements.txt",
      "pyproject.toml"
    ],
    tests: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "tests/**", "test/**"],
    migrations: ["**/migrations/**", "**/migration/**", "**/schema.sql", "**/schema.prisma", "**/db/**", "**/database/**"],
    sensitive: [
      "**/auth.{ts,tsx,js,jsx,mjs,cjs}",
      "**/authentication.{ts,tsx,js,jsx,mjs,cjs}",
      "**/authorization.{ts,tsx,js,jsx,mjs,cjs}",
      "**/middleware.{ts,tsx,js,jsx,mjs,cjs}",
      "**/security.{ts,tsx,js,jsx,mjs,cjs}",
      "**/permissions.{ts,tsx,js,jsx,mjs,cjs}",
      "**/roles.{ts,tsx,js,jsx,mjs,cjs}",
      "**/auth/**",
      "**/authentication/**",
      "**/authorization/**",
      "**/middleware/**",
      "**/security/**",
      "**/permissions/**",
      "**/roles/**",
      "**/payment/**",
      "**/billing/**",
      "**/stripe/**",
      "**/checkout/**",
      "**/data/**",
      "**/privacy/**",
      "**/pii/**"
    ],
    auth: [
      "**/auth.{ts,tsx,js,jsx,mjs,cjs}",
      "**/authentication.{ts,tsx,js,jsx,mjs,cjs}",
      "**/authorization.{ts,tsx,js,jsx,mjs,cjs}",
      "**/middleware.{ts,tsx,js,jsx,mjs,cjs}",
      "**/security.{ts,tsx,js,jsx,mjs,cjs}",
      "**/permissions.{ts,tsx,js,jsx,mjs,cjs}",
      "**/roles.{ts,tsx,js,jsx,mjs,cjs}",
      "**/auth/**",
      "**/authentication/**",
      "**/authorization/**",
      "**/middleware/**",
      "**/security/**",
      "**/permissions/**",
      "**/roles/**"
    ],
    payments: ["**/payment/**", "**/billing/**", "**/stripe/**", "**/checkout/**"],
    database: ["**/migrations/**", "**/migration/**", "**/schema.sql", "**/schema.prisma", "**/db/**", "**/database/**"],
    devops: [".github/workflows/**", "Dockerfile", "docker-compose.yml", "deploy/**", "infra/**", "terraform/**"],
    frontend: ["**/*.tsx", "**/*.jsx", "src/components/**", "app/**", "pages/**", "frontend/**", "web/**"],
    generated: ["dist/**", "build/**", "generated/**", "**/*.generated.*", "**/*.min.{js,css}", "**/*.lock"]
  },
  reviewers: {
    auth: ["backend/security"],
    payments: ["payments"],
    database: ["backend/database"],
    devops: ["devops/platform"],
    frontend: ["frontend"],
    testOnly: ["standard-review"],
    default: ["codeowners/default"]
  },
  mode: "heuristic",
  llm: {
    enabled: false,
    provider: "openai",
    model: undefined,
    maxDiffChars: 6000,
    requireJson: true
  }
};

export function mergeConfig(partial?: PartialRiskConfig): RiskConfig {
  if (!partial) {
    return defaultConfig;
  }

  return {
    weights: { ...defaultConfig.weights, ...partial.weights },
    thresholds: { ...defaultConfig.thresholds, ...partial.thresholds },
    patterns: { ...defaultConfig.patterns, ...partial.patterns },
    reviewers: { ...defaultConfig.reviewers, ...partial.reviewers },
    mode: partial.mode ?? defaultConfig.mode,
    llm: { ...defaultConfig.llm, ...partial.llm }
  };
}

export function riskLevelForScore(score: number, config: RiskConfig = defaultConfig): RiskLevel {
  if (score <= config.thresholds.lowMax) {
    return "Low";
  }
  if (score <= config.thresholds.mediumMax) {
    return "Medium";
  }
  if (score <= config.thresholds.highMax) {
    return "High";
  }
  return "Critical";
}

export function clampScore(score: number): number {
  return Math.max(1, Math.min(10, score));
}
