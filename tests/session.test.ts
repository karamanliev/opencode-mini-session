import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveRuntimeMiniAgent } = vi.hoisted(() => ({
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
  formatFullContext: vi.fn(() => "main context"),
}));

import { startQuestion } from "../src/session";
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
        delete: vi.fn(),
      },
    },
  } as any;
}

afterEach(() => {
  resolveRuntimeMiniAgent.mockReset();
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
});
