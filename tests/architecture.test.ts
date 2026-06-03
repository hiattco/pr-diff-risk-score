import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessArchitecture, mergeArchitectureAssessment } from "../src/architecture";
import { renderRiskComment } from "../src/comment";
import { serializeRiskResult } from "../src/output";
import { mergeConfig } from "../src/rules";
import { scorePullRequest } from "../src/riskScorer";
import type { ChangedFile } from "../src/types";

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const activeServer = server;
    server = undefined;
    if (!activeServer) {
      resolve();
      return;
    }
    activeServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

function file(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    filename: "src/api/orders.ts",
    status: "modified",
    additions: 10,
    deletions: 5,
    changes: 15,
    patch: "@@ -1 +1 @@\n-export const oldValue = 1;\n+export const directDbCall = true;",
    ...overrides
  };
}

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-risk-arch-"));
}

function write(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

async function startOpenAiCompatibleServer(responseContent: string): Promise<{ readonly baseUrl: string; readonly body: unknown }> {
  let requestBody: unknown;

  server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
    });
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get body(): unknown {
      return requestBody;
    }
  };
}

describe("assessArchitecture", () => {
  it("Given architecture is disabled When assessing Then it returns an unavailable off assessment", async () => {
    const config = mergeConfig({ architecture: { enabled: false, mode: "off" } });

    const assessment = await assessArchitecture([file({ filename: "src/api/orders.ts" })], config, workspace(), {}, "hybrid");

    expect(assessment).toMatchObject({
      enabled: false,
      available: false,
      mode: "off",
      findings: []
    });
  });

  it("Given configured docs do not match changed files When assessing Then it skips without findings", async () => {
    const root = workspace();
    write(root, "docs/architecture/backend.md", "# Backend\n\nAPI handlers must call services.\n");
    const config = mergeConfig({
      architecture: {
        enabled: true,
        mode: "auto",
        context: {
          docs: [
            {
              id: "backend",
              paths: ["docs/architecture/backend.md"],
              appliesTo: ["src/server/**"]
            }
          ]
        }
      }
    });

    const assessment = await assessArchitecture([file({ filename: "src/api/orders.ts" })], config, root, {}, "hybrid");

    expect(assessment.available).toBe(false);
    expect(assessment.skippedReason).toContain("No configured architecture docs matched");
  });

  it("Given matching Markdown docs with Mermaid When assessing Then only relevant doc context is sent to the LLM", async () => {
    const remote = await startOpenAiCompatibleServer(
      JSON.stringify({
        adherenceScore: 10,
        driftRiskScore: 1,
        summary: "Looks consistent.",
        findings: [],
        recommendedLabels: [],
        reviewGuidance: [],
        reviewerAreas: []
      })
    );
    const root = workspace();
    write(root, "docs/architecture/backend.md", "# Backend\n\n```mermaid\nflowchart TD\n  API --> Service\n```\n\nAPI handlers must call services.\n");
    write(root, "docs/architecture/frontend.md", "# Frontend\n\nComponents stay presentational.\n");
    const config = mergeConfig({
      llm: { enabled: true, baseUrl: remote.baseUrl, model: "test-model", requireJson: true },
      architecture: {
        enabled: true,
        mode: "llm",
        maxDocChars: 1000,
        context: {
          docs: [
            { id: "backend", paths: ["docs/architecture/backend.md"], appliesTo: ["src/api/**"] },
            { id: "frontend", paths: ["docs/architecture/frontend.md"], appliesTo: ["src/components/**"] }
          ]
        }
      }
    });

    const assessment = await assessArchitecture([file({ filename: "src/api/orders.ts" })], config, root, { OPENAI_API_KEY: "test-key" }, "llm");

    expect(assessment.available).toBe(true);
    expect(assessment.docsEvaluated).toEqual(["docs/architecture/backend.md"]);
    expect(JSON.stringify(remote.body)).toContain("flowchart TD");
    expect(JSON.stringify(remote.body)).not.toContain("Components stay presentational");
  });

  it("Given a moderate architecture finding When merging Then score labels guidance comment and json include architecture risk", async () => {
    const config = mergeConfig({ architecture: { enabled: true } });
    const baseline = scorePullRequest([file({ filename: "src/api/orders.ts" })], config);

    const result = mergeArchitectureAssessment(
      baseline,
      {
        enabled: true,
        available: true,
        mode: "llm",
        docsEvaluated: ["docs/architecture/backend.md"],
        changedFilesEvaluated: ["src/api/orders.ts"],
        adherenceScore: 6,
        driftRiskScore: 6,
        findings: [
          {
            severity: "moderate",
            docId: "backend",
            docPath: "docs/architecture/backend.md",
            changedFiles: ["src/api/orders.ts"],
            title: "Possible service boundary bypass",
            evidence: "API handler appears to add direct persistence access.",
            recommendation: "Move persistence logic into the service layer or explain the exception."
          }
        ]
      },
      config
    );

    expect(result.drivers.map((driver) => driver.key)).toContain("architectureModerateDrift");
    expect(result.recommendedLabels).toEqual(expect.arrayContaining(["architecture-review", "architecture-drift"]));
    expect(result.reviewerAreas).toContain("architecture");
    expect(result.reviewGuidance).toContain("Check whether the changed files still follow the documented service and dependency boundaries.");
    expect(renderRiskComment(result)).toContain("### Architecture adherence");
    expect(serializeRiskResult(result)).toContain("\"architecture\"");
  });

  it("Given invalid LLM JSON When auto hybrid non-strict assessing Then it skips gracefully", async () => {
    const remote = await startOpenAiCompatibleServer("not json");
    const root = workspace();
    write(root, "docs/architecture/backend.md", "# Backend\n\nAPI handlers must call services.\n");
    const config = mergeConfig({
      llm: { enabled: true, baseUrl: remote.baseUrl, model: "test-model", requireJson: true },
      architecture: {
        enabled: true,
        mode: "auto",
        strict: false,
        context: {
          docs: [{ id: "backend", paths: ["docs/architecture/backend.md"], appliesTo: ["src/api/**"] }]
        }
      }
    });

    const assessment = await assessArchitecture([file({ filename: "src/api/orders.ts" })], config, root, { OPENAI_API_KEY: "test-key" }, "hybrid");

    expect(assessment.available).toBe(false);
    expect(assessment.skippedReason).toContain("valid JSON");
  });

  it("Given invalid LLM JSON When strict llm assessing Then it fails clearly", async () => {
    const remote = await startOpenAiCompatibleServer("not json");
    const root = workspace();
    write(root, "docs/architecture/backend.md", "# Backend\n\nAPI handlers must call services.\n");
    const config = mergeConfig({
      llm: { enabled: true, baseUrl: remote.baseUrl, model: "test-model", requireJson: true },
      architecture: {
        enabled: true,
        mode: "llm",
        strict: true,
        context: {
          docs: [{ id: "backend", paths: ["docs/architecture/backend.md"], appliesTo: ["src/api/**"] }]
        }
      }
    });

    await expect(assessArchitecture([file({ filename: "src/api/orders.ts" })], config, root, { OPENAI_API_KEY: "test-key" }, "llm")).rejects.toThrow("valid JSON");
  });
});
