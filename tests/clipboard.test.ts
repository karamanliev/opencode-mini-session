import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../src/session";

describe("clipboard copy", () => {
  it("delegates to the renderer OSC 52 API when supported", () => {
    const copyToClipboardOSC52 = vi.fn(() => true);
    const renderer = {
      isOsc52Supported: () => true,
      copyToClipboardOSC52,
    };

    expect(copyTextToClipboard({ renderer } as any, "hello world")).toBe(true);
    expect(copyToClipboardOSC52).toHaveBeenCalledWith("hello world");
  });

  it("reports failure when the terminal does not support OSC 52", () => {
    const copyToClipboardOSC52 = vi.fn(() => true);
    const renderer = {
      isOsc52Supported: () => false,
      copyToClipboardOSC52,
    };

    expect(copyTextToClipboard({ renderer } as any, "hello")).toBe(false);
    expect(copyToClipboardOSC52).not.toHaveBeenCalled();
  });

  it("reports failure when the renderer has no OSC 52 API", () => {
    expect(copyTextToClipboard({ renderer: {} } as any, "hello")).toBe(false);
  });
});
