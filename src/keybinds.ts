import type { Keymap, KeymapCommand } from "@opencode/plugin/tui/context";
import {
  CMD_CHANGE_MODEL,
  CMD_CLOSE,
  CMD_CONTINUE,
  CMD_HANDOFF,
  CMD_HIDE,
  CMD_OPEN,
  CMD_OPEN_FRESH,
  CMD_PAGE_DOWN,
  CMD_PAGE_UP,
  CMD_SCROLL_BOTTOM,
  CMD_SCROLL_DOWN,
  CMD_SCROLL_TOP,
  CMD_SCROLL_UP,
  CMD_TOGGLE_FRESH,
  CMD_TOGGLE_MAIN,
  CMD_TOGGLE_THINKING,
  HANDOFF_PROMPT,
  SCROLL_LINE_DELTA,
  SCROLL_PAGE_DELTA,
} from "./constants";
import type { MiniConfig, MiniMode } from "./types";

export type MiniKeybindActions = {
  config: MiniConfig;
  onSession: () => boolean;
  triggerMiniMode: (
    mode: MiniMode,
    source: "command" | "keybind",
    initialQuestion?: string,
    handoff?: boolean,
  ) => void;
  openModelPicker: () => void;
  hideOverlay: () => void;
  closeOverlay: () => void;
  continueInMainThread: () => void;
  toggleThinking: () => void;
  changeModelFromPanel: () => void;
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
};

export function parseSlashQuestion(
  input: string | undefined,
  commandName: string,
) {
  const raw = input?.trim();
  if (!raw) return undefined;

  // Depending on how the host dispatches the slash command, the raw input may
  // still contain the command itself ("/mini question"); strip it defensively.
  const question = raw
    .replace(new RegExp(`^/${commandName}(?:\\s+|$)`, "i"), "")
    .trim();
  return question ? question : undefined;
}

function buildHandoffPrompt(input: string | undefined) {
  const extra = parseSlashQuestion(input, "mini-handoff");
  return extra
    ? `${HANDOFF_PROMPT}\n\nAdditional instructions from the user: ${extra}`
    : HANDOFF_PROMPT;
}

export function buildGlobalCommands(
  actions: MiniKeybindActions,
): KeymapCommand[] {
  const { config, onSession, triggerMiniMode, openModelPicker } = actions;

  return [
    ...(config.keybind
      ? [
          {
            id: CMD_TOGGLE_MAIN,
            title: "Toggle mini session",
            description: "Toggle main mini session",
            group: "Mini session",
            bind: config.keybind,
            enabled: onSession,
            run: () => triggerMiniMode("main", "keybind"),
          } satisfies KeymapCommand,
        ]
      : []),
    ...(config.freshKeybind
      ? [
          {
            id: CMD_TOGGLE_FRESH,
            title: "Toggle mini fresh session",
            description: "Toggle fresh mini session",
            group: "Mini session",
            bind: config.freshKeybind,
            enabled: onSession,
            run: () => triggerMiniMode("fresh", "keybind"),
          } satisfies KeymapCommand,
        ]
      : []),
    {
      id: CMD_OPEN,
      title: "Mini session",
      description:
        "Open a mini session for side questions (/mini <question> asks immediately)",
      group: "Mini session",
      palette: true,
      slash: { name: "mini", arguments: true },
      enabled: onSession,
      run: (input) =>
        triggerMiniMode("main", "command", parseSlashQuestion(input, "mini")),
    },
    {
      id: CMD_OPEN_FRESH,
      title: "Mini session (fresh)",
      description:
        "Open a mini session without copied context (/mini-fresh <question> asks immediately)",
      group: "Mini session",
      palette: true,
      slash: { name: "mini-fresh", arguments: true },
      enabled: onSession,
      run: (input) =>
        triggerMiniMode(
          "fresh",
          "command",
          parseSlashQuestion(input, "mini-fresh"),
        ),
    },
    {
      id: CMD_CHANGE_MODEL,
      title: "Mini session model",
      description: "Change the model for future mini-session questions",
      group: "Mini session",
      palette: true,
      slash: { name: "mini-model" },
      enabled: onSession,
      run: () => openModelPicker(),
    },
    {
      id: CMD_HANDOFF,
      title: "Mini session handoff",
      description:
        "Write a handoff document from this session to paste into a new one (/mini-handoff [instructions])",
      group: "Mini session",
      palette: true,
      slash: { name: "mini-handoff", arguments: true },
      enabled: onSession,
      run: (input) =>
        triggerMiniMode("main", "command", buildHandoffPrompt(input), true),
    },
  ];
}

export function buildPanelCommands(
  actions: MiniKeybindActions,
): KeymapCommand[] {
  const { config } = actions;

  return [
    {
      id: CMD_HIDE,
      title: "Hide mini session",
      group: "Mini session",
      run: () => actions.hideOverlay(),
    },
    {
      id: `${CMD_CLOSE}.escape`,
      title: "Close mini session",
      group: "Mini session",
      bind: "escape",
      run: () => actions.closeOverlay(),
    },
    {
      id: `${CMD_CLOSE}.interrupt`,
      title: "Close mini session (interrupt)",
      group: "Mini session",
      bind: "ctrl+c",
      run: () => actions.closeOverlay(),
    },
    {
      id: CMD_CONTINUE,
      title: "Continue in main thread",
      group: "Mini session",
      bind: "shift+return",
      run: () => actions.continueInMainThread(),
    },
    ...(config.toggleThinkingKeybind
      ? [
          {
            id: CMD_TOGGLE_THINKING,
            title: "Toggle mini thinking blocks",
            group: "Mini session",
            bind: config.toggleThinkingKeybind,
            run: () => actions.toggleThinking(),
          } satisfies KeymapCommand,
        ]
      : []),
    {
      id: `${CMD_CHANGE_MODEL}.panel`,
      title: "Change mini session model",
      group: "Mini session",
      bind: "tab",
      run: () => actions.changeModelFromPanel(),
    },
    {
      id: CMD_PAGE_UP,
      title: "Scroll mini session up",
      group: "Mini session",
      bind: "pageup",
      run: () => actions.scrollBy(-SCROLL_PAGE_DELTA),
    },
    {
      id: CMD_PAGE_DOWN,
      title: "Scroll mini session down",
      group: "Mini session",
      bind: "pagedown",
      run: () => actions.scrollBy(SCROLL_PAGE_DELTA),
    },
    {
      id: CMD_SCROLL_UP,
      title: "Scroll mini session up one line",
      group: "Mini session",
      run: () => actions.scrollBy(-SCROLL_LINE_DELTA),
    },
    {
      id: CMD_SCROLL_DOWN,
      title: "Scroll mini session down one line",
      group: "Mini session",
      run: () => actions.scrollBy(SCROLL_LINE_DELTA),
    },
    {
      id: CMD_SCROLL_TOP,
      title: "Scroll mini session to top",
      group: "Mini session",
      run: () => actions.scrollTo(0),
    },
    {
      id: CMD_SCROLL_BOTTOM,
      title: "Scroll mini session to bottom",
      group: "Mini session",
      run: () => actions.scrollTo(Number.MAX_SAFE_INTEGER),
    },
  ];
}

export function registerGlobalKeymap(
  keymap: Pick<Keymap, "layer">,
  commands: KeymapCommand[],
) {
  keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands,
  }));
}

export function registerPanelKeymap(
  keymap: Pick<Keymap, "layer">,
  commands: KeymapCommand[],
  isOverlayOpen: () => boolean,
) {
  keymap.layer(() => ({
    mode: "global",
    priority: 1000,
    enabled: isOverlayOpen,
    commands,
  }));
}
