import { describe, expect, it } from "vitest";
import { resolveMiniRouteAction } from "../src/routing";

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
});
