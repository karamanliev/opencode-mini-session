import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, untrack } from "solid-js";
import { cleanupStaleMiniSessions } from "./cleanup";
import { createOverlaySlot } from "./components/AnswerDialog";
import { parseConfig } from "./config";
import { PLUGIN_ID, RECAP_PROMPT } from "./constants";
import type { MiniKeybindActions } from "./keybinds";
import { getCurrentRoute } from "./opencode";
import { fallbackRecapTerm, parseRecapQuery } from "./recap";
import { resolveMiniRouteAction, runMiniRouteAction } from "./routing";
import { openMiniSession, openModelPicker } from "./session";
import type {
  ActiveDialogController,
  MiniMode,
  ModelPreference,
  ModelPreferenceState,
  OverlayState,
  RecapQuery,
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
      },
    });
    let activeDialog: ActiveDialogController | undefined;
    let activeMode: MiniMode | undefined;
    let disposed = false;
    const modelPickerOpen = { value: false };

    const modelPreference: ModelPreferenceState = {
      get: () => preferences.model ?? undefined,
      set: (model) => {
        void updatePreferences((draft) => {
          draft.model = model ?? null;
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

    const updateController = new AbortController();
    startAutoUpdate(ctx, setUpdateWarning, updateController.signal);

    if (config.cleanupStaleSessions) {
      void cleanupStaleMiniSessions(ctx)
        .then((removed) => {
          if (removed === 0) return;
          ctx.ui.toast.show({
            variant: "info",
            message: `Cleaned up ${removed} stale mini session${
              removed === 1 ? "" : "s"
            }.`,
            duration: 3000,
          });
        })
        .catch(() => {});
    }

    const actions: MiniKeybindActions = {
      config,
      onSession: () => getCurrentRoute(ctx).kind === "session",
      triggerMiniMode: (mode, source, initialQuestion, handoff, recap) => {
        void triggerMiniMode(mode, source, initialQuestion, handoff, recap);
      },
      triggerRecap: (input) => {
        const route = getCurrentRoute(ctx);
        if (route.kind !== "session") return;
        const query = parseRecapQuery(
          input,
          fallbackRecapTerm(ctx.location?.directory),
        );
        void triggerMiniMode("recap", "command", RECAP_PROMPT, false, query);
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
      recap?: RecapQuery,
    ) {
      const route = getCurrentRoute(ctx);
      if (route.kind !== "session") return;
      const sessionID = route.sessionID;
      const nextAction = resolveMiniRouteAction({
        source,
        requestedMode: mode,
        activeMode,
        isVisible: activeDialog?.isVisible(),
        forceReopen: handoff === true || recap !== undefined,
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
                  setOriginSessionID(undefined);
                }
              },
            },
            modelPreference,
            thinkingPreference,
            openPickerFn: (onAfterSelect) =>
              openPicker(sessionID, onAfterSelect),
            getUpdateWarning: () => updateWarning(),
            initialQuestion,
            handoff,
            recap,
            isDisposed: () => disposed,
          });
          if (opened) {
            setOriginSessionID(sessionID);
            activeMode = mode;
          }
        },
      });

      if (initialQuestion && nextAction !== "open") {
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
