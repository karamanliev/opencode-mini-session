# opencode-btw

`/btw` is a local OpenCode TUI plugin for asking quick side questions about the current session without polluting the main conversation history.

## What it does

- Adds `/btw` for a full-context side question
- Adds `/btw-mini` for a recent text-only side question
- Adds `ctrl+shift+b` as a shortcut for `/btw`
- Creates a temporary session for the side question
- Streams the answer into a native OpenCode dialog
- Deletes the temporary session when the dialog is dismissed

## Files

- `tui.tsx`, plugin entrypoint
- `.opencode/plans/btw-plugin.md`, original implementation plan
- `.opencode/plans/btw-plugin-api-addendum.md`, current API notes used during implementation

## Development

Install dependencies:

```bash
npm install
```

Typecheck:

```bash
npm run typecheck
```

## Local OpenCode config

This repo is currently wired into the local OpenCode TUI config from:

`~/.config/opencode/tui.json`

using the file plugin path:

`/home/ico/Projects/personal/opencode-btw/tui.tsx`
