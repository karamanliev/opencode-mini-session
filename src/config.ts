import { DEFAULT_FULL_TOKEN_LIMIT, DEFAULT_KEYBIND } from "./constants";
import type { MiniConfig } from "./types";

export function parseConfig(options: unknown): MiniConfig {
  const input =
    options && typeof options === "object"
      ? (options as Record<string, unknown>)
      : {};
  return {
    model:
      typeof input.model === "string" && input.model.trim()
        ? input.model.trim()
        : null,
    agent: parseAgent(input.agent),
    tokenLimit: parsePositiveNumber(
      input.tokenLimit,
      DEFAULT_FULL_TOKEN_LIMIT,
    ),
    keybind: parseKeybind(input.keybind),
    allowedTools: parseAllowedTools(input.allowedTools),
    allowedToolsProvided: Object.hasOwn(input, "allowedTools"),
  };
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function parseKeybind(value: unknown): string | false {
  if (value === false || value === "none") return false;
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_KEYBIND;
}

function parseAgent(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAllowedTools(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}
