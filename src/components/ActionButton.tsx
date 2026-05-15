/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

type ActionButtonProps = {
  api: TuiPluginApi;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function ActionButton(props: ActionButtonProps) {
  const theme = props.api.theme.current;

  const backgroundColor = props.disabled
    ? theme.backgroundElement
    : props.primary
      ? theme.primary
      : theme.backgroundElement;

  const foregroundColor = props.disabled
    ? theme.textMuted
    : props.primary
      ? theme.selectedListItemText
      : theme.text;

  return (
    <box
      backgroundColor={backgroundColor}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      <text fg={foregroundColor}>{props.label}</text>
    </box>
  );
}
