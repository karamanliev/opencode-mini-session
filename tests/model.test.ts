import type { ModelInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  resolveDefaultModel,
  resolveModelContextWindow,
  resolveModelPreference,
} from "../src/model";
import type { SessionEntry } from "../src/types";

function models(): ModelInfo[] {
  return [
    {
      id: "claude-sonnet-4.6",
      modelID: "claude-sonnet-4.6",
      providerID: "anthropic",
      name: "Claude Sonnet 4.6",
      limit: {
        context: 200_000,
        output: 8_000,
      },
      variants: [{ id: "fast" }, { id: "thinking" }],
    },
  ] as unknown as ModelInfo[];
}

function sessionEntries(
  model = { id: "gpt-5", providerID: "openai", variant: "default" },
): SessionEntry[] {
  return [
    {
      info: {
        id: "assistant-1",
        type: "assistant",
        time: { created: 0 },
        agent: "build",
        model,
        content: [],
      },
      parts: [],
    },
  ] as unknown as SessionEntry[];
}

describe("default model resolution", () => {
  it("includes configured variants when available", () => {
    const resolved = resolveDefaultModel(
      models(),
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
      models(),
      "anthropic/claude-sonnet-4.6",
      "missing",
      sessionEntries({
        id: "claude-sonnet-4.6",
        providerID: "anthropic",
        variant: "thinking",
      }),
    );

    expect(resolved.source).toBe("session");
    expect(resolved.model).toEqual({
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4.6",
      },
      variant: "thinking",
    });
    expect(resolved.notice).toContain(
      "Configured mini model anthropic/claude-sonnet-4.6 (missing) was not found.",
    );
  });

  it("falls back to the provided default model when the session has none", () => {
    const resolved = resolveDefaultModel(
      models(),
      null,
      null,
      [],
      { model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" } },
    );

    expect(resolved.source).toBe("default");
    expect(resolved.model).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
    });
  });

  it.each([
    { id: "gpt-5", providerID: "openai", variant: "default" },
    { id: "claude-sonnet-4.6", providerID: "anthropic", variant: "removed" },
  ])("skips an unavailable historical selection: $id ($variant)", (historical) => {
    const fallback = {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      variant: "fast",
    };
    const resolved = resolveDefaultModel(
      models(),
      null,
      null,
      sessionEntries(historical),
      fallback,
    );

    expect(resolved.source).toBe("default");
    expect(resolved.model).toEqual(fallback);
  });

  it("validates the historical fallback when the configured model is unavailable", () => {
    const fallback = {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
    };
    const resolved = resolveDefaultModel(
      models(),
      "missing/model",
      null,
      sessionEntries(),
      fallback,
    );

    expect(resolved.source).toBe("default");
    expect(resolved.model).toEqual(fallback);
    expect(resolved.notice).toContain(
      "Configured mini model missing/model was not found.",
    );
  });

  it("does not explicitly select an unavailable server default", () => {
    const resolved = resolveDefaultModel(
      models(),
      null,
      null,
      sessionEntries(),
      {
        model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
        variant: "removed",
      },
    );

    expect(resolved.source).toBe("unknown");
    expect(resolved.model).toEqual({});
  });

  it("preserves historical selections when the model inventory is unavailable", () => {
    const resolved = resolveDefaultModel([], null, null, sessionEntries());

    expect(resolved.source).toBe("session");
    expect(resolved.model.model?.modelID).toBe("gpt-5");
  });

  it("resolves a selected model context window from model metadata", () => {
    expect(
      resolveModelContextWindow(models(), {
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
      resolveModelContextWindow(models(), {
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      }),
    ).toBeUndefined();
  });
});

describe("persisted model preference", () => {
  const available = {
    model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
    variant: "fast",
  };

  it("keeps an available model and variant", () => {
    expect(resolveModelPreference(models(), available)).toEqual({
      preference: available,
    });
  });

  it("drops a preference whose model was removed", () => {
    const resolved = resolveModelPreference(models(), {
      model: { providerID: "openai", modelID: "gpt-5" },
    });

    expect(resolved.preference).toBeUndefined();
    expect(resolved.notice).toContain("no longer available");
  });

  it("drops a preference whose variant was removed", () => {
    const resolved = resolveModelPreference(models(), {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      variant: "missing",
    });

    expect(resolved.preference).toBeUndefined();
    expect(resolved.notice).toContain("no longer available");
  });

  it("keeps the preference when the model list is unavailable", () => {
    expect(resolveModelPreference([], available)).toEqual({
      preference: available,
    });
  });
});
