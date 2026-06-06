/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { For } from "solid-js";

export type HintBarItem = {
  keybind: string | false;
  label: string;
};

export function HintBar(props: {
  api: TuiPluginApi;
  items: HintBarItem[];
}) {
  const theme = props.api.theme.current;

  return (
    <box flexDirection="row" gap={2}>
      <For each={props.items.filter((item) => item.keybind)}>
        {(item) => (
          <text fg={theme.textMuted}>
            <b>{item.keybind}</b> {item.label}
          </text>
        )}
      </For>
    </box>
  );
}
