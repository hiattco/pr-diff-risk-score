import type { RiskResult } from "./types";

export const COMMENT_MARKER = "<!-- pr-diff-risk-score -->";

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderRiskComment(result: RiskResult): string {
  const drivers = result.drivers.length > 0 ? result.drivers.map((driver) => `${driver.label} (+${driver.points})`) : ["No major risk drivers detected"];
  const slopDrivers = result.slopDrivers.length > 0 ? result.slopDrivers.map((driver) => `${driver.label} (+${driver.points})`) : ["No major review-quality drivers detected"];

  return `${COMMENT_MARKER}
## PR Diff Risk Score

**Risk score:** ${result.score}/10  
**Risk level:** ${result.level}
**Review-quality score:** ${result.slopScore}/10
**Overall score:** ${result.overallScore}/10

### Main drivers
${bulletList(drivers)}

### Review-quality drivers
${bulletList(slopDrivers)}

### Suggested reviewer area
${bulletList(result.reviewerAreas)}

### Review guidance
${bulletList(result.reviewGuidance)}

_Scored ${result.stats.filesChanged} changed file(s) with ${result.stats.totalChanges} total addition/deletion line changes._`;
}
