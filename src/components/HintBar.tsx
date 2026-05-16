/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

export function HintBar(props: { api: TuiPluginApi; hideKey: string }) {
  const theme = props.api.theme.current;

  const hint = (key: string, label: string) => (
    <box flexDirection="row">
      <text fg={theme.primary}>{key}</text>
      <text fg={theme.textMuted}> {label}</text>
    </box>
  );

  const separator = () => <text fg={theme.textMuted}> · </text>;

  return (
    <box flexDirection="row">
      {hint("enter", "send")}
      {separator()}
      {hint(props.hideKey, "hide")}
      {separator()}
      {hint("esc/ctrl+c", "cancel")}
    </box>
  );
}
