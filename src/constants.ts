export const PLUGIN_ID = "local.opencode-mini-session";

export const CMD_OPEN = "mini.open";
export const CMD_OPEN_FRESH = "mini.open-fresh";
export const CMD_TOGGLE_MAIN = "mini.toggle-main";
export const CMD_TOGGLE_FRESH = "mini.toggle-fresh";
export const CMD_HIDE = "mini.hide";
export const CMD_CLOSE = "mini.close";
export const CMD_CONTINUE = "mini.continue";
export const CMD_CHANGE_MODEL = "mini.change-model";
export const CMD_TOGGLE_THINKING = "mini.toggle-thinking";
export const CMD_SCROLL_UP = "mini.scroll-up";
export const CMD_SCROLL_DOWN = "mini.scroll-down";
export const CMD_PAGE_UP = "mini.page-up";
export const CMD_PAGE_DOWN = "mini.page-down";
export const CMD_SCROLL_TOP = "mini.scroll-top";
export const CMD_SCROLL_BOTTOM = "mini.scroll-bottom";

export const SCROLL_LINE_DELTA = 4;
export const SCROLL_PAGE_DELTA = 14;

export const DEFAULT_FULL_TOKEN_LIMIT = 50_000;
export const DEFAULT_KEYBIND = "alt+b";
export const DEFAULT_FRESH_KEYBIND = "alt+n";
export const DEFAULT_TOGGLE_THINKING_KEYBIND = "ctrl+t";
export const THINKING_TEXT = "Thinking...";

export const SAFE_TOOLS = {
  glob: true,
  grep: true,
  list: true,
  read: true,
  webfetch: true,
};

export const DEFAULT_ALLOWED_TOOLS = Object.keys(SAFE_TOOLS);
