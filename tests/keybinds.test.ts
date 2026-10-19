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
    toggleThinkingKeybind: "alt+t",
    tools: ["read"],
    continueKeybind: "alt+y",
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
  it.each(["alt+t", "ctrl+t"])("uses the configured thinking shortcut %s", (bind) => {
    const toggleThinking = vi.fn();
    const commands = buildPanelCommands({
      ...actions(),
      config: { ...config(), toggleThinkingKeybind: bind },
      toggleThinking,
    });
    const command = commands.find(
      (candidate) => candidate.id === "mini.toggle-thinking",
    );

    expect(command?.bind).toBe(bind);
    command?.run?.();
    expect(toggleThinking).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["mini.continue", "shift+return"],
    ["mini.continue.fallback", "alt+c"],
  ])("runs the current continue action through %s", (id, bind) => {
    const continueInMainThread = vi.fn();
    const commands = buildPanelCommands({
      ...actions(),
      continueInMainThread,
    });
    const command = commands.find((candidate) => candidate.id === id);

    expect(command?.bind).toBe(bind);
    command?.run?.();
    expect(continueInMainThread).toHaveBeenCalledTimes(1);
  });

  it.each(["alt+y", "ctrl+y"])("toggles the continue mode from %s", (bind) => {
    const toggleContinueMode = vi.fn();
    const commands = buildPanelCommands({
      ...actions(),
      config: { ...config(), continueKeybind: bind },
      toggleContinueMode,
    });

    const toggle = commands.find(
      (command) => command.id === "mini.toggle-continue",
    );
    expect(toggle?.bind).toBe(bind);
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
});
