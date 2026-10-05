export const PLUGIN_ID = "opencode-mini-session";

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
export const CMD_HANDOFF = "mini.handoff";
export const CMD_RECAP = "mini.recap";

export const SCROLL_LINE_DELTA = 4;
export const SCROLL_PAGE_DELTA = 14;

export const DEFAULT_FULL_TOKEN_LIMIT = 50_000;
export const DEFAULT_KEYBIND = "alt+b";
export const DEFAULT_FRESH_KEYBIND = "alt+n";
export const DEFAULT_TOGGLE_THINKING_KEYBIND = "ctrl+t";
export const DEFAULT_RECAP_SESSIONS = 15;
export const DEFAULT_RECAP_SCAN_LIMIT = 50;
export const DEFAULT_RECAP_MIN_SCORE = 4;

/**
 * Permission actions the mini agent may be granted. The list is deliberately
 * read-only: everything else is denied for plugin-managed mini sessions.
 * `list` is not a V2 permission action; the `read` tool lists directories.
 */
export const MINI_TOOL_ACTIONS = [
  "read",
  "glob",
  "grep",
  "webfetch",
  "websearch",
] as const;

export const DEFAULT_ALLOWED_TOOLS: string[] = [
  "read",
  "glob",
  "grep",
  "webfetch",
];

/** Session metadata marker used to identify (and clean up) ephemeral mini sessions. */
export const MINI_SESSION_METADATA_KEY = "opencodeMiniSession";

/** Mini sessions older than this are treated as leaked by a crashed client. */
export const STALE_MINI_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Initial question for `/mini-recap`: turns the digest of past sessions into a
 * consolidated project recap.
 */
export const RECAP_PROMPT =
  "You are writing a consolidated recap of a project from several past assistant sessions. The digest of those sessions is provided above: each section has the session title, id, period, directory, the objective, sampled requests with dates, extracted facts (commits, PRs, versions, paths, URLs) and the final reported state. Write the recap from the digest only; do not investigate the workspace and do not call tools. If the digest is empty or insufficient, say so briefly instead of guessing. Produce a concise markdown document with these sections, with the section names and content in the same language as the session content: Objective, Timeline, Decisions, Current state, Open questions, Next steps, Sources (list the sessions used, with id and date). Do not invent details; cite the session and date next to claims when you can; if two sessions disagree, say so explicitly. Reply with the recap document only; do not add an introduction or a closing comment.";

/**
 * Initial question for `/mini-handoff`: turns the copied session context into a
 * document that can be pasted into a fresh session.
 */
export const HANDOFF_PROMPT =
  "You are summarizing an existing work session into a handoff document, so the work can continue in a new session with no memory of this conversation. Write the handoff from the copied session context only; do not investigate the workspace and do not call tools. If the context is empty or insufficient, say so briefly instead of guessing. Produce a concise markdown handoff with: goal and current status, key decisions and why, files/paths/commands involved, verification already done and its result, open questions, and next concrete steps. Reply with the handoff document only, in the same language as the session context; do not add an introduction or a closing comment.";
