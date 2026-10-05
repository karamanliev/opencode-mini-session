import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_FRESH_KEYBIND,
  DEFAULT_FULL_TOKEN_LIMIT,
  DEFAULT_KEYBIND,
  DEFAULT_RECAP_MIN_SCORE,
  DEFAULT_RECAP_SCAN_LIMIT,
  DEFAULT_RECAP_SESSIONS,
  DEFAULT_TOGGLE_THINKING_KEYBIND,
  MINI_TOOL_ACTIONS,
} from "./constants";
import type { MiniConfig } from "./types";

export function parseConfig(options: unknown): MiniConfig {
  const input =
    options && typeof options === "object"
      ? (options as Record<string, unknown>)
      : {};
  return {
    model: parseStringOption(input.model),
    variant: parseStringOption(input.variant),
    agent: parseStringOption(input.agent),
    tokenLimit: parsePositiveNumber(
      input.tokenLimit,
      DEFAULT_FULL_TOKEN_LIMIT,
    ),
    keybind: parseKeybind(input.keybind, DEFAULT_KEYBIND),
    freshKeybind: parseKeybind(input.freshKeybind, DEFAULT_FRESH_KEYBIND),
    enableThinking:
      typeof input.enableThinking === "boolean" ? input.enableThinking : false,
    toggleThinkingKeybind: parseKeybind(
      input.toggleThinkingKeybind,
      DEFAULT_TOGGLE_THINKING_KEYBIND,
    ),
    tools: parseTools(input.tools),
    continueAction:
      input.continueAction === "clipboard" ? "clipboard" : "queue",
    cleanupStaleSessions: input.cleanupStaleSessions !== false,
    recapKeybind: parseKeybind(input.recapKeybind, false),
    recapScope: input.recapScope === "all" ? "all" : "project",
    recapSessions: parsePositiveNumber(
      input.recapSessions,
      DEFAULT_RECAP_SESSIONS,
    ),
    recapScanLimit: parsePositiveNumber(
      input.recapScanLimit,
      DEFAULT_RECAP_SCAN_LIMIT,
    ),
    recapMinScore: parseNonNegativeNumber(
      input.recapMinScore,
      DEFAULT_RECAP_MIN_SCORE,
    ),
    recapExcludeDirs: parseStringList(input.recapExcludeDirs),
  };
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function parseNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function parseKeybind(
  value: unknown,
  fallback: string | false,
): string | false {
  if (value === false) return false;
  if (typeof value !== "string") return fallback;
  const keybind = value.trim();
  if (!keybind) return fallback;
  return keybind === "none" ? false : keybind;
}

function parseStringOption(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ALLOWED_TOOLS];

  const allowed = new Set<string>(MINI_TOOL_ACTIONS);
  const tools = [
    ...new Set(
      value
        .filter((tool): tool is string => typeof tool === "string")
        .map((tool) => tool.trim())
        .filter((tool) => allowed.has(tool)),
    ),
  ];

  return tools.length > 0 ? tools : [...DEFAULT_ALLOWED_TOOLS];
}
