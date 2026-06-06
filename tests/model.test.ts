import type { Provider } from "@opencode-ai/sdk/v2";
import { describe, expect, it } from "vitest";
import { resolveDefaultModel, resolveModelContextWindow } from "../src/model";
import type { SessionEntry } from "../src/types";

function providerWithVariants(): Provider[] {
  return [
    {
      id: "anthropic",
      name: "Anthropic",
        models: {
          "claude-sonnet-4.6": {
            id: "claude-sonnet-4.6",
            providerID: "anthropic",
            name: "Claude Sonnet 4.6",
            limit: {
              context: 200_000,
              output: 8_000,
            },
            variants: {
              fast: {},
              thinking: {},
          },
        },
      },
    },
  ] as unknown as Provider[];
}

function sessionEntries(): SessionEntry[] {
  return [
    {
      info: {
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      },
      parts: [],
    },
  ] as unknown as SessionEntry[];
}

describe("default model resolution", () => {
  it("includes configured variants when available", () => {
    const resolved = resolveDefaultModel(
      providerWithVariants(),
      "anthropic/claude-sonnet-4.6",
      "fast",
      sessionEntries(),
    );

    expect(resolved.source).toBe("config");
    expect(resolved.model).toEqual({
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4.6",
      },
      variant: "fast",
    });
    expect(resolved.notice).toBeUndefined();
  });

  it("falls back to the session model when the configured variant is unavailable", () => {
    const resolved = resolveDefaultModel(
      providerWithVariants(),
      "anthropic/claude-sonnet-4.6",
      "missing",
      sessionEntries(),
    );

    expect(resolved.source).toBe("session");
    expect(resolved.model).toEqual({
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "default",
    });
    expect(resolved.notice).toContain(
      "Configured mini model anthropic/claude-sonnet-4.6 (missing) was not found.",
    );
  });

  it("resolves a selected model context window from provider metadata", () => {
    expect(
      resolveModelContextWindow(providerWithVariants(), {
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4.6",
        },
        variant: "fast",
      }),
    ).toBe(200_000);
  });

  it("returns undefined when the selected model is missing", () => {
    expect(
      resolveModelContextWindow(providerWithVariants(), {
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      }),
    ).toBeUndefined();
  });
});
