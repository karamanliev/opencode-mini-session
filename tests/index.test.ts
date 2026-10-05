import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

const {
  cleanupStaleMiniSessions,
  createOverlaySlot,
  openMiniSession,
  openModelPicker,
  startAutoUpdate,
} = vi.hoisted(() => ({
  cleanupStaleMiniSessions: vi.fn(async () => 0),
  createOverlaySlot: vi.fn((_options: unknown) => () => {}),
  openMiniSession: vi.fn((_options: unknown) => true),
  openModelPicker: vi.fn((..._args: unknown[]) => undefined),
  startAutoUpdate: vi.fn((..._args: unknown[]) => undefined),
}));

vi.mock("../src/cleanup", async () => {
  const actual =
    await vi.importActual<typeof import("../src/cleanup")>("../src/cleanup");
  return { ...actual, cleanupStaleMiniSessions };
});

vi.mock("../src/update", async () => {
  const actual =
    await vi.importActual<typeof import("../src/update")>("../src/update");
  return { ...actual, startAutoUpdate };
});

vi.mock("../src/session", () => ({
  openMiniSession,
  openModelPicker,
}));

vi.mock("../src/components/AnswerDialog", () => ({
  createOverlaySlot,
}));

import plugin from "../src/index";

function fakeCtx(options: Record<string, unknown> = {}) {
  const storage = new Map<string, any>();
  const ctx = {
    options,
    location: { directory: "/tmp/project" },
    app: { version: "2.0.3", channel: "latest" },
    ui: {
      slot: vi.fn(() => vi.fn()),
      toast: { show: vi.fn() },
      dialog: { clear: vi.fn() },
      router: { current: () => ({ type: "session", sessionID: "session-1" }) },
    },
    keymap: { layer: vi.fn() },
    storage: {
      store: vi.fn((key: string, initial: { initial: any }) => {
        const value =
          storage.get(key) ?? JSON.parse(JSON.stringify(initial.initial));
        storage.set(key, value);
        return [
          value,
          async (mutation: (draft: any) => void) => {
            mutation(value);
          },
        ];
      }),
    },
    client: { session: { list: vi.fn(async () => ({ data: [] })) } },
  } as any;
  return ctx;
}

async function setupPlugin(ctx: ReturnType<typeof fakeCtx>) {
  let cleanup: (() => void) | undefined;
  let disposeRoot: (() => void) | undefined;

  createRoot((dispose) => {
    disposeRoot = dispose;
    void Promise.resolve(plugin.setup(ctx)).then((result) => {
      cleanup = result ?? undefined;
    });
  });

  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  return {
    cleanup: () => cleanup?.(),
    disposeRoot: () => disposeRoot?.(),
  };
}

function slotOptions(ctx: ReturnType<typeof fakeCtx>) {
  return ctx.ui.slot.mock.calls[0]?.[0];
}

afterEach(() => {
  cleanupStaleMiniSessions.mockClear();
  cleanupStaleMiniSessions.mockResolvedValue(0);
  createOverlaySlot.mockClear();
  openMiniSession.mockClear();
  openMiniSession.mockReturnValue(true);
  openModelPicker.mockClear();
  startAutoUpdate.mockClear();
});

describe("plugin setup", () => {
  it("registers the overlay slot with the plugin actions", async () => {
    const ctx = fakeCtx();
    const { cleanup } = await setupPlugin(ctx);

    expect(createOverlaySlot).toHaveBeenCalledTimes(1);
    const call = createOverlaySlot.mock.calls[0]?.[0] as any;
    expect(call.ctx).toBe(ctx);
    expect(typeof call.getOverlay).toBe("function");
    expect(call.actions.config).toBeDefined();

    const claim = slotOptions(ctx);
    expect(claim.append).toBe("app");
    expect(typeof claim.render).toBe("function");

    cleanup();
    expect(ctx.ui.slot.mock.results[0]?.value).toHaveBeenCalledTimes(1);
  });

  it("starts the auto-update check and aborts it on cleanup", async () => {
    const ctx = fakeCtx();
    const { cleanup } = await setupPlugin(ctx);

    expect(startAutoUpdate).toHaveBeenCalledTimes(1);
    const signal = startAutoUpdate.mock.calls[0]?.[2] as AbortSignal;
    expect(signal.aborted).toBe(false);

    cleanup();
    expect(signal.aborted).toBe(true);
  });

  it("cleans up stale sessions and reports the removal count", async () => {
    cleanupStaleMiniSessions.mockResolvedValueOnce(2);
    const ctx = fakeCtx();
    await setupPlugin(ctx);

    expect(cleanupStaleMiniSessions).toHaveBeenCalledWith(ctx);
    expect(ctx.ui.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Cleaned up 2 stale mini sessions.",
      }),
    );
  });

  it("skips the stale cleanup when disabled", async () => {
    const ctx = fakeCtx({ cleanupStaleSessions: false });
    await setupPlugin(ctx);

    expect(cleanupStaleMiniSessions).not.toHaveBeenCalled();
  });

  it("persists model and thinking preferences through storage", async () => {
    const ctx = fakeCtx();
    await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;

    actions.openModelPicker();
    const modelPreference = (openModelPicker.mock.calls[0]?.[3] ?? {}) as any;
    modelPreference.set({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      variant: "fast",
    });
    await Promise.resolve();
    expect(modelPreference.get()).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      variant: "fast",
    });
    modelPreference.set(undefined);
    await Promise.resolve();
    expect(modelPreference.get()).toBeUndefined();

    actions.triggerMiniMode("main", "command");
    await Promise.resolve();
    const thinkingPreference = (
      (openMiniSession.mock.calls[0]?.[0] as any) ?? {}
    ).thinkingPreference;
    thinkingPreference.set(true);
    await Promise.resolve();
    expect(thinkingPreference.get()).toBe(true);
  });
});
