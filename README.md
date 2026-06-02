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
| `shift+enter` | Inject mini transcript into the main thread |
| `alt+b` (configurable) | Hide overlay (resumable) |
| `tab` | Change the model for the next question |
| `esc` / `ctrl+c` | Cancel and close |

## Installation

Add to your OpenCode TUI config (`~/.config/opencode/tui.json`):

```json
{
  "plugin": [
    "opencode-mini-session"
  ]
}
```

OpenCode installs it automatically with Bun on startup.

## Configuration

All options are optional. Defaults are shown below.

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| null` | `null` | Override model as `providerID/modelID`, for example `"anthropic/claude-sonnet-4.6"`. `null` auto-detects from the current session. |
| `agent` | `string \| null` | `null` | `null` or omitted uses plugin-managed mini mode. A string uses an existing OpenCode agent by name. |
| `tokenLimit` | `number` | `50000` | Maximum tokens of session context to include. |
| `keybind` | `string \| false` | `"alt+b"` | Global keybind. Set to `false` or `"none"` to disable. |
| ~`allowedTools`~ | `string[] \| null` | `null` | Deprecated. Use custom OpenCode agents for custom permissions. |

If you want to customize the plugin, your config should look something like this:

```json
{
  "plugin": [
    ["opencode-mini-session", {
      "model": "anthropic/claude-sonnet-4.6",
      "tokenLimit": 10000,
      "keybind": "alt+m",
      "agent": "build",
      ...
    }]
  ]
}
```

## Agents and permissions

If `agent` is not set or is invalid, mini uses a plugin managed custom mini agent with read only tools: `glob`, `grep`, `list`, `read`, and `webfetch`.

To customize permissions, tone, instructions, or other behavior, set `agent` to an existing OpenCode agent name. The plugin will use that agent's settings directly.

See the [OpenCode agent docs](https://opencode.ai/docs/agents/) for more info on custom agent setup.

For example, configure mini to use a custom `pirate` agent:

```json
{
  "plugin": [
    ["opencode-mini-session", { "agent": "pirate" }]
  ]
}
```

![Mini session using a custom pirate agent](.github/pirate.png)

## Session context

The mini session receives the main session's conversation as plain text:

- User questions
- Assistant responses
- Tool calls summarized inline (name + up to 4 input params, e.g. `[tool: read path=src/foo.ts]`)

Oldest messages are dropped to fit the `tokenLimit`, and the result is injected into the system prompt inside `<session-context>` tags.

## Troubleshooting

### Force update from older versions

Older versions may stay cached by OpenCode. To force a fresh install, close OpenCode, remove the cached npm plugin package, then start OpenCode again.

Linux and macOS:

```sh
rm -rf ~/.cache/opencode/node_modules/opencode-mini-session
opencode
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force "$HOME\.cache\opencode\node_modules\opencode-mini-session"
opencode
```

For more information, see the official OpenCode docs for [npm plugins and plugin cache](https://opencode.ai/docs/plugins/#how-plugins-are-installed) and [configuration locations](https://opencode.ai/docs/config/#locations).
