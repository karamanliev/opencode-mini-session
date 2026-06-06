import type { MiniMode } from "./types";

export type MiniTriggerSource = "command" | "keybind";
export type MiniRouteAction = "open" | "show" | "hide" | "switch";

type MiniRouteController = {
  close: () => Promise<void>;
  hide: () => void;
  show: () => void;
};

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

export async function runMiniRouteAction(options: {
  action: MiniRouteAction;
  activeDialog?: MiniRouteController;
  open: () => void;
}) {
  if (options.action === "hide") {
    options.activeDialog?.hide();
    return;
  }

  if (options.action === "show") {
    options.activeDialog?.show();
    return;
  }

  if (options.action === "switch") {
    await options.activeDialog?.close();
  }

  options.open();
}
