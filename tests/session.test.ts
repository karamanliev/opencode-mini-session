import { afterEach, describe, expect, it, vi } from "vitest";

const { formatFullContext, resolveRuntimeMiniAgent } = vi.hoisted(() => ({
  formatFullContext: vi.fn(() => "main context"),
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
  getSessionEntries: vi.fn(() => []),
  formatFullContext,
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
      provider: [],
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
  formatFullContext.mockClear();
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
    expect(formatFullContext).not.toHaveBeenCalled();

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
