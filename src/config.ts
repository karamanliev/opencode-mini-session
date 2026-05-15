import { DEFAULT_FULL_TOKEN_LIMIT, DEFAULT_KEYBIND } from "./constants";
import type { BtwConfig } from "./types";

export function parseConfig(options: unknown): BtwConfig {
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
