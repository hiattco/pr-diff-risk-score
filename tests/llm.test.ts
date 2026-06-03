import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { analyzePullRequestWithLlm } from "../src/llm";
import { mergeConfig } from "../src/rules";
import { scorePullRequest } from "../src/riskScorer";
import type { ChangedFile } from "../src/types";

const files: ChangedFile[] = [
  {
    filename: "src/auth.ts",
    status: "modified",
    additions: 30,
    deletions: 5,
    changes: 35,
    patch: "@@ -1 +1 @@\n-export const role = 'user';\n+export const role = 'admin';"
  }
];

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
      response.end(
        JSON.stringify({
          choices: [{ message: { content: responseContent } }]
        })
      );
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

async function startFailingOpenAiCompatibleServer(): Promise<{ readonly baseUrl: string }> {
  server = http.createServer((_request, response) => {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "No endpoints available" } }));
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`
  };
}

describe("LLM analysis", () => {
  it("uses an OpenAI-compatible endpoint and merges JSON guidance", async () => {
    const remote = await startOpenAiCompatibleServer(
      JSON.stringify({
        score: 8,
        level: "High",
        summary: "Privilege change in auth path.",
        reviewGuidance: ["Verify access-control tests cover admin role changes."],
        recommendedLabels: ["llm:risky"],
        reviewerAreas: ["backend/security"]
      })
    );
    const config = mergeConfig({
      mode: "hybrid",
      llm: {
        enabled: true,
        model: "moonshotai/kimi-k2.6:free",
        maxDiffChars: 80,
        requireJson: true
      }
    });
    const baseline = scorePullRequest(files, config);

    const result = await analyzePullRequestWithLlm(files, baseline, config, "hybrid", {
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: remote.baseUrl
    });

    expect(result.score).toBe(8);
    expect(result.level).toBe("High");
    expect(result.recommendedLabels).toContain("llm:risky");
    expect(result.reviewerAreas).toContain("backend/security");
    expect(result.reviewGuidance).toContain("LLM summary: Privilege change in auth path.");
    expect(result.reviewGuidance).toContain("Verify access-control tests cover admin role changes.");
    expect(result.drivers.map((driver) => driver.key)).toContain("llmAssessment");
    expect(remote.body).toMatchObject({
      model: "moonshotai/kimi-k2.6:free",
      response_format: { type: "json_object" }
    });
  });

  it("uses OpenRouter key fallback when OpenAI key is blank", async () => {
    const remote = await startOpenAiCompatibleServer(
      JSON.stringify({
        score: 7,
        reviewGuidance: ["Review the auth change."],
        recommendedLabels: [],
        reviewerAreas: []
      })
    );
    const config = mergeConfig({
      llm: {
        enabled: true
      }
    });
    const baseline = scorePullRequest(files, config);

    const result = await analyzePullRequestWithLlm(files, baseline, config, "hybrid", {
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "test-key",
      OPENAI_BASE_URL: remote.baseUrl
    });

    expect(result.score).toBe(7);
  });

  it("keeps hybrid level aligned with the final score when heuristic score wins", async () => {
    const remote = await startOpenAiCompatibleServer(
      JSON.stringify({
        score: 3,
        level: "Low",
        reviewGuidance: ["Review the auth change."],
        recommendedLabels: [],
        reviewerAreas: []
      })
    );
    const highRiskFiles: ChangedFile[] = [
      {
        filename: "src/auth.ts",
        status: "modified",
        additions: 700,
        deletions: 0,
        changes: 700
      }
    ];
    const config = mergeConfig({ llm: { enabled: true } });
    const baseline = scorePullRequest(highRiskFiles, config);

    const result = await analyzePullRequestWithLlm(highRiskFiles, baseline, config, "hybrid", {
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: remote.baseUrl
    });

    expect(baseline.score).toBe(8);
    expect(baseline.level).toBe("High");
    expect(result.score).toBe(8);
    expect(result.level).toBe("High");
  });

  it("returns the heuristic result when LLM is disabled", async () => {
    const config = mergeConfig({ llm: { enabled: false } });
    const baseline = scorePullRequest(files, config);

    const result = await analyzePullRequestWithLlm(files, baseline, config, "heuristic", {});

    expect(result).toBe(baseline);
  });

  it("falls back to heuristic result when hybrid LLM request fails", async () => {
    const remote = await startFailingOpenAiCompatibleServer();
    const config = mergeConfig({
      llm: {
        enabled: true
      }
    });
    const baseline = scorePullRequest(files, config);

    const result = await analyzePullRequestWithLlm(files, baseline, config, "hybrid", {
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: remote.baseUrl
    });

    expect(result).toBe(baseline);
  });

  it("rejects provider errors in pure LLM mode", async () => {
    const remote = await startFailingOpenAiCompatibleServer();
    const config = mergeConfig({
      llm: {
        enabled: true
      }
    });
    const baseline = scorePullRequest(files, config);

    await expect(
      analyzePullRequestWithLlm(files, baseline, config, "llm", {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: remote.baseUrl
      })
    ).rejects.toThrowError("LLM request failed with HTTP 404");
  });

  it("rejects malformed JSON when JSON output is required", async () => {
    const remote = await startOpenAiCompatibleServer("not-json");
    const config = mergeConfig({
      llm: {
        enabled: true,
        requireJson: true
      }
    });
    const baseline = scorePullRequest(files, config);

    await expect(
      analyzePullRequestWithLlm(files, baseline, config, "llm", {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: remote.baseUrl
      })
    ).rejects.toThrowError("LLM response was not valid JSON.");
  });

  it("keeps the heuristic score when free-form LLM text is allowed", async () => {
    const remote = await startOpenAiCompatibleServer("Check the auth role escalation carefully.");
    const config = mergeConfig({
      llm: {
        enabled: true,
        requireJson: false
      }
    });
    const baseline = scorePullRequest(files, config);

    const result = await analyzePullRequestWithLlm(files, baseline, config, "llm", {
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: remote.baseUrl
    });

    expect(result.score).toBe(baseline.score);
    expect(result.reviewGuidance).toContain("Check the auth role escalation carefully.");
  });
});
