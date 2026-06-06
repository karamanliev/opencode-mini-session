import { describe, expect, it } from "vitest";
import { resolveMiniRouteAction, runMiniRouteAction } from "../src/routing";

describe("mini routing", () => {
  it("opens when no mini session is active", () => {
    expect(
      resolveMiniRouteAction({
        source: "keybind",
        requestedMode: "main",
      }),
    ).toBe("open");
  });

  it("hides the visible active mode from its keybind", () => {
    expect(
      resolveMiniRouteAction({
        source: "keybind",
        requestedMode: "fresh",
        activeMode: "fresh",
        isVisible: true,
      }),
    ).toBe("hide");
  });

  it("shows the hidden active mode from its keybind", () => {
    expect(
      resolveMiniRouteAction({
        source: "keybind",
        requestedMode: "main",
        activeMode: "main",
        isVisible: false,
      }),
    ).toBe("show");
  });

  it("switches when the other mode is requested", () => {
    expect(
      resolveMiniRouteAction({
        source: "keybind",
        requestedMode: "main",
        activeMode: "fresh",
        isVisible: true,
      }),
    ).toBe("switch");
  });

  it("shows instead of hiding when the same command is rerun", () => {
    expect(
      resolveMiniRouteAction({
        source: "command",
        requestedMode: "main",
        activeMode: "main",
        isVisible: true,
      }),
    ).toBe("show");
  });

  it("waits for close before opening the other mode", async () => {
    const events: string[] = [];
    let finishClose: (() => void) | undefined;

    const close = new Promise<void>((resolve) => {
      finishClose = () => {
        events.push("closed");
        resolve();
      };
    });

    const run = runMiniRouteAction({
      action: "switch",
      activeDialog: {
        close: async () => {
          events.push("closing");
          await close;
        },
        hide: () => events.push("hide"),
        show: () => events.push("show"),
      },
      open: () => events.push("open"),
    });

    expect(events).toEqual(["closing"]);
    finishClose?.();
    await run;
    expect(events).toEqual(["closing", "closed", "open"]);
  });
});
