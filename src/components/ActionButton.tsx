/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { Show } from "solid-js";

type ActionButtonProps = {
  api: TuiPluginApi;
  label: string;
  keybind?: string;
  disabled?: boolean;
  onPress: () => void;
};

export function ActionButton(props: ActionButtonProps) {
  const theme = props.api.theme.current;

  return (
    <box
      flexDirection="row"
      onMouseUp={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      <text fg={props.disabled ? theme.textMuted : theme.text}>
        <b>{props.label}</b>
      </text>
      <Show when={props.keybind}>
        <text fg={theme.textMuted}> {props.keybind}</text>
      </Show>
    </box>
  );
}
