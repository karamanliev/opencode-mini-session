import { describe, expect, it, vi } from "vitest";
import {
  buildGlobalCommands,
  buildPanelCommands,
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
    continueKeybind: "ctrl+y",
    recapKeybind: false,
    recapScope: "project",
    recapSessions: 15,
    recapScanLimit: 50,
    recapMinScore: 4,
    recapExcludeDirs: [],
  };
}

function actions(
  triggerMiniMode: MiniKeybindActions["triggerMiniMode"] = vi.fn(),
): MiniKeybindActions {
  return {
    config: config(),
    onSession: () => true,
    triggerMiniMode,
    triggerRecap: vi.fn(),
    openModelPicker: vi.fn(),
    hideOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    continueInMainThread: vi.fn(),
    toggleContinueMode: vi.fn(),
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

  it("wires the handoff command with a short visible question", () => {
    const calls: Array<[string, string | undefined, boolean | undefined]> = [];
    const commands = buildGlobalCommands(
      actions((mode, _source, question, handoff) => {
        calls.push([mode, question, handoff]);
      }),
    );

    const handoff = commands.find((command) => command.id === "mini.handoff");
    expect(handoff?.slash).toEqual({ name: "mini-handoff", arguments: true });

    handoff?.run?.("/mini-handoff focus on tests");
    expect(calls[0]).toEqual(["main", "focus on tests", true]);

    handoff?.run?.("/mini-handoff");
    expect(calls[1]).toEqual(["main", "Generate a handoff", true]);
  });
});

describe("panel keymap commands", () => {
  it("toggles the continue mode from the configured keybind", () => {
    const toggleContinueMode = vi.fn();
    const commands = buildPanelCommands({
      ...actions(),
      toggleContinueMode,
    });

    const toggle = commands.find(
      (command) => command.id === "mini.toggle-continue",
    );
    expect(toggle?.bind).toBe("ctrl+y");
    toggle?.run?.();
    expect(toggleContinueMode).toHaveBeenCalledTimes(1);
  });

  it("omits the continue toggle when the keybind is disabled", () => {
    const commands = buildPanelCommands({
      ...actions(),
      config: config(),
    });
    const disabled = buildPanelCommands({
      ...actions(),
      config: { ...config(), continueKeybind: false },
    });

    expect(
      commands.some((command) => command.id === "mini.toggle-continue"),
    ).toBe(true);
    expect(
      disabled.some((command) => command.id === "mini.toggle-continue"),
    ).toBe(false);
  });

  it("wires the recap command", () => {
    const recapCalls: Array<string | undefined> = [];
    const commands = buildGlobalCommands({
      ...actions(),
      triggerRecap: (input) => recapCalls.push(input),
    });

    const command = commands.find((entry) => entry.id === "mini.recap.command");
    expect(command?.slash).toEqual({ name: "mini-recap", arguments: true });
    command?.run?.("/mini-recap mini session");
    expect(recapCalls).toEqual(["/mini-recap mini session"]);

    expect(
      commands.find((entry) => entry.id === "mini.recap.keybind"),
    ).toBeUndefined();
  });

  it("registers the recap keybind when configured", () => {
    const recapCalls: Array<string | undefined> = [];
    const commands = buildGlobalCommands({
      ...actions(),
      config: { ...config(), recapKeybind: "alt+r" },
      triggerRecap: (input) => recapCalls.push(input),
    });

    const keybind = commands.find((entry) => entry.id === "mini.recap.keybind");
    expect(keybind?.bind).toBe("alt+r");
    keybind?.run?.();
    expect(recapCalls).toEqual([undefined]);
  });
});
