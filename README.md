# OpenCode mini session

An OpenCode TUI plugin that opens an interactive mini temporary session for side questions, with full session context and multi-turn conversation.

https://github.com/user-attachments/assets/8201b065-2569-41ba-8eb7-ac2abddad2a5

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
| `tab` | Change the model for the next question |
| `esc` / `ctrl+c` | Cancel and close |

## Installation

Add to your OpenCode TUI config (`~/.config/opencode/tui.json`):

```json
{
  "plugin": [
    ["opencode-mini-session", {
      "model": "anthropic/claude-sonnet-4.6",
      "tokenLimit": 50000,
      "keybind": "alt+b",
      "allowedTools": ["glob", "grep", "read", "list", "webfetch"]
    }]
  ]
}

```

OpenCode installs it automatically with Bun on startup.

## Configuration

All options are optional. Defaults are shown below.

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| null` | `null` | Override model as `providerID/modelID` (e.g. `"anthropic/claude-sonnet-4-5"`). `null` auto-detects from current session. |
| `tokenLimit` | `number` | `50000` | Maximum tokens of session context to include. |
| `keybind` | `string \| false` | `"alt+b"` | Global keybind. Set to `false` or `"none"` to disable. |
| `allowedTools` | `string[] \| null` | `null` | Tools the mini session agent can use. See [Tool access](#tool-access). |

## Tool access

By default the mini session has access to read-only tools: `glob`, `grep`, `list`, `read`, `webfetch`. Use the `allowedTools` config option to change this:

- `null` or omitted: use the default tools listed above
- `[]`: disable all tools
- `["bash", "edit", "read"]`: only the listed tools
- `["*"]`: enable all available tools

To see available tool names, run `opencode debug agent general` and check the `tools` object in the output.

## Session context

The mini session receives the main session's conversation as plain text:

- User questions
- Assistant responses
- Tool calls summarized inline (name + up to 4 input params, e.g. `[tool: read path=src/foo.ts]`)

Oldest messages are dropped to fit the `tokenLimit`, and the result is injected into the system prompt inside `<session-context>` tags.
