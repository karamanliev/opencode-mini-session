import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part } from "@opencode-ai/sdk/v2";
import type { SessionEntry } from "./types";

export function getSessionEntries(
  api: TuiPluginApi,
  sessionID: string,
): SessionEntry[] {
  return api.state.session.messages(sessionID).map((info) => ({
    info,
    parts: [...api.state.part(info.id)],
  }));
}

export function formatFullContext(entries: SessionEntry[], tokenLimit: number) {
  const selected: string[] = [];
  let usedTokens = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const chunk = formatEntry(entries[index]);
    if (!chunk) continue;

    const estimated = estimateTokens(chunk);
    if (selected.length > 0 && usedTokens + estimated > tokenLimit) break;

    selected.push(chunk);
    usedTokens += estimated;

    if (usedTokens >= tokenLimit) break;
  }

  if (selected.length === 0) return "No conversation context available.";
  return selected.reverse().join("\n\n");
}

function formatEntry(entry: SessionEntry) {
  const lines: string[] = [];

  for (const part of entry.parts) {
    if (part.type === "text" && part.text.trim()) lines.push(part.text.trim());
    if (part.type === "tool") lines.push(formatToolPart(part));
  }

  if (lines.length === 0) return "";
  return `${entry.info.role}:\n${lines.join("\n")}`;
}

function formatToolPart(part: Extract<Part, { type: "tool" }>) {
  const pairs = Object.entries(part.state.input ?? {})
    .slice(0, 4)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`);
  return pairs.length > 0
    ? `[tool: ${part.tool} ${pairs.join(" ")}]`
    : `[tool: ${part.tool}]`;
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " "), 48);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return "{...}";
  return String(value);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.4);
}
