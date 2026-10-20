import type { TuiContext } from "./opencode";
import { MiniSettings } from "./rpc";

export async function loadOptions(ctx: TuiContext): Promise<Readonly<Record<string, unknown>>> {
  // Explicit CLI options retain precedence over the server companion.
  if (Object.keys(ctx.options).length) return ctx.options;
  try {
    const options = await ctx.client.rpc(MiniSettings).options({}, {
      location: ctx.location ?? ctx.data.location.default(),
      signal: AbortSignal.timeout(3000),
    });
    return options && typeof options === "object" && !Array.isArray(options)
      ? options as Record<string, unknown>
      : ctx.options;
  } catch {
    // Existing CLI-only installs do not have the server bridge.
    return ctx.options;
  }
}
