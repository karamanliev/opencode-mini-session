import { describe, expect, it } from "vitest";
import {
  buildFooterCounterState,
  formatPercent,
  formatTokenCount,
} from "../src/counter";

describe("counter helpers", () => {
  it("formats token counts in compact footer form", () => {
    expect(formatTokenCount(912)).toBe("912");
    expect(formatTokenCount(11_240)).toBe("11.2K");
    expect(formatTokenCount(50_000)).toBe("50.0K");
  });

  it("formats percentages for footer display", () => {
    expect(formatPercent(6.8)).toBe("7%");
    expect(formatPercent(85.1)).toBe("85%");
  });

  it("shows copied context only before the first main-mode response", () => {
    expect(
      buildFooterCounterState({
        mode: "main",
        copiedContextTokens: 31_000,
        tokenLimit: 50_000,
      }),
    ).toEqual({
      copiedContext: {
        usedTokens: 31_000,
        tokenLimit: 50_000,
        text: "31.0K / 50.0K",
        capReached: false,
      },
      miniSession: undefined,
      placeholder: undefined,
    });
  });

  it("shows mini-session and copied-context counters together after completion", () => {
    expect(
      buildFooterCounterState({
        mode: "main",
        copiedContextTokens: 31_000,
        tokenLimit: 50_000,
        lastCompletedMiniInputTokens: 11_240,
        modelContextWindow: 160_000,
      }),
    ).toEqual({
      copiedContext: {
        usedTokens: 31_000,
        tokenLimit: 50_000,
        text: "31.0K / 50.0K",
        capReached: false,
      },
      miniSession: {
        usedTokens: 11_240,
        percentUsed: 7,
        text: "11.2K (7%)",
        warning: false,
        limitReached: false,
      },
      placeholder: undefined,
    });
  });

  it("hides copied context in fresh mode and falls back to absolute mini tokens when needed", () => {
    expect(
      buildFooterCounterState({
        mode: "fresh",
        copiedContextTokens: 31_000,
        tokenLimit: 50_000,
        lastCompletedMiniInputTokens: 11_240,
      }),
    ).toEqual({
      copiedContext: undefined,
      miniSession: {
        usedTokens: 11_240,
        percentUsed: undefined,
        text: "11.2K",
        warning: false,
        limitReached: false,
      },
      placeholder: undefined,
    });
  });

  it("marks copied-context cap and mini-session threshold states", () => {
    expect(
      buildFooterCounterState({
        mode: "main",
        copiedContextTokens: 50_000,
        tokenLimit: 50_000,
        lastCompletedMiniInputTokens: 96_000,
        modelContextWindow: 100_000,
      }),
    ).toEqual({
      copiedContext: {
        usedTokens: 50_000,
        tokenLimit: 50_000,
        text: "50.0K / 50.0K",
        capReached: true,
      },
      miniSession: {
        usedTokens: 96_000,
        percentUsed: 96,
        text: "96.0K (96%)",
        warning: true,
        limitReached: true,
      },
      placeholder: "Session context limit reached...",
    });
  });

  it("applies thresholds using the displayed rounded percentage", () => {
    expect(
      buildFooterCounterState({
        mode: "fresh",
        tokenLimit: 50_000,
        lastCompletedMiniInputTokens: 84_600,
        modelContextWindow: 100_000,
      }).miniSession,
    ).toEqual({
      usedTokens: 84_600,
      percentUsed: 85,
      text: "84.6K (85%)",
      warning: true,
      limitReached: false,
    });
  });
});
