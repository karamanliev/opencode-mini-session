import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createRoot } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type { MiniSessionOptions } from "../src/session";
import type { OverlayState, ResolvedModel } from "../src/types";

const {
  createOverlaySlot,
  openMiniSession,
  openModelPicker,
  startAutoUpdate,
} = vi.hoisted(() => ({
  createOverlaySlot: vi.fn((_options: unknown) => () => {}),
  openMiniSession: vi.fn((_options: unknown) => true),
  openModelPicker: vi.fn((..._args: unknown[]) => undefined),
  startAutoUpdate: vi.fn((..._args: unknown[]) => undefined),
}));

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

function controlledPreferences(
  ctx: ReturnType<typeof fakeCtx>,
  initialModel: ResolvedModel | null = null,
) {
  const [preferences, setPreferences] = createStore({
    model: initialModel,
    thinking: false,
    continueMode: "queue",
  });
  const writes: Array<() => void> = [];
  const failures: Array<() => void> = [];
  ctx.storage.store = vi.fn(() => [
    preferences,
    (mutation: (draft: typeof preferences) => void) =>
      new Promise<void>((resolve, reject) => {
        failures.push(() => reject(new Error("storage unavailable")));
        writes.push(() => {
          const draft = structuredClone(unwrap(preferences));
          mutation(draft);
          setPreferences(reconcile(structuredClone(draft)));
          resolve();
        });
      }),
  ]);
  return { preferences, setPreferences, writes, failures };
}

async function flushPreferences() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

afterEach(() => {
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

  it.each([
    { source: "command", visible: true },
    { source: "command", visible: false },
    { source: "keybind", visible: true },
    { source: "keybind", visible: false },
  ])("distinguishes /mini from the handoff hide/resume keybind: %j", async (trigger) => {
    const ctx = fakeCtx();
    let visible = true;
    let current: MiniSessionOptions | undefined;
    const onSubmit = vi.fn(() => true);
    const controller = {
      close: vi.fn(async () => current?.active.set(undefined)),
      hide: vi.fn(() => {
        visible = false;
      }),
      show: vi.fn(() => {
        visible = true;
      }),
      isVisible: () => visible,
    };
    openMiniSession.mockImplementation((options) => {
      current = options as MiniSessionOptions;
      current.active.set(controller);
      current.setOverlay({ state: {}, onSubmit } as unknown as OverlayState);
      visible = true;
      return true;
    });
    const { cleanup, disposeRoot } = await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;

    actions.triggerMiniMode("main", "command", "Generate a handoff", true);
    await flushPreferences();
    visible = trigger.visible;
    actions.triggerMiniMode(
      "main",
      trigger.source,
      trigger.source === "command" ? "ordinary question" : undefined,
    );
    await flushPreferences();

    if (trigger.source === "command") {
      expect(controller.close).toHaveBeenCalledTimes(1);
      expect(openMiniSession).toHaveBeenCalledTimes(2);
      expect(current?.handoff).not.toBe(true);
      expect(current?.initialQuestion).toBe("ordinary question");
      expect(onSubmit).not.toHaveBeenCalled();

      actions.triggerMiniMode("main", "command", "follow-up");
      await flushPreferences();
      expect(openMiniSession).toHaveBeenCalledTimes(2);
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith("follow-up");
    } else {
      expect(openMiniSession).toHaveBeenCalledTimes(1);
      expect(controller.close).not.toHaveBeenCalled();
      expect(visible).toBe(!trigger.visible);
      expect(current?.handoff).toBe(true);
    }
    cleanup();
    disposeRoot();
  });

  it("updates the model preference before the storage write completes", async () => {
    const ctx = fakeCtx();
    ctx.storage.store = vi.fn((_key: string, initial: { initial: any }) => {
      const value = JSON.parse(JSON.stringify(initial.initial));
      return [
        value,
        async (mutation: (draft: any) => void) => {
          await Promise.resolve();
          mutation(value);
        },
      ];
    });
    await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;

    actions.openModelPicker();
    const modelPreference = (openModelPicker.mock.calls[0]?.[3] ?? {}) as any;
    const selection = {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
      variant: "fast",
    };

    modelPreference.set(selection);

    expect(modelPreference.get()).toEqual(selection);
  });

  it("keeps the latest model selection while earlier writes complete", async () => {
    const ctx = fakeCtx();
    const storage = controlledPreferences(ctx);
    const { cleanup, disposeRoot } = await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;
    actions.openModelPicker();
    const preference = openModelPicker.mock.calls[0]?.[3] as any;
    const first = { model: { providerID: "provider", modelID: "first" } };
    const latest = { model: { providerID: "provider", modelID: "latest" } };

    preference.set(first);
    preference.set(latest);
    expect(preference.get()).toEqual(latest);
    await flushPreferences();
    expect(storage.writes).toHaveLength(1);

    storage.writes[0]();
    await flushPreferences();
    expect(preference.get()).toEqual(latest);
    expect(storage.writes).toHaveLength(2);

    storage.writes[1]();
    await flushPreferences();
    expect(preference.get()).toEqual(latest);
    expect(storage.preferences.model).toEqual(latest);
    cleanup();
    disposeRoot();
  });

  it("follows reconciled model fields after a local selection is saved", async () => {
    const ctx = fakeCtx();
    const storage = controlledPreferences(ctx, {
      model: { providerID: "provider", modelID: "initial" },
      variant: "default",
    });
    const { cleanup, disposeRoot } = await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;
    actions.openModelPicker();
    const preference = openModelPicker.mock.calls[0]?.[3] as any;
    const local = {
      model: { providerID: "provider", modelID: "local" },
      variant: "fast",
    };
    preference.set(local);
    await flushPreferences();
    storage.writes[0]();
    await flushPreferences();

    let observed: ResolvedModel | undefined;
    const disposeObserver = createRoot((dispose) => {
      createEffect(() => {
        observed = preference.get();
      });
      return dispose;
    });
    const storedModel = storage.preferences.model;
    const external = {
      model: { providerID: "other", modelID: "external" },
      variant: "high",
    };
    storage.setPreferences("model", reconcile(external));

    expect(storage.preferences.model).toBe(storedModel);
    expect(preference.get()).toEqual(external);
    expect(observed).toEqual(external);

    storage.setPreferences("model", "variant", "low");
    expect(observed?.variant).toBe("low");
    storage.setPreferences("model", null);
    expect(preference.get()).toBeUndefined();
    expect(observed).toBeUndefined();
    disposeObserver();
    cleanup();
    disposeRoot();
  });

  it("keeps a reset to default while an earlier model write completes", async () => {
    const ctx = fakeCtx();
    const storage = controlledPreferences(ctx);
    const { cleanup, disposeRoot } = await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;
    actions.openModelPicker();
    const preference = openModelPicker.mock.calls[0]?.[3] as any;

    preference.set({ model: { providerID: "provider", modelID: "old" } });
    preference.set(undefined);
    await flushPreferences();
    storage.writes[0]();
    await flushPreferences();
    expect(preference.get()).toBeUndefined();

    storage.writes[1]();
    await flushPreferences();
    expect(preference.get()).toBeUndefined();
    expect(storage.preferences.model).toBeNull();
    cleanup();
    disposeRoot();
  });

  it("retains the selected model after a failed save and allows later writes", async () => {
    const ctx = fakeCtx();
    const storage = controlledPreferences(ctx);
    const { cleanup, disposeRoot } = await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;
    actions.openModelPicker();
    const preference = openModelPicker.mock.calls[0]?.[3] as any;
    const selection = { model: { providerID: "provider", modelID: "selected" } };

    preference.set(selection);
    await flushPreferences();
    storage.failures[0]();
    await flushPreferences();
    expect(preference.get()).toEqual(selection);
    expect(ctx.ui.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Failed to save mini model preference." }),
    );

    preference.set(undefined);
    await flushPreferences();
    storage.writes[1]();
    await flushPreferences();
    expect(preference.get()).toBeUndefined();
    expect(storage.preferences.model).toBeNull();
    cleanup();
    disposeRoot();
  });

  it("passes a remembered continue mode to new mini sessions", async () => {
    const ctx = fakeCtx();
    await setupPlugin(ctx);
    const actions = (createOverlaySlot.mock.calls[0]?.[0] as any).actions;

    actions.triggerMiniMode("main", "command");
    await Promise.resolve();
    const options = (openMiniSession.mock.calls[0]?.[0] as any) ?? {};
    expect(options.continuePreference.get()).toBe("queue");

    options.continuePreference.set("clipboard");
    await Promise.resolve();
    expect(options.continuePreference.get()).toBe("clipboard");
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
