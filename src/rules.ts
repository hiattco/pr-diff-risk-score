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
    manyDeletedFiles: 2,
    hotspotTouched: 2,
    highChurnTouched: 2,
    bugfixHotspotTouched: 2,
    recentlyRevertedTouched: 3,
    architectureMinorDrift: 1,
    architectureModerateDrift: 2,
    architectureMajorDrift: 3,
    architectureCriticalDrift: 4
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
  },
  history: {
    enabled: true,
    mode: "auto",
    lookbackDays: 180,
    recentCommitThreshold: 8,
    churnThreshold: 500,
    bugfixCommitThreshold: 2,
    revertCommitThreshold: 1,
    maxHotspotFilesShown: 5,
    bugfixKeywords: ["fix", "bug", "regression", "revert", "hotfix", "incident"]
  },
  architecture: {
    enabled: false,
    mode: "off",
    strict: false,
    maxDocChars: 12000,
    maxDiffChars: 8000,
    includePrBody: true,
    requireMappedDocs: false,
    maxFindingsShown: 5,
    context: {
      docs: []
    },
    severityWeights: {
      minor: 1,
      moderate: 2,
      major: 3,
      critical: 4
    }
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
    llm: { ...defaultConfig.llm, ...partial.llm },
    history: { ...defaultConfig.history, ...partial.history },
    architecture: {
      ...defaultConfig.architecture,
      ...partial.architecture,
      context: {
        ...defaultConfig.architecture.context,
        ...partial.architecture?.context
      },
      severityWeights: {
        ...defaultConfig.architecture.severityWeights,
        ...partial.architecture?.severityWeights
      }
    }
  };
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function pruneDefaultActionInputs(actionInputs?: PartialRiskConfig): PartialRiskConfig | undefined {
  if (!actionInputs) {
    return undefined;
  }

  const history =
    actionInputs.history &&
    (actionInputs.history.mode !== defaultConfig.history.mode ||
      actionInputs.history.lookbackDays !== defaultConfig.history.lookbackDays ||
      !sameStringArray(actionInputs.history.bugfixKeywords, defaultConfig.history.bugfixKeywords))
      ? actionInputs.history
      : undefined;
  const architecture =
    actionInputs.architecture &&
    (actionInputs.architecture.mode !== defaultConfig.architecture.mode ||
      actionInputs.architecture.maxDocChars !== defaultConfig.architecture.maxDocChars)
      ? actionInputs.architecture
      : undefined;

  return {
    ...actionInputs,
    ...(history ? { history } : { history: undefined }),
    ...(architecture ? { architecture } : { architecture: undefined })
  };
}

export function mergeConfigWithActionInputs(loadedConfig?: PartialRiskConfig, actionInputs?: PartialRiskConfig): RiskConfig {
  const prunedInputs = pruneDefaultActionInputs(actionInputs);

  return mergeConfig({
    ...loadedConfig,
    ...prunedInputs,
    history: { ...loadedConfig?.history, ...prunedInputs?.history },
    architecture: {
      ...loadedConfig?.architecture,
      ...prunedInputs?.architecture,
      context: { ...loadedConfig?.architecture?.context, ...prunedInputs?.architecture?.context },
      severityWeights: { ...loadedConfig?.architecture?.severityWeights, ...prunedInputs?.architecture?.severityWeights }
    }
  });
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
