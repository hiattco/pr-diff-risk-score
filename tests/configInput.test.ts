import { describe, expect, it } from "vitest";
import { mergeConfigWithActionInputs } from "../src/rules";

describe("mergeConfigWithActionInputs", () => {
  it("Given config-only architecture enablement When action inputs are defaults Then config is not overwritten", () => {
    const config = mergeConfigWithActionInputs(
      {
        architecture: {
          enabled: true,
          mode: "auto",
          context: {
            docs: [{ id: "backend", paths: ["docs/architecture/backend.md"], appliesTo: ["src/api/**"] }]
          }
        },
        history: {
          enabled: true,
          mode: "local-git",
          lookbackDays: 90
        }
      },
      {
        history: {
          enabled: true,
          mode: "auto",
          lookbackDays: 180,
          bugfixKeywords: ["fix", "bug", "regression", "revert", "hotfix", "incident"]
        },
        architecture: {
          enabled: false,
          mode: "off",
          maxDocChars: 12000
        }
      }
    );

    expect(config.architecture.enabled).toBe(true);
    expect(config.architecture.mode).toBe("auto");
    expect(config.architecture.context.docs).toHaveLength(1);
    expect(config.history.mode).toBe("local-git");
    expect(config.history.lookbackDays).toBe(90);
  });

  it("Given non-default action inputs When merging Then workflow inputs override config", () => {
    const config = mergeConfigWithActionInputs(
      {
        architecture: {
          enabled: true,
          mode: "auto",
          maxDocChars: 6000
        },
        history: {
          enabled: true,
          mode: "auto",
          lookbackDays: 90
        }
      },
      {
        history: {
          enabled: true,
          mode: "local-git",
          lookbackDays: 30
        },
        architecture: {
          enabled: true,
          mode: "llm",
          maxDocChars: 4000
        }
      }
    );

    expect(config.architecture.mode).toBe("llm");
    expect(config.architecture.maxDocChars).toBe(4000);
    expect(config.history.mode).toBe("local-git");
    expect(config.history.lookbackDays).toBe(30);
  });
});
