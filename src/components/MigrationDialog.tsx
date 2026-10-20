import { createSignal, For } from "solid-js";
import { migrationDialogText, type MigrationChoice } from "../migration-dialog";
import { adaptTheme, type TuiContext } from "../opencode";

export function showMigrationDialog(
  ctx: TuiContext,
  paths: { cli: string; server: string },
): Promise<MigrationChoice | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice?: MigrationChoice) => {
      if (settled) return;
      settled = true;
      resolve(choice);
      ctx.ui.dialog.clear();
    };
    ctx.ui.dialog.show(
      () => <MigrationDialog ctx={ctx} paths={paths} finish={finish} />,
      () => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      },
    );
    ctx.ui.dialog.set({ size: "large" });
  });
}

function MigrationDialog(props: {
  ctx: TuiContext;
  paths: { cli: string; server: string };
  finish: (choice?: MigrationChoice) => void;
}) {
  const text = migrationDialogText(props.paths.server);
  const theme = adaptTheme(props.ctx.theme);
  const [selected, setSelected] = createSignal(0);
  const move = (delta: number) =>
    setSelected((index) => (index + delta + text.choices.length) % text.choices.length);

  props.ctx.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
      { bind: "return", run: () => props.finish(text.choices[selected()].value) },
      { bind: "escape", run: () => props.finish() },
    ],
  }));

  return (
    <box flexDirection="column" padding={2} gap={1}>
      <text fg={theme.text}><b>{text.title}</b></text>
      <text fg={theme.text}>{text.explanation}</text>
      <box flexDirection="column">
        <text fg={theme.textMuted}>From: {props.ctx.ui.format.path(props.paths.cli)}</text>
        <text fg={theme.textMuted}>To: {props.ctx.ui.format.path(props.paths.server)}</text>
      </box>
      <For each={text.choices}>
        {(choice, index) => (
          <box flexDirection="column" onMouseUp={() => props.finish(choice.value)}>
            <text fg={selected() === index() ? theme.primary : theme.text}>
              {selected() === index() ? "> " : "  "}<b>{choice.title}</b>
            </text>
            <text fg={theme.textMuted}>  {choice.description}</text>
          </box>
        )}
      </For>
      <text fg={theme.textMuted}>Up/Down to choose · Enter to confirm · Esc for not now</text>
    </box>
  );
}
