import { afterEach, describe, expect, it, vi } from "vitest";

const { buildCopiedContext, getSessionEntries, resolveRuntimeMiniAgent } = vi.hoisted(() => ({
  buildCopiedContext: vi.fn(() => ({ text: "main context", usedTokens: 31_000 })),
  getSessionEntries: vi.fn(() => []),
  resolveRuntimeMiniAgent: vi.fn(),
}));

vi.mock("../src/agent", async () => {
  const actual = await vi.importActual<typeof import("../src/agent")>(
    "../src/agent",
  );
  return {
    ...actual,
    resolveRuntimeMiniAgent,
  };
});

vi.mock("../src/context", () => ({
  getSessionEntries,
  buildCopiedContext,
}));

import { openMiniSession, startQuestion } from "../src/session";
import type {
  ActiveDialogController,
  OverlayState,
  MiniConfig,
  ModelPreferenceState,
  ThinkingPreferenceState,
} from "../src/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function config(): MiniConfig {
  return {
    model: null,
    variant: null,
    agent: null,
    tokenLimit: 50_000,
    keybind: "alt+b",
    freshKeybind: "alt+n",
    enableThinking: false,
    toggleThinkingKeybind: "ctrl+t",
    allowedTools: null,
    allowedToolsProvided: false,
  };
}

function fakeApi() {
  return {
    state: {
      provider: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-sonnet-4.6": {
              id: "claude-sonnet-4.6",
              providerID: "anthropic",
              name: "Claude Sonnet 4.6",
              limit: { context: 200_000, output: 8_000 },
              variants: { fast: {} },
            },
          },
        },
      ],
      path: { directory: "/tmp/project" },
    },
    renderer: {
      currentFocusedRenderable: undefined,
      requestRender: vi.fn(),
    },
    ui: {
      toast: vi.fn(),
    },
    client: {
      session: {
        abort: vi.fn(),
        create: vi.fn(async () => ({ data: { id: "mini-session" } })),
        delete: vi.fn(),
        promptAsync: vi.fn(),
      },
    },
    event: {
      on: vi.fn(() => () => {}),
    },
    route: {
      current: { name: "session", params: { sessionID: "session-1" } },
    },
  } as any;
}

function assistantEntry(options: {
  id: string;
  text: string;
  inputTokens?: number;
  completed?: boolean;
}) {
  return {
    info: {
      id: options.id,
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet-4.6",
      variant: "fast",
      time: options.completed ? { completed: Date.now() } : {},
      tokens:
        options.inputTokens !== undefined
          ? { input: options.inputTokens }
          : undefined,
    },
    parts: [{ type: "text", text: options.text }],
  } as any;
}

function resolvedAgent() {
  return {
    mode: "plugin-managed",
    requestedAgent: null,
    agent: null,
    allowedTools: ["read"],
    permission: [],
    permissionSource: "plugin-managed",
    notices: [],
  };
}

function fakeScroller(options: {
  scrollTop?: number;
  scrollHeight?: number;
  viewportHeight?: number;
} = {}) {
  const scroller = {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight ?? 20,
    viewport: { height: options.viewportHeight ?? 10 },
    scrollTo: vi.fn((position: number) => {
      scroller.scrollTop =
        position === Number.MAX_SAFE_INTEGER
          ? Math.max(0, scroller.scrollHeight - scroller.viewport.height)
          : position;
    }),
    scrollBy: vi.fn((delta: number) => {
      scroller.scrollTop = Math.max(
        0,
        Math.min(
          scroller.scrollTop + delta,
          Math.max(0, scroller.scrollHeight - scroller.viewport.height),
        ),
      );
    }),
  };
  return scroller;
}

async function flushScrollTimer() {
  await vi.advanceTimersByTimeAsync(0);
}

async function flushStreamingRender() {
  await vi.advanceTimersByTimeAsync(51);
  await flushScrollTimer();
}

afterEach(() => {
  vi.useRealTimers();
  buildCopiedContext.mockClear();
  getSessionEntries.mockReset();
  getSessionEntries.mockReturnValue([]);
  resolveRuntimeMiniAgent.mockReset();
});

describe("openMiniSession", () => {
  it("returns false and shows the active dialog when one is already open", () => {
    const activeDialog = {
      show: vi.fn(),
    } as any;

    const opened = openMiniSession(
      fakeApi(),
      config(),
      "main",
      vi.fn(),
      { get: () => activeDialog, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    expect(opened).toBe(false);
    expect(activeDialog.show).toHaveBeenCalledOnce();
  });

  it("returns true after creating a new dialog", () => {
    resolveRuntimeMiniAgent.mockReturnValue({
      mode: "plugin-managed",
      requestedAgent: null,
      agent: null,
      allowedTools: ["read"],
      permission: [],
      permissionSource: "plugin-managed",
      notices: [],
    });

    let activeDialog: ActiveDialogController | undefined;

    const opened = openMiniSession(
      fakeApi(),
      config(),
      "main",
      vi.fn(),
      {
        get: () => activeDialog,
        set: (dialog: ActiveDialogController | undefined) => {
          activeDialog = dialog;
        },
      },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    expect(opened).toBe(true);
    expect(activeDialog).toBeDefined();
  });
});

describe("startQuestion", () => {
  it("forces bottom scroll and follows streaming after submitting a prompt", async () => {
    vi.useFakeTimers();
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const handlers: Record<string, (event: any) => void> = {};
    const api = fakeApi();
    api.event.on.mockImplementation((name: string, handler: (event: any) => void) => {
      handlers[name] = handler;
      return () => {};
    });
    let overlay: OverlayState | undefined;
    const scroller = fakeScroller({
      scrollTop: 30,
      scrollHeight: 40,
      viewportHeight: 10,
    });

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    overlay?.onScroller?.(scroller as any);
    expect(overlay?.onSubmit("hello")).toBe(true);
    await flushScrollTimer();

    expect(scroller.scrollTo).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);

    scroller.scrollHeight += 20;
    handlers["session.next.text.delta"]({
      properties: { sessionID: "mini-session", delta: "answer" },
    });
    await flushStreamingRender();

    expect(scroller.scrollTo).toHaveBeenCalledTimes(2);
    expect(scroller.scrollTop).toBe(50);
  });

  it("stops following streaming after the user scrolls up", async () => {
    vi.useFakeTimers();
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const handlers: Record<string, (event: any) => void> = {};
    const api = fakeApi();
    api.event.on.mockImplementation((name: string, handler: (event: any) => void) => {
      handlers[name] = handler;
      return () => {};
    });
    let overlay: OverlayState | undefined;
    const scroller = fakeScroller({
      scrollTop: 30,
      scrollHeight: 40,
      viewportHeight: 10,
    });

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    overlay?.onScroller?.(scroller as any);
    expect(overlay?.onSubmit("hello")).toBe(true);
    await flushScrollTimer();

    scroller.scrollTop = 25;
    scroller.scrollHeight += 20;
    handlers["session.next.text.delta"]({
      properties: { sessionID: "mini-session", delta: "answer" },
    });
    await flushStreamingRender();

    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(25);
  });

  it("registers an active controller before agent resolution completes", async () => {
    const agentResolution = deferred<any>();
    resolveRuntimeMiniAgent.mockReturnValue(agentResolution.promise);

    const api = fakeApi();
    let activeDialog: ActiveDialogController | undefined;
    const active = {
      get: () => activeDialog,
      set: (dialog: ActiveDialogController | undefined) => {
        activeDialog = dialog;
      },
    };
    const modelPreference: ModelPreferenceState = {
      get: () => undefined,
      set: vi.fn(),
    };
    const thinkingPreference: ThinkingPreferenceState = {
      get: () => false,
      set: vi.fn(),
    };

    const opening = startQuestion(
      api,
      config(),
      "main",
      "session-1",
      vi.fn(),
      active,
      modelPreference,
      thinkingPreference,
      vi.fn(),
    );

    await Promise.resolve();
    expect(activeDialog).toBeDefined();

    await activeDialog?.close();
    agentResolution.resolve({
      mode: "plugin-managed",
      requestedAgent: null,
      agent: null,
      allowedTools: ["read"],
      permission: [],
      permissionSource: "plugin-managed",
      notices: [],
    });

    await opening;
    expect(activeDialog).toBeUndefined();
  });

  it("skips copied context formatting in fresh mode", async () => {
    const agentResolution = deferred<any>();
    resolveRuntimeMiniAgent.mockReturnValue(agentResolution.promise);

    const opening = startQuestion(
      fakeApi(),
      config(),
      "fresh",
      "session-1",
      vi.fn(),
      { get: () => undefined, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    await Promise.resolve();
    expect(buildCopiedContext).not.toHaveBeenCalled();

    agentResolution.resolve({
      mode: "plugin-managed",
      requestedAgent: null,
      agent: null,
      allowedTools: ["read"],
      permission: [],
      permissionSource: "plugin-managed",
      notices: [],
    });

    await opening;
  });

  it("shows copied-context usage when main mini opens", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    let overlay: OverlayState | undefined;

    await startQuestion(
      fakeApi(),
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    expect(overlay?.state.footerCounter).toEqual({
      copiedContext: {
        usedTokens: 31_000,
        tokenLimit: 50_000,
        text: "31.0K / 50.0K",
        capReached: false,
      },
      miniSession: undefined,
      placeholder: undefined,
    });
  });

  it("shows no counter when fresh mini opens", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    let overlay: OverlayState | undefined;

    await startQuestion(
      fakeApi(),
      config(),
      "fresh",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    expect(overlay?.state.footerCounter).toEqual({
      copiedContext: undefined,
      miniSession: undefined,
      placeholder: undefined,
    });
  });

  it("stores exact completed input tokens after session idle", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());
    getSessionEntries.mockReturnValue([
      assistantEntry({
        id: "assistant-1",
        text: "answer",
        inputTokens: 11_240,
        completed: true,
      }),
    ]);

    const handlers: Record<string, (event: any) => void> = {};
    const api = fakeApi();
    api.event.on.mockImplementation((name: string, handler: (event: any) => void) => {
      handlers[name] = handler;
      return () => {};
    });
    let overlay: OverlayState | undefined;
    const modelPreference = {
      get: () => ({
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4.6",
        },
        variant: "fast",
      }),
      set: vi.fn(),
    };

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      modelPreference,
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    handlers["session.idle"]({ properties: { sessionID: "mini-session" } });

    expect(overlay?.state.lastCompletedMiniInputTokens).toBe(11_240);
    expect(overlay?.state.footerCounter.miniSession?.text).toBe("11.2K (6%)");
  });

  it("keeps the last completed exact value while a later response streams", async () => {
    vi.useFakeTimers();
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const handlers: Record<string, (event: any) => void> = {};
    const api = fakeApi();
    getSessionEntries.mockReturnValue([
      assistantEntry({
        id: "assistant-1",
        text: "answer",
        inputTokens: 11_240,
        completed: true,
      }),
    ]);
    api.event.on.mockImplementation((name: string, handler: (event: any) => void) => {
      handlers[name] = handler;
      return () => {};
    });
    let overlay: OverlayState | undefined;
    const modelPreference = {
      get: () => ({
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4.6",
        },
        variant: "fast",
      }),
      set: vi.fn(),
    };

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      modelPreference,
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    handlers["session.idle"]({ properties: { sessionID: "mini-session" } });
    getSessionEntries.mockReturnValue([
      assistantEntry({
        id: "assistant-1",
        text: "answer",
        inputTokens: 11_240,
        completed: true,
      }),
      assistantEntry({ id: "assistant-2", text: "streaming" }),
    ]);

    handlers["session.next.text.delta"]({
      properties: { sessionID: "mini-session", delta: "more" },
    });
    await flushStreamingRender();

    expect(overlay?.state.lastCompletedMiniInputTokens).toBe(11_240);
    expect(overlay?.state.footerCounter.miniSession?.text).toBe("11.2K (6%)");
  });

  it("recalculates percentages immediately after a model change", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const api = fakeApi();
    let overlay: OverlayState | undefined;
    const modelPreference = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
    };

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      modelPreference,
      { get: () => false, set: vi.fn() },
      (onAfterSelect) => {
        if (!overlay) return;
        overlay.state.lastCompletedMiniInputTokens = 100_000;
        modelPreference.get.mockReturnValue({
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4.6",
          },
          variant: "fast",
        });
        onAfterSelect();
      },
    );

    overlay?.onChangeModel();

    expect(overlay?.state.modelContextWindow).toBe(200_000);
    expect(overlay?.state.footerCounter.miniSession?.text).toBe("100.0K (50%)");
  });

  it("changes the placeholder only after the exact mini-session value crosses the limit threshold", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const api = fakeApi();
    let overlay: OverlayState | undefined;
    const modelPreference = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
    };

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      modelPreference,
      { get: () => false, set: vi.fn() },
      (onAfterSelect) => {
        if (!overlay) return;
        overlay.state.lastCompletedMiniInputTokens = 196_000;
        modelPreference.get.mockReturnValue({
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4.6",
          },
          variant: "fast",
        });
        onAfterSelect();
      },
    );

    expect(overlay?.state.inputPlaceholder).toBeUndefined();

    overlay?.onChangeModel();

    expect(overlay?.state.inputPlaceholder).toBe(
      "Session context limit reached...",
    );
  });

  it("hides percentages and threshold effects when the model context window is unknown", async () => {
    resolveRuntimeMiniAgent.mockResolvedValue(resolvedAgent());

    const api = fakeApi();
    let overlay: OverlayState | undefined;
    const modelPreference = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
    };

    await startQuestion(
      api,
      config(),
      "main",
      "session-1",
      ((next: OverlayState | undefined) => {
        overlay = next;
      }) as any,
      { get: () => undefined, set: vi.fn() },
      modelPreference,
      { get: () => false, set: vi.fn() },
      (onAfterSelect) => {
        if (!overlay) return;
        overlay.state.lastCompletedMiniInputTokens = 196_000;
        modelPreference.get.mockReturnValue({
          model: {
            providerID: "openai",
            modelID: "gpt-5",
          },
        });
        onAfterSelect();
      },
    );

    overlay?.onChangeModel();

    expect(overlay?.state.modelContextWindow).toBeUndefined();
    expect(overlay?.state.footerCounter.miniSession?.text).toBe("196.0K");
    expect(overlay?.state.footerCounter.miniSession?.warning).toBe(false);
    expect(overlay?.state.inputPlaceholder).toBeUndefined();
  });

  it("uses the fresh keybind in the hide toast", async () => {
    const agentResolution = deferred<any>();
    resolveRuntimeMiniAgent.mockReturnValue(agentResolution.promise);

    const api = fakeApi();
    let activeDialog: ActiveDialogController | undefined;

    const opening = startQuestion(
      api,
      config(),
      "fresh",
      "session-1",
      vi.fn(),
      {
        get: () => activeDialog,
        set: (dialog: ActiveDialogController | undefined) => {
          activeDialog = dialog;
        },
      },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    await Promise.resolve();
    activeDialog?.hide();

    expect(api.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "mini hidden. Press alt+n to show it.",
      }),
    );

    agentResolution.resolve({
      mode: "plugin-managed",
      requestedAgent: null,
      agent: null,
      allowedTools: ["read"],
      permission: [],
      permissionSource: "plugin-managed",
      notices: [],
    });

    await opening;
  });

  it("closes and shows an error if agent resolution fails", async () => {
    const api = fakeApi();
    let activeDialog: ActiveDialogController | undefined;

    resolveRuntimeMiniAgent.mockRejectedValue(new Error("agent lookup failed"));

    const opening = startQuestion(
      api,
      config(),
      "main",
      "session-1",
      vi.fn(),
      {
        get: () => activeDialog,
        set: (dialog: ActiveDialogController | undefined) => {
          activeDialog = dialog;
        },
      },
      { get: () => undefined, set: vi.fn() },
      { get: () => false, set: vi.fn() },
      vi.fn(),
    );

    await opening;

    expect(activeDialog).toBeUndefined();
    expect(api.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Failed to open mini session: agent lookup failed",
      }),
    );
  });
});
