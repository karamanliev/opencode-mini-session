# opencode-btw-plus

An OpenCode TUI plugin that lets you ask ephemeral side questions without losing context in the main session.

## What it does

Press `alt+b` (or run `/btw` from the command palette) during any OpenCode session. A dialog prompts for your question. The plugin:

1. Gathers context from the current session (token-limited)
2. Creates a temporary isolated session with that context
3. Sends your question to the AI
4. Shows the answer in a scrollable overlay dialog
5. Optionally injects the Q&A back into the main thread (press `c`)
6. Deletes the ephemeral session on close

If you hide the answer dialog, pressing `alt+b` or running `/btw` shows the same in-flight window again.

## Installation

Add the plugin to your OpenCode TUI config (usually `~/.config/opencode/tui.json`):

```json
{
  "plugins": [
    ["/path/to/opencode-btw/src/index.ts", {
      "model": null,
      "tokenLimit": 50000,
      "keybind": "alt+b"
    }]
  ]
}
```

Then install dependencies:

```sh
cd /path/to/opencode-btw
bun install
```

## Configuration

All options are optional. Defaults are shown below.

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| null` | `null` | Override model as `providerID/modelID` (e.g. `"anthropic/claude-sonnet-4-5"`). `null` auto-detects from current session. |
| `tokenLimit` | `number` | `50000` | Maximum tokens of session context to include. |
| `keybind` | `string \| false` | `"alt+b"` | Global keybind. Set to `false` or `"none"` to disable. |

The `model` option controls the default model. Run `/btw-model` to choose a different model for future side questions. This choice lasts only until OpenCode restarts.

## Keybinds

### Trigger

| Key | Action |
|---|---|
| `alt+b` | Open btw prompt |
| `/btw` | Open btw prompt (command palette) |
| `/btw-model` | Change model for future `btw` questions |

### Inside the answer dialog

| Key | Action |
|---|---|
| `esc` / `enter` | Close dialog |
| `h` | Hide dialog without stopping the session |
| `c` | Continue in main thread (only when answer is ready) |
| `up` / `k` | Scroll up 4 lines |
| `down` / `j` | Scroll down 4 lines |
| `pageup` | Scroll up 14 lines |
| `pagedown` | Scroll down 14 lines |
| `home` | Scroll to top |
| `end` | Scroll to bottom |

## Safe tools

The ephemeral session always uses these read-only tools:

- `glob` - file pattern matching
- `grep` - content search
- `read` - file reading
- `list` - directory listing
- `webfetch` - URL fetching
