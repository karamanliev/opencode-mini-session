import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Accessor } from "solid-js";
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
  CMD_SUBMIT,
  CMD_TOGGLE_FRESH,
  CMD_TOGGLE_MAIN,
  CMD_TOGGLE_THINKING,
  SCROLL_LINE_DELTA,
  SCROLL_PAGE_DELTA,
} from "./constants";
import type { MiniConfig, MiniMode, OverlayState } from "./types";

export type PanelAction = {
  cmd: string;
  key?: string;
  run: () => void;
};

export type MiniCommand = {
  cmd: string;
  title: string;
  desc?: string;
  category?: string;
  slashName?: string;
  keybind?: string;
  keybindDesc?: string;
  enabled?: () => boolean;
  hidden?: boolean;
  run: () => void;
};

export type KeybindContext = {
  api: TuiPluginApi;
  config: MiniConfig;
  overlay: Accessor<OverlayState | undefined>;
  modelPickerOpen: { get: () => boolean; set: (v: boolean) => void };
  triggerMiniMode: (mode: MiniMode, source: "command" | "keybind") => Promise<void>;
  openModelPicker: () => void;
};

export function buildPanelActions(ctx: KeybindContext, legacy = false): PanelAction[] {
  const { api, config, overlay, modelPickerOpen } = ctx;

  const closePanel = () => {
    if (modelPickerOpen.get()) {
      api.ui.dialog.clear();
      modelPickerOpen.set(false);
    } else {
      overlay()?.onClose();
    }
  };

  return [
    { cmd: CMD_HIDE, run: () => overlay()?.onHide() },
    { cmd: CMD_CLOSE, key: "escape", run: closePanel },
    { cmd: CMD_CLOSE, key: "ctrl+c", run: closePanel },
    { cmd: CMD_CONTINUE, key: "shift+return", run: () => overlay()?.onContinue() },
    ...(legacy
      ? [{ cmd: CMD_SUBMIT, key: "return", run: () => overlay()?.submit() }]
      : []),
    ...(config.toggleThinkingKeybind
      ? [
          {
            cmd: CMD_TOGGLE_THINKING,
            key: config.toggleThinkingKeybind,
            run: () => overlay()?.onToggleThinking(),
          },
        ]
      : []),
    {
      cmd: CMD_CHANGE_MODEL,
      key: "tab",
      run: () => {
        modelPickerOpen.set(true);
        overlay()?.onChangeModel();
      },
    },
    { cmd: CMD_SCROLL_UP, run: () => overlay()?.scrollBy(-SCROLL_LINE_DELTA) },
    { cmd: CMD_SCROLL_DOWN, run: () => overlay()?.scrollBy(SCROLL_LINE_DELTA) },
    { cmd: CMD_PAGE_UP, key: "pageup", run: () => overlay()?.scrollBy(-SCROLL_PAGE_DELTA) },
    { cmd: CMD_PAGE_DOWN, key: "pagedown", run: () => overlay()?.scrollBy(SCROLL_PAGE_DELTA) },
    { cmd: CMD_SCROLL_TOP, run: () => overlay()?.scrollTo(0) },
    { cmd: CMD_SCROLL_BOTTOM, run: () => overlay()?.scrollTo(Number.MAX_SAFE_INTEGER) },
  ];
}

export function buildGlobalCommands(ctx: KeybindContext): MiniCommand[] {
  const { config, triggerMiniMode, openModelPicker } = ctx;
  const onSession = () => ctx.api.route.current.name === "session";

  return [
    ...(config.keybind
      ? [
          {
            cmd: CMD_TOGGLE_MAIN,
            title: "Toggle mini session",
            keybind: config.keybind,
            keybindDesc: "Toggle main mini session",
            run: () => void triggerMiniMode("main", "keybind"),
          },
        ]
      : []),
    ...(config.freshKeybind
      ? [
          {
            cmd: CMD_TOGGLE_FRESH,
            title: "Toggle mini fresh session",
            keybind: config.freshKeybind,
            keybindDesc: "Toggle fresh mini session",
            run: () => void triggerMiniMode("fresh", "keybind"),
          },
        ]
      : []),
    {
      cmd: CMD_OPEN,
      title: "mini",
      desc: "Open a mini session for side questions",
      category: "Plugin",
      slashName: "mini",
      enabled: onSession,
      run: () => void triggerMiniMode("main", "command"),
    },
    {
      cmd: CMD_OPEN_FRESH,
      title: "mini fresh",
      desc: "Open a mini session without copied context",
      category: "Plugin",
      slashName: "mini-fresh",
      enabled: onSession,
      run: () => void triggerMiniMode("fresh", "command"),
    },
    {
      cmd: CMD_CHANGE_MODEL,
      title: "mini model",
      desc: "Change the model for future mini-session questions",
      category: "Plugin",
      slashName: "mini-model",
      enabled: onSession,
      run: openModelPicker,
    },
  ];
}

export function registerKeymapPanelLayer(
  api: TuiPluginApi,
  actions: PanelAction[],
  isOverlayOpen: () => boolean,
) {
  const commands: { name: string; run: () => void }[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    if (!seen.has(a.cmd)) {
      seen.add(a.cmd);
      commands.push({ name: a.cmd, run: a.run });
    }
  }

  api.keymap.registerLayer({
    priority: 1000,
    enabled: isOverlayOpen,
    commands,
    bindings: actions
      .filter((a) => a.key)
      .map((a) => ({ key: a.key!, cmd: a.cmd })),
  });
}

export function registerKeymapGlobalLayer(
  api: TuiPluginApi,
  commands: MiniCommand[],
) {
  api.keymap.registerLayer({
    commands: commands.map((c) => {
      if (c.slashName) {
        return {
          namespace: "palette" as const,
          name: c.cmd,
          title: c.title,
          desc: c.desc,
          category: c.category,
          slashName: c.slashName,
          enabled: c.enabled,
          run: c.run,
        };
      }
      return { name: c.cmd, run: c.run };
    }),
    bindings: commands
      .filter((c) => c.keybind)
      .map((c) => ({
        key: c.keybind!,
        cmd: c.cmd,
        ...(c.keybindDesc ? { desc: c.keybindDesc } : {}),
      })),
  });
}

export function registerLegacyGlobalCommands(
  api: TuiPluginApi,
  commands: MiniCommand[],
): () => void {
  return api.command!.register(() =>
    commands.map((c) => ({
      title: c.title,
      value: c.cmd,
      ...(c.desc ? { description: c.desc } : {}),
      ...(c.category ? { category: c.category } : {}),
      ...(c.slashName ? { slash: { name: c.slashName } } : {}),
      ...(c.keybind ? { keybind: c.keybind } : {}),
      hidden: c.hidden ?? !c.slashName,
      ...(c.enabled ? { enabled: c.enabled() } : {}),
      onSelect: c.run,
    })),
  );
}

export function registerLegacyPanelKeybinds(
  api: TuiPluginApi,
  actions: PanelAction[],
): () => void {
  const bound = actions.filter((a) => a.key);
  return api.command!.register(() =>
    bound.map((a) => ({
      title: a.cmd,
      value: `${a.cmd}:${a.key}`,
      keybind: a.key!,
      hidden: true as const,
      onSelect: a.run,
    })),
  );
}
