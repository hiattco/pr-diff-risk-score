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
    level: result.level,
    drivers: orderedDrivers,
    reviewerAreas: result.reviewerAreas,
    reviewGuidance: result.reviewGuidance,
    stats: orderedStats
  };

  return JSON.stringify(orderedResult);
}
