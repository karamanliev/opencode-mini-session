import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, createSignal } from "solid-js";
import { createOverlaySlot } from "./components/AnswerDialog";
import { parseConfig } from "./config";
import {
  CMD_CHANGE_MODEL,
  CMD_CLOSE,
  CMD_CONTINUE,
  CMD_HIDE,
  CMD_OPEN,
  CMD_OPEN_FRESH,
  CMD_PAGE_DOWN,
  CMD_PAGE_UP,
  CMD_SCROLL_BOTTOM,
  CMD_SCROLL_DOWN,
  CMD_SCROLL_TOP,
  CMD_SCROLL_UP,
  DEFAULT_FRESH_KEYBIND,
  DEFAULT_KEYBIND,
  PLUGIN_ID,
  SCROLL_LINE_DELTA,
  SCROLL_PAGE_DELTA,
} from "./constants";
import { openMiniSession, openModelPicker } from "./session";
import type {
  ActiveDialogController,
  ModelPreference,
  OverlayState,
} from "./types";

const tui: TuiPlugin = async (api, options) => {
  const config = parseConfig(options);
  const keybind = config.keybind || DEFAULT_KEYBIND;
  const freshKeybind = config.freshKeybind || DEFAULT_FRESH_KEYBIND;
  const [overlay, setOverlay] = createSignal<OverlayState | undefined>(
    undefined,
    { equals: false },
  );
  const [selectedModel, setSelectedModel] = createSignal<ModelPreference>(
    undefined,
    { equals: false },
  );
  const [originSessionID, setOriginSessionID] = createSignal<string | undefined>(undefined);
  let activeDialog: ActiveDialogController | undefined;
  let modelPickerOpen = false;

  api.lifecycle.onDispose(() => activeDialog?.close());

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
      { key: keybind, cmd: CMD_HIDE },
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
          }, (onAfterSelect) => openModelPicker(api, config, sessionID, { get: selectedModel, set: setSelectedModel }, () => {
              modelPickerOpen = false;
              onAfterSelect();
            }));
        },
      },
      {
        namespace: "palette",
        name: CMD_OPEN_FRESH,
        title: "mini fresh",
        desc: "Open a fresh mini session without main session context",
        category: "Plugin",
        slashName: "mini-fresh",
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
          }, (onAfterSelect) => openModelPicker(api, config, sessionID, { get: selectedModel, set: setSelectedModel }, () => {
            modelPickerOpen = false;
            onAfterSelect();
          }), true);
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
    bindings: [
      { key: keybind, cmd: CMD_OPEN, desc: "Open a mini session" },
      { key: freshKeybind, cmd: CMD_OPEN_FRESH, desc: "Open a fresh mini session" },
    ],
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
