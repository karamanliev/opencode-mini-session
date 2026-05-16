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

  return (
    <box
      backgroundColor={
        props.disabled
          ? theme.backgroundElement
          : props.primary
            ? theme.primary
            : theme.backgroundElement
      }
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      <text
        fg={
          props.disabled
            ? theme.textMuted
            : props.primary
              ? theme.selectedListItemText
              : theme.text
        }
      >
        {props.label}
      </text>
    </box>
  );
}
