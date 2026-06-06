import type { MiniMode } from "./types";

export type MiniTriggerSource = "command" | "keybind";
export type MiniRouteAction = "open" | "show" | "hide" | "switch";

export function resolveMiniRouteAction(options: {
  source: MiniTriggerSource;
  requestedMode: MiniMode;
  activeMode?: MiniMode;
  isVisible?: boolean;
}): MiniRouteAction {
  if (!options.activeMode) return "open";
  if (options.activeMode !== options.requestedMode) return "switch";
  if (options.isVisible === false) return "show";
  return options.source === "keybind" ? "hide" : "show";
}
