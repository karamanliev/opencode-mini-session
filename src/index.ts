import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, createSignal, untrack } from "solid-js";
import { createOverlaySlot } from "./components/AnswerDialog";
import { parseConfig } from "./config";
import {
  CMD_CHANGE_MODEL,
  CMD_CLOSE,
  CMD_CONTINUE,
  CMD_HIDE,
  CMD_OPEN,
  CMD_PAGE_DOWN,
  CMD_PAGE_UP,
  CMD_SCROLL_BOTTOM,
  CMD_SCROLL_DOWN,
  CMD_SCROLL_TOP,
  CMD_SCROLL_UP,
  CMD_TOGGLE_THINKING,
  PLUGIN_ID,
  SCROLL_LINE_DELTA,
  SCROLL_PAGE_DELTA,
} from "./constants";
import { openMiniSession, openModelPicker } from "./session";
import type {
  ActiveDialogController,
  ModelPreference,
  OverlayState,
  ThinkingPreferenceState,
} from "./types";
import { startAutoUpdate } from "./update";

const tui: TuiPlugin = async (api, options, meta) => {
  const config = parseConfig(options);
  const keybind = config.keybind;
  const [overlay, setOverlay] = createSignal<OverlayState | undefined>(
    undefined,
    { equals: false },
  );
  const [selectedModel, setSelectedModel] = createSignal<ModelPreference>(
    undefined,
    { equals: false },
  );
  const [thinkingEnabled, setThinkingEnabled] = createSignal(
    config.enableThinking,
  );
  const [originSessionID, setOriginSessionID] = createSignal<string | undefined>(undefined);
  const [updateWarning, setUpdateWarning] = createSignal<string | undefined>(undefined);
  let activeDialog: ActiveDialogController | undefined;
  let modelPickerOpen = false;
  const thinkingPreference: ThinkingPreferenceState = {
    get: thinkingEnabled,
    set: setThinkingEnabled,
  };

  api.lifecycle.onDispose(() => activeDialog?.close());
  startAutoUpdate(api, meta, setUpdateWarning);

  createEffect(() => {
    const warning = updateWarning();
    const current = untrack(overlay);
    if (!current || current.state.update === warning) return;
    setOverlay({ ...current, state: { ...current.state, update: warning } });
  });

  createEffect(() => {
    const origin = originSessionID();
    if (!origin) return;
    const route = api.route.current;
    if (route.name !== "session" || (route.params as { sessionID: string } | undefined)?.sessionID !== origin) {
      setOriginSessionID(undefined);
      api.ui.toast({
        variant: "info",
        message: "mini session closed.",
        duration: 1000,
      });
      void activeDialog?.close();
    }
  });

  api.slots.register({
    slots: { app: createOverlaySlot(overlay) },
  });

  api.keymap.registerLayer({
    priority: 1000,
    enabled: () => Boolean(overlay()),
    commands: [
      { name: CMD_HIDE, run: () => overlay()?.onHide() },
      {
        name: CMD_CLOSE,
        run: () => {
          if (modelPickerOpen) {
            api.ui.dialog.clear();
            modelPickerOpen = false;
          } else {
            overlay()?.onClose();
          }
        },
      },
      { name: CMD_CONTINUE, run: () => overlay()?.onContinue() },
      { name: CMD_TOGGLE_THINKING, run: () => overlay()?.onToggleThinking() },
      {
        name: CMD_CHANGE_MODEL,
        run: () => {
          modelPickerOpen = true;
          overlay()?.onChangeModel();
        },
      },
      { name: CMD_SCROLL_UP, run: () => overlay()?.scrollBy(-SCROLL_LINE_DELTA) },
      { name: CMD_SCROLL_DOWN, run: () => overlay()?.scrollBy(SCROLL_LINE_DELTA) },
      { name: CMD_PAGE_UP, run: () => overlay()?.scrollBy(-SCROLL_PAGE_DELTA) },
      { name: CMD_PAGE_DOWN, run: () => overlay()?.scrollBy(SCROLL_PAGE_DELTA) },
      { name: CMD_SCROLL_TOP, run: () => overlay()?.scrollTo(0) },
      {
        name: CMD_SCROLL_BOTTOM,
        run: () => overlay()?.scrollTo(Number.MAX_SAFE_INTEGER),
      },
    ],
    bindings: [
      ...(keybind ? [{ key: keybind, cmd: CMD_HIDE }] : []),
      ...(config.toggleThinkingKeybind
        ? [{ key: config.toggleThinkingKeybind, cmd: CMD_TOGGLE_THINKING }]
        : []),
      { key: "shift+enter", cmd: CMD_CONTINUE },
      { key: "tab", cmd: CMD_CHANGE_MODEL },
      { key: "escape", cmd: CMD_CLOSE },
      { key: "ctrl+c", cmd: CMD_CLOSE },
      { key: "pageup", cmd: CMD_PAGE_UP },
      { key: "pagedown", cmd: CMD_PAGE_DOWN },
    ],
  });

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: CMD_OPEN,
        title: "mini",
        desc: "Open a mini session for side questions",
        category: "Plugin",
        slashName: "mini",
        enabled: () => api.route.current.name === "session",
        run() {
          const currentRoute = api.route.current;
          if (currentRoute.name !== "session") return;
          const { sessionID } = currentRoute.params as { sessionID: string };
          if (!activeDialog) setOriginSessionID(sessionID);
          void openMiniSession(api, config, setOverlay, {
            get: () => activeDialog,
            set: (dialog) => {
              activeDialog = dialog;
              if (!dialog) setOriginSessionID(undefined);
            },
          }, {
            get: selectedModel,
            set: setSelectedModel,
          }, thinkingPreference, (onAfterSelect) => openModelPicker(api, config, sessionID, { get: selectedModel, set: setSelectedModel }, () => {
              modelPickerOpen = false;
              onAfterSelect();
            }), updateWarning);
        },
      },
      {
        namespace: "palette",
        name: CMD_CHANGE_MODEL,
        title: "mini model",
        desc: "Change the model for future mini-session questions",
        category: "Plugin",
        slashName: "mini-model",
        enabled: () => api.route.current.name === "session",
        run() {
          const currentRoute = api.route.current;
          if (currentRoute.name !== "session") return;
          const { sessionID } = currentRoute.params as { sessionID: string };
          openModelPicker(api, config, sessionID, {
            get: selectedModel,
            set: setSelectedModel,
          });
        },
      },
    ],
    bindings: keybind
      ? [{ key: keybind, cmd: CMD_OPEN, desc: "Open a mini session" }]
      : [],
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
