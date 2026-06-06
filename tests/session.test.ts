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

afterEach(() => {
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
