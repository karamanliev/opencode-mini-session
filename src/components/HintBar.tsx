/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

export function HintBar(props: { api: TuiPluginApi; hideKey: string | false }) {
  const theme = props.api.theme.current;
  return <text fg={theme.textMuted}>esc</text>;
}
