import { describe, expect, it } from "vitest";
import { buildCopiedContext, estimateTokens, formatFullContext } from "../src/context";
import type { SessionEntry } from "../src/types";

function entry(role: "user" | "assistant", text: string): SessionEntry {
  return {
    info: { id: `${role}-${text}`, role } as SessionEntry["info"],
    parts: [{ type: "text", text }],
  } as SessionEntry;
}

describe("copied context", () => {
  it("returns text and estimated token usage together", () => {
    const entries = [entry("user", "hello"), entry("assistant", "world")];

    expect(buildCopiedContext(entries, 50)).toEqual({
      text: "user:\nhello\n\nassistant:\nworld",
      usedTokens: estimateTokens("user:\nhello\n\nassistant:\nworld"),
    });
  });

  it("keeps whole-message newest-first selection behavior", () => {
    const older = entry("user", "old message that should be dropped");
    const newer = entry("assistant", "newest message stays");

    expect(buildCopiedContext([older, newer], estimateTokens("assistant:\nnewest message stays"))).toEqual({
      text: "assistant:\nnewest message stays",
      usedTokens: estimateTokens("assistant:\nnewest message stays"),
    });
  });

  it("preserves the oversized newest message edge case", () => {
    const newest = entry("assistant", "x".repeat(200));

    const result = buildCopiedContext([newest], 10);

    expect(result.text).toBe(`assistant:\n${"x".repeat(200)}`);
    expect(result.usedTokens).toBeGreaterThan(10);
  });

  it("keeps formatFullContext behavior stable", () => {
    const entries = [entry("user", "hello")];
    expect(formatFullContext(entries, 50)).toBe("user:\nhello");
  });
});
