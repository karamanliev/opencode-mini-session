# opencode-mini-session

An OpenCode TUI plugin that opens an interactive mini session for side questions, with full session context and multi-turn conversation.

## What it does

Press `alt+b` (or run `/mini` from the command palette) during any OpenCode session. A popup overlay opens immediately with a text input at the bottom. Type a question and press Enter to send it. The plugin:

1. Gathers context from the current session (token-limited)
2. Creates a temporary isolated session with that context
3. Sends your question to the AI and streams the response
4. Lets you ask follow-up questions in the same mini session
5. Optionally injects the full mini-session transcript back into the main thread
6. Deletes the ephemeral session on close

## Keybinds

### Trigger

| Key | Action |
|---|---|
| `alt+b` (configurable) | Toggle mini session overlay |
| `/mini` | Open mini session (command palette) |
| `/mini-model` | Change model for future mini sessions |

### Inside the mini session

| Key | Action |
|---|---|
| `enter` | Send question / follow-up |
| `alt+b` (configurable) | Hide overlay (resumable) |
| `esc` / `ctrl+c` | Cancel and close |

## Installation

Add the plugin to your OpenCode TUI config (usually `~/.config/opencode/tui.json`):

```json
{
  "plugins": [
    ["/path/to/opencode-mini-session/src/index.ts", {
      "model": null,
      "tokenLimit": 50000,
      "keybind": "alt+b"
    }]
  ]
}
```

Then install dependencies:

```sh
cd /path/to/opencode-mini-session
bun install
```

## Configuration

All options are optional. Defaults are shown below.

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| null` | `null` | Override model as `providerID/modelID` (e.g. `"anthropic/claude-sonnet-4-5"`). `null` auto-detects from current session. |
| `tokenLimit` | `number` | `50000` | Maximum tokens of session context to include. |
| `keybind` | `string \| false` | `"alt+b"` | Global keybind. Set to `false` or `"none"` to disable. |

## Safe tools

The ephemeral session always uses these read-only tools:

- `glob` - file pattern matching
- `grep` - content search
- `read` - file reading
- `list` - directory listing
- `webfetch` - URL fetching