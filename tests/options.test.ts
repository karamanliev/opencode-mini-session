import { describe, expect, it, vi } from "vitest";
import { loadOptions } from "../src/options";
import type { TuiContext } from "../src/opencode";

describe("server companion options", () => {
  function context(options: Record<string, unknown>, response: () => Promise<unknown>) {
    const call = vi.fn(response);
    const rpc = vi.fn(() => ({ options: call }));
    const ctx = {
      options,
      location: { directory: "/project" },
      client: { rpc },
    } as unknown as TuiContext;
    return { ctx, call, rpc };
  }

  it("uses server options for automatically loaded TUI companions", async () => {
    const options = { agent: "custom", enableThinking: false };
    const f = context({}, async () => options);
    expect(await loadOptions(f.ctx)).toEqual(options);
    expect(f.call).toHaveBeenCalledWith({}, expect.objectContaining({ location: { directory: "/project" } }));
  });

  it("preserves explicit CLI options without requesting server settings", async () => {
    const options = { agent: "local" };
    const f = context(options, async () => ({ agent: "server" }));
    expect(await loadOptions(f.ctx)).toEqual(options);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("keeps old CLI-only installations working without a server entrypoint", async () => {
    const f = context({}, async () => { throw new Error("RPC not found"); });
    expect(await loadOptions(f.ctx)).toEqual({});
  });

  it.each([null, [], "invalid"])("ignores invalid bridge responses: %s", async (response) => {
    const f = context({}, async () => response);
    expect(await loadOptions(f.ctx)).toEqual({});
  });
});
