import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { createOverlaySlot } from "./components/AnswerDialog";
import { parseConfig } from "./config";
import {
  CMD_BLOCK_INPUT,
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
  PLUGIN_ID,
  SCROLL_LINE_DELTA,
  SCROLL_PAGE_DELTA,
} from "./constants";
import { openBtw, openModelPicker } from "./session";
import type {
  ActiveDialogController,
  ModelPreference,
  OverlayState,
} from "./types";

const tui: TuiPlugin = async (api, options) => {
  const config = parseConfig(options);
  const [overlay, setOverlay] = createSignal<OverlayState | undefined>(
    undefined,
    { equals: false },
  );
  const [selectedModel, setSelectedModel] = createSignal<ModelPreference>(
    undefined,
    { equals: false },
  );
  let activeDialog: ActiveDialogController | undefined;

  api.lifecycle.onDispose(() => activeDialog?.close());

  api.slots.register({
    slots: { app: createOverlaySlot(overlay) },
  });

  api.keymap.registerSequencePattern({
    name: "btw-any-key",
    min: 1,
    max: 1,
    match: (event) => ({ value: event.name }),
  });

  api.keymap.registerLayer({
    priority: 1000,
    enabled: () => Boolean(overlay()),
    commands: [
      { name: CMD_HIDE, run: () => overlay()?.onHide() },
      { name: CMD_CLOSE, run: () => overlay()?.onClose() },
      { name: CMD_CONTINUE, run: () => overlay()?.onContinue() },
      { name: CMD_SCROLL_UP, run: () => overlay()?.scrollBy(-SCROLL_LINE_DELTA) },
      { name: CMD_SCROLL_DOWN, run: () => overlay()?.scrollBy(SCROLL_LINE_DELTA) },
      { name: CMD_PAGE_UP, run: () => overlay()?.scrollBy(-SCROLL_PAGE_DELTA) },
      { name: CMD_PAGE_DOWN, run: () => overlay()?.scrollBy(SCROLL_PAGE_DELTA) },
      { name: CMD_SCROLL_TOP, run: () => overlay()?.scrollTo(0) },
      {
        name: CMD_SCROLL_BOTTOM,
        run: () => overlay()?.scrollTo(Number.MAX_SAFE_INTEGER),
      },
      { name: CMD_BLOCK_INPUT, run: () => undefined },
    ],
    bindings: [
      { key: "h", cmd: CMD_HIDE },
      { key: "escape", cmd: CMD_CLOSE },
      { key: "enter", cmd: CMD_CLOSE },
      { key: "return", cmd: CMD_CLOSE },
      { key: "c", cmd: CMD_CONTINUE },
      { key: "up", cmd: CMD_SCROLL_UP },
      { key: "k", cmd: CMD_SCROLL_UP },
      { key: "down", cmd: CMD_SCROLL_DOWN },
      { key: "j", cmd: CMD_SCROLL_DOWN },
      { key: "pageup", cmd: CMD_PAGE_UP },
      { key: "pagedown", cmd: CMD_PAGE_DOWN },
      { key: "home", cmd: CMD_SCROLL_TOP },
      { key: "end", cmd: CMD_SCROLL_BOTTOM },
      { key: "{btw-any-key}", cmd: CMD_BLOCK_INPUT },
    ],
  });

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: CMD_OPEN,
        title: "btw",
        desc: "Ask a side question with full session context",
        category: "Plugin",
        slashName: "btw",
        enabled: () => api.route.current.name === "session",
        run() {
          void openBtw(api, config, setOverlay, {
            get: () => activeDialog,
            set: (dialog) => {
              activeDialog = dialog;
            },
          }, {
            get: selectedModel,
            set: setSelectedModel,
          });
        },
      },
      {
        namespace: "palette",
        name: CMD_CHANGE_MODEL,
        title: "btw model",
        desc: "Change the model for future btw side questions",
        category: "Plugin",
        slashName: "btw-model",
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
    bindings: config.keybind
      ? [{ key: config.keybind, cmd: CMD_OPEN, desc: "Ask a btw side question" }]
      : [],
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
