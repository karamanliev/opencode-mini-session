import { Plugin } from "@opencode/plugin";
import { PLUGIN_ID } from "./constants";
import { MiniSettings } from "./rpc";

// Package inventory supplies version and update controls for the TUI companion.
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    await ctx.rpc.register(MiniSettings, { options: async () => ctx.options });
  },
});
