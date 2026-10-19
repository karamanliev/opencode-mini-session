import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, untrack } from "solid-js";
import { createOverlaySlot } from "./components/AnswerDialog";
import { parseConfig } from "./config";
import { PLUGIN_ID } from "./constants";
import type { MiniKeybindActions } from "./keybinds";
import { getCurrentRoute } from "./opencode";
import { resolveMiniRouteAction, runMiniRouteAction } from "./routing";
import { openMiniSession, openModelPicker } from "./session";
import type {
  ActiveDialogController,
  ContinueAction,
  ContinuePreferenceState,
  MiniMode,
  ModelPreferenceState,
  OverlayState,
  ResolvedModel,
  ThinkingPreferenceState,
} from "./types";
import { startAutoUpdate } from "./update";

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = parseConfig(ctx.options);
    const [overlay, setOverlay] = createSignal<OverlayState | undefined>(
      undefined,
      { equals: false },
    );
    const [originSessionID, setOriginSessionID] = createSignal<
      string | undefined
    >(undefined);
    const [updateWarning, setUpdateWarning] = createSignal<
      string | undefined
    >(undefined);
    const [preferences, updatePreferences] = ctx.storage.store("preferences", {
      initial: {
        model: null as ResolvedModel | null,
        thinking: config.enableThinking,
        continueMode: "queue" as ContinueAction,
      },
    });
    let activeDialog: ActiveDialogController | undefined;
    let activeMode: MiniMode | undefined;
    let activeHandoff = false;
    let disposed = false;
    const modelPickerOpen = { value: false };

    const [pendingModel, setPendingModel] = createSignal<ResolvedModel | null>();
    let modelWrite = Promise.resolve();
    let modelWriteGeneration = 0;
    const modelPreference: ModelPreferenceState = {
      get: () => {
        const pending = pendingModel();
        if (pending !== undefined) return pending ?? undefined;
        const saved = preferences.model;
        return saved
          ? { ...saved, model: saved.model ? { ...saved.model } : undefined }
          : undefined;
      },
      set: (model) => {
        const generation = ++modelWriteGeneration;
        setPendingModel(model ?? null);
        modelWrite = modelWrite
          .then(() =>
            updatePreferences((draft) => {
              draft.model = model ?? null;
            }),
          )
          .then(() => {
            if (generation === modelWriteGeneration) setPendingModel(undefined);
          })
          .catch(() => {
            ctx.ui.toast.show({
              variant: "warning",
              message: "Failed to save mini model preference.",
            });
          });
      },
    };
    const thinkingPreference: ThinkingPreferenceState = {
      get: () => preferences.thinking,
      set: (enabled) => {
        void updatePreferences((draft) => {
          draft.thinking = enabled;
        });
      },
    };
    const [continueModeValue, setContinueModeValue] =
      createSignal<ContinueAction>(
        preferences.continueMode === "clipboard" ? "clipboard" : "queue",
      );
    const continuePreference: ContinuePreferenceState = {
      get: () => continueModeValue(),
      set: (mode) => {
        setContinueModeValue(mode);
        void updatePreferences((draft) => {
          draft.continueMode = mode;
        });
      },
    };
    createEffect(() => {
      setContinueModeValue(
        preferences.continueMode === "clipboard" ? "clipboard" : "queue",
      );
    });

    const updateController = new AbortController();
    startAutoUpdate(ctx, setUpdateWarning, updateController.signal);

    const actions: MiniKeybindActions = {
      config,
      onSession: () => getCurrentRoute(ctx).kind === "session",
      triggerMiniMode: (mode, source, initialQuestion, handoff) => {
        void triggerMiniMode(mode, source, initialQuestion, handoff);
      },
      openModelPicker: () => {
        const route = getCurrentRoute(ctx);
        if (route.kind !== "session") return;
        openPicker(route.sessionID);
      },
      hideOverlay: () => overlay()?.onHide(),
      closeOverlay: () => {
        if (modelPickerOpen.value) {
          ctx.ui.dialog.clear();
          modelPickerOpen.value = false;
        } else {
          overlay()?.onClose();
        }
      },
      continueInMainThread: () => overlay()?.onContinue(),
      toggleContinueMode: () => overlay()?.onToggleContinue(),
      toggleThinking: () => overlay()?.onToggleThinking(),
      changeModelFromPanel: () => {
        modelPickerOpen.value = true;
        overlay()?.onChangeModel();
      },
      scrollBy: (delta) => overlay()?.scrollBy(delta),
      scrollTo: (position) => overlay()?.scrollTo(position),
    };

    const unregisterSlot = ctx.ui.slot({
      append: "app",
      render: createOverlaySlot({
        ctx,
        getOverlay: overlay,
        actions,
      }),
    });

    createEffect(() => {
      const warning = updateWarning();
      const current = untrack(overlay);
      if (!current || current.state.update === warning) return;
      setOverlay({ ...current, state: { ...current.state, update: warning } });
    });

    createEffect(() => {
      const origin = originSessionID();
      if (!origin) return;
      const route = getCurrentRoute(ctx);
      if (route.kind !== "session" || route.sessionID !== origin) {
        setOriginSessionID(undefined);
        ctx.ui.toast.show({
          variant: "info",
          message: "mini session closed.",
          duration: 1000,
        });
        void activeDialog?.close();
      }
    });

    function openPicker(sessionID: string, onAfterSelect?: () => void) {
      openModelPicker(
        ctx,
        config,
        sessionID,
        modelPreference,
        onAfterSelect,
        (open) => {
          modelPickerOpen.value = open;
        },
      );
    }

    async function triggerMiniMode(
      mode: MiniMode,
      source: "command" | "keybind",
      initialQuestion?: string,
      handoff?: boolean,
    ) {
      const route = getCurrentRoute(ctx);
      if (route.kind !== "session") return;
      const sessionID = route.sessionID;
      const nextAction = resolveMiniRouteAction({
        source,
        requestedMode: mode,
        activeMode,
        isVisible: activeDialog?.isVisible(),
        forceReopen: handoff === true || (source === "command" && activeHandoff),
      });

      await runMiniRouteAction({
        action: nextAction,
        activeDialog,
        open: () => {
          const opened = openMiniSession({
            ctx,
            config,
            mode,
            sessionID,
            setOverlay,
            active: {
              get: () => activeDialog,
              set: (dialog) => {
                activeDialog = dialog;
                if (!dialog) {
                  activeMode = undefined;
                  activeHandoff = false;
                  setOriginSessionID(undefined);
                }
              },
            },
            modelPreference,
            thinkingPreference,
            continuePreference,
            openPickerFn: (onAfterSelect) =>
              openPicker(sessionID, onAfterSelect),
            getUpdateWarning: () => updateWarning(),
            initialQuestion,
            handoff,
            isDisposed: () => disposed,
          });
          if (opened) {
            setOriginSessionID(sessionID);
            activeMode = mode;
            activeHandoff = handoff === true;
          }
        },
      });

      if (initialQuestion && nextAction === "show") {
        overlay()?.onSubmit(initialQuestion);
      }
    }

    return () => {
      disposed = true;
      updateController.abort();
      unregisterSlot();
      void activeDialog?.close();
    };
  },
});
