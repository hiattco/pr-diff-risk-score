import type { RiskResult } from "./types";

export function serializeRiskResult(result: RiskResult): string {
  const orderedDrivers = result.drivers.map((driver) => ({
    key: driver.key,
    label: driver.label,
    points: driver.points
  }));

  const orderedStats = {
    filesChanged: result.stats.filesChanged,
    totalChanges: result.stats.totalChanges,
    deletedFiles: result.stats.deletedFiles,
    testsChanged: result.stats.testsChanged
  };

  const orderedResult = {
    score: result.score,
    slopScore: result.slopScore,
    overallScore: result.overallScore,
    level: result.level,
    drivers: orderedDrivers,
    slopDrivers: result.slopDrivers,
    recommendedLabels: result.recommendedLabels,
    reviewerAreas: result.reviewerAreas,
    reviewGuidance: result.reviewGuidance,
    stats: orderedStats,
    ...(result.history ? { history: result.history } : {}),
    ...(result.architecture ? { architecture: result.architecture } : {})
  };

  return JSON.stringify(orderedResult);
}
