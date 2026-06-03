import type { RiskResult } from "./types";

export const COMMENT_MARKER = "<!-- pr-diff-risk-score -->";

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderHistorySection(result: RiskResult): string {
  if (!result.history?.available || result.history.hotspotFiles.length === 0) {
    return "";
  }

  const files = result.history.hotspotFiles.map((file) => {
    const details = [`${file.recentCommits} recent commits`, `${file.recentChurn} recent churn`];
    if (file.bugfixCommits > 0) {
      details.push(`${file.bugfixCommits} bugfix-related commits`);
    }
    if (file.revertCommits > 0) {
      details.push(`${file.revertCommits} revert-related commits`);
    }
    return `${file.filename}: ${details.join(", ")}`;
  });

  return `
### Repository history signals
${bulletList(files)}
`;
}

function architectureDriftLabel(score: number | undefined): string {
  if (typeof score !== "number") {
    return "Unknown";
  }
  if (score <= 3) {
    return "Low";
  }
  if (score <= 6) {
    return "Medium";
  }
  if (score <= 8) {
    return "High";
  }
  return "Critical";
}

function renderArchitectureSection(result: RiskResult): string {
  if (!result.architecture?.available) {
    return "";
  }

  const assessment = result.architecture;
  const findings =
    assessment.findings.length > 0
      ? bulletList(assessment.findings.map((finding) => `${finding.title}: ${finding.evidence} Recommendation: ${finding.recommendation}`))
      : "No material architecture drift detected against configured docs.";

  return `
### Architecture adherence

Adherence score: ${assessment.adherenceScore ?? 10}/10
Architecture drift risk: ${architectureDriftLabel(assessment.driftRiskScore)}

${assessment.findings.length > 0 ? `Findings:\n${findings}` : findings}
`;
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
${renderHistorySection(result)}${renderArchitectureSection(result)}

### Review-quality drivers
${bulletList(slopDrivers)}

### Recommended labels
${bulletList(result.recommendedLabels)}

### Suggested reviewer area
${bulletList(result.reviewerAreas)}

### Review guidance
${bulletList(result.reviewGuidance)}

_Scored ${result.stats.filesChanged} changed file(s) with ${result.stats.totalChanges} total addition/deletion line changes._`;
}
