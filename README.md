# OpenCode mini session

An OpenCode TUI plugin that opens interactive temporary mini sessions for side questions, either with injected main-session context or as a fresh no-context thread.

https://github.com/user-attachments/assets/8201b065-2569-41ba-8eb7-ac2abddad2a5

## What it does

The mini session runs as an overlay alongside the main session without blocking it, so you can ask side questions while the main thread continues working.

Press `alt+b` for the default mini mode, or `alt+n` for a fresh mini mode with no copied conversation context. You can also run `/mini` or `/mini-fresh` from the command palette during any OpenCode session. Type a question in the mini session dialog and send it. The plugin:

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
| `alt+b` (configurable) | Toggle main mini session overlay |
| `alt+n` (configurable) | Toggle fresh mini session overlay |
| `/mini` | Open mini session with copied session context |
| `/mini-fresh` | Open mini session with no copied session context |
| `/mini-model` | Change model for future mini sessions |

### Inside the mini session

| Key | Action |
|---|---|
| `enter` | Send question / follow-up |
| `shift+enter` | Inject mini transcript into the main thread |
| `alt+b` or `alt+n` (configurable) | Hide overlay, resumable |
| `ctrl+t` (configurable) | Toggle thinking blocks |
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
| `variant` | `string \| null` | `null` | Optional variant for the configured mini model, for example `"high"`. |
| `agent` | `string \| null` | `null` | `null` or omitted uses plugin-managed mini mode. A string uses an existing OpenCode agent by name. |
| `tokenLimit` | `number` | `50000` | Maximum tokens of session context to include. |
| `keybind` | `string \| false` | `"alt+b"` | Main mini-session keybind. Set to `false` or `"none"` to disable. |
| `freshKeybind` | `string \| false` | `"alt+n"` | Fresh mini-session keybind. Set to `false` or `"none"` to disable. |
| `enableThinking` | `boolean` | `false` | Show thinking blocks collapsed by default. |
| `toggleThinkingKeybind` | `string \| false` | `"ctrl+t"` | Thinking toggle keybind inside the mini session. Set to `false` or `"none"` to disable. |
| ~`allowedTools`~ | `string[] \| null` | `null` | Deprecated. Use custom OpenCode agents for custom permissions. |

If you want to customize the plugin, your config should look something like this:

```json
{
  "plugin": [
    ["opencode-mini-session", {
      "model": "anthropic/claude-sonnet-4.6",
      "variant": "high",
      "tokenLimit": 10000,
      "keybind": "alt+m",
      "freshKeybind": "alt+f",
      "enableThinking": true,
      "toggleThinkingKeybind": "alt+a",
      "agent": "build"
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

Fresh mini mode skips this copied-context step entirely.

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
