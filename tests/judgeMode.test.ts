import { describe, expect, it } from "vitest";
import { mergeConfig } from "../src/rules";
import { parseJudgeMode, resolveJudgeMode } from "../src/judge";

describe("judge mode configuration", () => {
  it("defaults to heuristic mode", () => {
    const config = mergeConfig(undefined);
    const judgeMode = resolveJudgeMode("", config.mode, config);

    expect(judgeMode).toBe("heuristic");
    expect(config.llm.enabled).toBe(false);
  });

  it("resolves llm mode when enabled in config", () => {
    const config = mergeConfig({
      llm: {
        enabled: true
      }
    });

    expect(resolveJudgeMode("llm", config.mode, config)).toBe("llm");
  });

  it("falls back to heuristic when llm mode is requested but disabled", () => {
    const config = mergeConfig({
      llm: {
        enabled: false
      }
    });

    expect(resolveJudgeMode("hybrid", config.mode, config)).toBe("heuristic");
  });

  it("reads explicit mode input and still validates unsupported choices", () => {
    const config = mergeConfig({
      mode: "heuristic"
    });

    expect(resolveJudgeMode("llm", config.mode, config)).toBe("heuristic");
    expect(() => parseJudgeMode("unsupported")).toThrowError("mode must be one of: heuristic, llm, hybrid.");
  });

  it("rejects invalid configured mode values", () => {
    const config = mergeConfig({
      mode: "heuristic"
    });

    expect(() => resolveJudgeMode("", "bogus", config)).toThrowError("mode must be one of: heuristic, llm, hybrid.");
  });
});
