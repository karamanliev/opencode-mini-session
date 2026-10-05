import { describe, expect, it, vi } from "vitest";
import {
  buildGlobalCommands,
  parseSlashQuestion,
  type MiniKeybindActions,
} from "../src/keybinds";
import type { MiniConfig } from "../src/types";

function config(): MiniConfig {
  return {
    model: null,
    variant: null,
    agent: null,
    tokenLimit: 50_000,
    keybind: "alt+b",
    freshKeybind: "alt+n",
    enableThinking: false,
    toggleThinkingKeybind: "ctrl+t",
    tools: ["read"],
    continueAction: "queue",
    cleanupStaleSessions: true,
  };
}

function actions(
  triggerMiniMode: MiniKeybindActions["triggerMiniMode"] = vi.fn(),
): MiniKeybindActions {
  return {
    config: config(),
    onSession: () => true,
    triggerMiniMode,
    openModelPicker: vi.fn(),
    hideOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    continueInMainThread: vi.fn(),
    toggleThinking: vi.fn(),
    changeModelFromPanel: vi.fn(),
    scrollBy: vi.fn(),
    scrollTo: vi.fn(),
  };
}

describe("parseSlashQuestion", () => {
  it("trims plain input", () => {
    expect(parseSlashQuestion(undefined, "mini")).toBeUndefined();
    expect(parseSlashQuestion("", "mini")).toBeUndefined();
    expect(parseSlashQuestion("   ", "mini")).toBeUndefined();
    expect(parseSlashQuestion("  explain this  ", "mini")).toBe("explain this");
  });

  it("strips a raw slash command prefix", () => {
    expect(parseSlashQuestion("/mini explain this", "mini")).toBe(
      "explain this",
    );
    expect(parseSlashQuestion("/mini", "mini")).toBeUndefined();
    expect(parseSlashQuestion("/mini   spaced", "mini")).toBe("spaced");
    expect(parseSlashQuestion("/MINI upper", "mini")).toBe("upper");
    expect(parseSlashQuestion("/mini-fresh one two", "mini-fresh")).toBe(
      "one two",
    );
    expect(parseSlashQuestion("/minix not stripped", "mini")).toBe(
      "/minix not stripped",
    );
    expect(parseSlashQuestion("/mini-fresh x", "mini")).toBe("/mini-fresh x");
  });
});

describe("global keymap commands", () => {
  it("wires slash commands with argument parsing", () => {
    const calls: Array<[string, string | undefined]> = [];
    const commands = buildGlobalCommands(
      actions((mode, _source, question) => {
        calls.push([mode, question]);
      }),
    );

    const open = commands.find((command) => command.id === "mini.open");
    expect(open?.slash).toEqual({ name: "mini", arguments: true });
    open?.run?.("/mini hello");
    expect(calls).toEqual([["main", "hello"]]);

    const fresh = commands.find((command) => command.id === "mini.open-fresh");
    expect(fresh?.slash).toEqual({ name: "mini-fresh", arguments: true });
    fresh?.run?.("/mini-fresh hi");
    expect(calls).toEqual([
      ["main", "hello"],
      ["fresh", "hi"],
    ]);
  });

  it("wires the handoff command with the base prompt and extra instructions", () => {
    const calls: Array<[string, string | undefined, boolean | undefined]> = [];
    const commands = buildGlobalCommands(
      actions((mode, _source, question, handoff) => {
        calls.push([mode, question, handoff]);
      }),
    );

    const handoff = commands.find((command) => command.id === "mini.handoff");
    expect(handoff?.slash).toEqual({ name: "mini-handoff", arguments: true });

    handoff?.run?.("/mini-handoff focus on tests");
    expect(calls[0]?.[0]).toBe("main");
    expect(calls[0]?.[2]).toBe(true);
    expect(calls[0]?.[1]).toContain("handoff document");
    expect(calls[0]?.[1]).toContain(
      "Additional instructions from the user: focus on tests",
    );

    handoff?.run?.("/mini-handoff");
    expect(calls[1]?.[1]).toContain("handoff document");
    expect(calls[1]?.[1]).not.toContain("Additional instructions");
  });
});
