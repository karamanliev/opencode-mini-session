import { DEFAULT_ALLOWED_TOOLS, DEFAULT_FRESH_KEYBIND, DEFAULT_FULL_TOKEN_LIMIT, DEFAULT_KEYBIND } from "./constants";
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
    tokenLimit: parsePositiveNumber(
      input.tokenLimit,
      DEFAULT_FULL_TOKEN_LIMIT,
    ),
    keybind: parseKeybind(input.keybind),
    freshKeybind: parseKeybind(input.freshKeybind, DEFAULT_FRESH_KEYBIND),
    allowedTools: parseAllowedTools(input.allowedTools),
  };
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function parseKeybind(value: unknown, fallback = DEFAULT_KEYBIND): string | false {
  if (value === false || value === "none") return false;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseAllowedTools(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}
