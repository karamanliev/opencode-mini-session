/** @jsxImportSource @opentui/solid */
import { type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { createSignal, type Setter } from "solid-js"

const PLUGIN_ID = "local.opencode-btw"
const CMD_OPEN = "btw.open"
const CMD_CLOSE = "btw.close"
const CMD_CONTINUE = "btw.continue"
const CMD_SCROLL_UP = "btw.scroll-up"
const CMD_SCROLL_DOWN = "btw.scroll-down"
const CMD_PAGE_UP = "btw.page-up"
const CMD_PAGE_DOWN = "btw.page-down"
const CMD_SCROLL_TOP = "btw.scroll-top"
const CMD_SCROLL_BOTTOM = "btw.scroll-bottom"
const CMD_BLOCK_INPUT = "btw.block-input"
const SCROLL_LINE_DELTA = 4
const SCROLL_PAGE_DELTA = 14
const DEFAULT_FULL_TOKEN_LIMIT = 50_000
const DEFAULT_KEYBIND = "ctrl+shift+b"
const THINKING_TEXT = "Thinking..."
const SAFE_TOOLS = {
  glob: true,
  grep: true,
  list: true,
  read: true,
  webfetch: true,
}

type BtwConfig = {
  model: string | null
  fullTokenLimit: number
  keybind: string | false
  allowTools: boolean
}

type SessionEntry = {
  info: Message
  parts: Part[]
}

type ResolvedModel = {
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
}

type ActiveDialog = {
  get: () => (() => Promise<void>) | undefined
  set: (cleanup: (() => Promise<void>) | undefined) => void
}

type AnswerDialogState = {
  entries: SessionEntry[]
  streamingAnswer: string
  loading: boolean
  scrollbarVisible: boolean
  error?: string
}

type MiniPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; text: string; status: string }
  | { type: "meta"; text: string }

type MiniMessage = {
  id: string
  role: Message["role"]
  parts: MiniPart[]
}

type AnswerDialogProps = {
  api: TuiPluginApi
  title: string
  modelName: string
  state: AnswerDialogState
  canContinue: boolean
  onScroller?: (scroller: ScrollBoxRenderable | undefined) => void
  onClose: () => void
  onContinue: () => void
}

type ActionButtonProps = {
  api: TuiPluginApi
  label: string
  primary?: boolean
  disabled?: boolean
  onPress: () => void
}

type OverlayState = Omit<AnswerDialogProps, "state"> & {
  state: AnswerDialogState
  scrollBy: (delta: number) => void
  scrollTo: (position: number) => void
}

const tui: TuiPlugin = async (api, options) => {
  const config = parseConfig(options)
  const [overlay, setOverlay] = createSignal<OverlayState | undefined>(undefined, { equals: false })
  let activeCleanup: (() => Promise<void>) | undefined

  api.lifecycle.onDispose(() => activeCleanup?.())

  api.slots.register({
    slots: {
      app: () => {
        const current = overlay()
        return current ? <AnswerDialog {...current} /> : null
      },
    },
  })

  api.keymap.registerSequencePattern({
    name: "btw-any-key",
    min: 1,
    max: 1,
    match: (event) => ({ value: event.name }),
  })

  api.keymap.registerLayer({
    priority: 1000,
    enabled: () => Boolean(overlay()),
    commands: [
      { name: CMD_CLOSE, run: () => overlay()?.onClose() },
      { name: CMD_CONTINUE, run: () => overlay()?.onContinue() },
      { name: CMD_SCROLL_UP, run: () => overlay()?.scrollBy(-SCROLL_LINE_DELTA) },
      { name: CMD_SCROLL_DOWN, run: () => overlay()?.scrollBy(SCROLL_LINE_DELTA) },
      { name: CMD_PAGE_UP, run: () => overlay()?.scrollBy(-SCROLL_PAGE_DELTA) },
      { name: CMD_PAGE_DOWN, run: () => overlay()?.scrollBy(SCROLL_PAGE_DELTA) },
      { name: CMD_SCROLL_TOP, run: () => overlay()?.scrollTo(0) },
      { name: CMD_SCROLL_BOTTOM, run: () => overlay()?.scrollTo(Number.MAX_SAFE_INTEGER) },
      { name: CMD_BLOCK_INPUT, run: () => undefined },
    ],
    bindings: [
      { key: "escape", cmd: CMD_CLOSE },
      { key: "enter", cmd: CMD_CLOSE },
      { key: "return", cmd: CMD_CLOSE },
      { key: "c", cmd: CMD_CONTINUE },
      { key: "up", cmd: CMD_SCROLL_UP },
      { key: "k", cmd: CMD_SCROLL_UP },
      { key: "down", cmd: CMD_SCROLL_DOWN },
      { key: "j", cmd: CMD_SCROLL_DOWN },
      { key: "pageup", cmd: CMD_PAGE_UP },
      { key: "pagedown", cmd: CMD_PAGE_DOWN },
      { key: "home", cmd: CMD_SCROLL_TOP },
      { key: "end", cmd: CMD_SCROLL_BOTTOM },
      { key: "{btw-any-key}", cmd: CMD_BLOCK_INPUT },
    ],
  })

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: CMD_OPEN,
        title: "btw",
        desc: "Ask a side question with full session context",
        category: "Plugin",
        slashName: "btw",
        enabled: () => api.route.current.name === "session",
        run() {
          void openBtw(api, config, setOverlay, {
            get: () => activeCleanup,
            set: (cleanup) => {
              activeCleanup = cleanup
            },
          })
        },
      },
    ],
    bindings: config.keybind ? [{ key: config.keybind, cmd: CMD_OPEN, desc: "Ask a btw side question" }] : [],
  })
}

function ActionButton(props: ActionButtonProps) {
  const theme = props.api.theme.current
  const backgroundColor = props.disabled
    ? theme.backgroundElement
    : props.primary
      ? theme.primary
      : theme.backgroundElement
  const foregroundColor = props.disabled
    ? theme.textMuted
    : props.primary
      ? theme.selectedListItemText
      : theme.text

  return (
    <box
      backgroundColor={backgroundColor}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={() => {
        if (!props.disabled) props.onPress()
      }}
    >
      <text fg={foregroundColor}>{props.label}</text>
    </box>
  )
}

function HintBar(props: { api: TuiPluginApi }) {
  const theme = props.api.theme.current
  const hint = (key: string, label: string) => (
    <box flexDirection="row">
      <text fg={theme.primary}>{key}</text>
      <text fg={theme.textMuted}> {label}</text>
    </box>
  )
  const separator = () => <text fg={theme.textMuted}> · </text>

  return (
    <box flexDirection="row">
      {hint("c", "continue")}
      {separator()}
      {hint("enter/esc", "close")}
      {separator()}
      {hint("↑/↓", "scroll")}
    </box>
  )
}

function AnswerDialog(props: AnswerDialogProps) {
  const theme = props.api.theme.current
  let scroller: ScrollBoxRenderable | undefined
  const screenWidth = props.api.renderer.width
  const screenHeight = props.api.renderer.height
  const panelWidth = Math.min(100, Math.floor(screenWidth * 0.85))
  const panelHeight = Math.max(12, Math.min(screenHeight - 6, Math.floor(screenHeight * 0.68)))
  const transcriptHeight = Math.max(5, panelHeight - 7)
  const transcriptWidth = Math.max(20, panelWidth - 8)
  const transcriptContentWidth = Math.max(20, transcriptWidth - 5)

  useKeyboard((event: KeyEvent) => {
    if (event.ctrl || event.meta || event.option) return

    switch (event.name) {
      case "escape":
      case "enter":
      case "return":
        props.onClose()
        return
      case "c":
        if (props.canContinue) props.onContinue()
        return
      case "up":
      case "k":
        scroller?.scrollBy(-SCROLL_LINE_DELTA)
        return
      case "down":
      case "j":
        scroller?.scrollBy(SCROLL_LINE_DELTA)
        return
      case "pageup":
        scroller?.scrollBy(-SCROLL_PAGE_DELTA)
        return
      case "pagedown":
        scroller?.scrollBy(SCROLL_PAGE_DELTA)
        return
      case "home":
        scroller?.scrollTo(0)
        return
      case "end":
        scroller?.scrollTo(Number.MAX_SAFE_INTEGER)
        return
    }
  }, {})

  const messages = getMiniMessages(props.state)
  const estimatedContentHeight = estimateMiniMessagesHeight(messages, props.state, transcriptContentWidth) + 4
  if (estimatedContentHeight > transcriptHeight - 2) props.state.scrollbarVisible = true
  const showScrollbar = props.state.scrollbarVisible && !props.state.loading

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={screenWidth}
      height={screenHeight}
      justifyContent="center"
      alignItems="center"
    >
      <box position="absolute" top={0} left={0} width={screenWidth} height={screenHeight} backgroundColor="#000000" opacity={0.65} />
      <box
        width={panelWidth}
        height={panelHeight}
        flexDirection="column"
        gap={1}
        paddingBottom={2}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.backgroundPanel}
        border
        borderColor={theme.border}
      >
          <text fg={theme.text}>
            <b>{props.title}</b>
          </text>
          <HintBar api={props.api} />
          <box border borderColor={theme.backgroundElement} height={transcriptHeight} width={transcriptWidth + 2}>
          <scrollbox
            ref={(node) => {
              scroller = node
              props.onScroller?.(node)
            }}
              height={transcriptHeight - 2}
              width={transcriptWidth}
              scrollY
              stickyScroll={false}
              verticalScrollbarOptions={{ visible: showScrollbar }}
            >
              <box
                flexDirection="column"
                gap={1}
                width={transcriptContentWidth}
                paddingTop={1}
                paddingBottom={0}
                paddingLeft={2}
                paddingRight={2}
              >
                {messages.length > 0
                  ? messages.map((message) => (
                    <box flexDirection="column" gap={0}>
                      <text fg={message.role === "assistant" ? theme.primary : theme.textMuted}>
                        <b>{message.role}</b>
                      </text>
                      {message.parts.map((part, index) => (
                        <box marginTop={getMiniPartTopMargin(message.parts, index)}>
                          <text fg={getMiniPartColor(theme, part)}>{formatMiniPart(part)}</text>
                        </box>
                      ))}
                    </box>
                  ))
                  : <text fg={theme.textMuted}>{THINKING_TEXT}</text>}
                {props.state.error ? <text fg={theme.error}>Error: {props.state.error}</text> : null}
                {props.state.loading && messages.length > 0 ? <text fg={theme.textMuted}>{THINKING_TEXT}</text> : null}
                <box height={1} />
              </box>
            </scrollbox>
          </box>
          <box flexDirection="row" justifyContent="space-between" width={transcriptWidth + 2}>
            <box flexDirection="row" gap={1}>
              <ActionButton
                api={props.api}
                label="Continue In Main Thread"
                primary
                disabled={!props.canContinue}
                onPress={props.onContinue}
              />
              <ActionButton api={props.api} label="Close" onPress={props.onClose} />
            </box>
            <text fg={theme.textMuted}>{props.modelName}</text>
        </box>
      </box>
    </box>
  )
}

function getMiniMessages(state: AnswerDialogState): MiniMessage[] {
  const messages = state.entries.map((entry) => ({
    id: entry.info.id,
    role: entry.info.role,
    parts: entry.parts.map(formatMiniSessionPart).filter((part): part is MiniPart => Boolean(part)),
  })).filter((message) => message.parts.length > 0)

  if (!state.streamingAnswer) return messages

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  if (!lastAssistant) {
    messages.push({
      id: "streaming-assistant",
      role: "assistant",
      parts: [{ type: "text", text: state.streamingAnswer }],
    })
    return messages
  }

  const lastText = [...lastAssistant.parts].reverse().find((part): part is Extract<MiniPart, { type: "text" }> => part.type === "text")
  if (lastText) {
    lastText.text += state.streamingAnswer
  } else {
    lastAssistant.parts.push({ type: "text", text: state.streamingAnswer })
  }

  return messages
}

function estimateMiniMessagesHeight(messages: MiniMessage[], state: AnswerDialogState, width: number) {
  let lines = 0
  for (const message of messages) {
    lines += 1
    for (const part of message.parts) {
      lines += estimateWrappedLines(formatMiniPart(part), width)
    }
    lines += 1
  }
  if (state.error) lines += estimateWrappedLines(`Error: ${state.error}`, width)
  if (state.loading && messages.length > 0) lines += 1
  if (messages.length === 0) lines += 1
  return lines
}

function estimateWrappedLines(text: string, width: number) {
  const lineWidth = Math.max(1, width)
  return text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / lineWidth)), 0)
}

function getMiniPartTopMargin(parts: MiniPart[], index: number) {
  if (index === 0) return 0
  const previous = parts[index - 1]
  const current = parts[index]
  return current.type === "text" && previous.type !== "text" ? 1 : 0
}

function formatMiniSessionPart(part: Part): MiniPart | undefined {
  if (part.type === "text" && part.text.trim()) return { type: "text", text: part.text.trim() }
  if (part.type === "reasoning" && part.text.trim()) return { type: "reasoning", text: part.text.trim() }
  if (part.type === "tool") {
    const title = "title" in part.state && typeof part.state.title === "string" ? part.state.title : part.tool
    const label = title === part.tool ? `${part.tool}` : `${part.tool}: ${title}`
    return { type: "tool", status: part.state.status, text: `${label} ${formatToolState(part)}` }
  }
  if (part.type === "file") return { type: "meta", text: `file: ${part.filename ?? part.url}` }
  if (part.type === "agent") return { type: "meta", text: `agent: ${part.name}` }
  if (part.type === "patch") return { type: "meta", text: `patch: ${part.files.join(", ")}` }
  if (part.type === "retry") return { type: "meta", text: `retry ${part.attempt}` }
  return undefined
}

function formatToolState(part: Extract<Part, { type: "tool" }>) {
  if (part.state.status === "pending") return "queued"
  if (part.state.status === "running") return "running"
  if (part.state.status === "error") return `failed: ${part.state.error}`
  return "completed"
}

function formatMiniPart(part: MiniPart) {
  if (part.type === "reasoning") return `thinking: ${part.text}`
  return part.text
}

function getMiniPartColor(theme: TuiPluginApi["theme"]["current"], part: MiniPart) {
  if (part.type === "reasoning") return theme.textMuted
  if (part.type === "meta") return theme.textMuted
  if (part.type === "tool" && part.status === "error") return theme.error
  if (part.type === "tool" && part.status === "running") return theme.info
  if (part.type === "tool") return theme.textMuted
  return theme.text
}

async function openBtw(api: TuiPluginApi, config: BtwConfig, setOverlay: Setter<OverlayState | undefined>, active: ActiveDialog) {
  const currentRoute = api.route.current

  if (currentRoute.name !== "session") {
    api.ui.toast({ variant: "error", message: "btw only works inside a session." })
    return
  }

  await active.get()?.()

  const { sessionID } = currentRoute.params as { sessionID: string }
  const title = "btw"

  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => api.ui.DialogPrompt(
    {
      title,
      placeholder: "Ask a side question",
      onCancel: () => api.ui.dialog.clear(),
      onConfirm: (value) => {
        const question = value.trim()
        if (!question) {
          api.ui.toast({ variant: "warning", message: "Enter a question first." })
          return
        }
        void startQuestion(api, config, title, sessionID, question, setOverlay, active)
      },
    },
  ))
}

async function startQuestion(
  api: TuiPluginApi,
  config: BtwConfig,
  title: string,
  sessionID: string,
  question: string,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
) {
  const entries = getSessionEntries(api, sessionID)
  const context = formatFullContext(entries, config.fullTokenLimit)
  const system = buildSystemPrompt(context, config.allowTools)
  const resolvedModel = resolveModel(config.model, entries)
  const dialogState: AnswerDialogState = {
    entries: [],
    streamingAnswer: "",
    loading: true,
    scrollbarVisible: false,
  }
  const unsubscribers: Array<() => void> = []
  let tempSessionID: string | undefined
  let closed = false
  let continuing = false
  let renderTimer: ReturnType<typeof setTimeout> | undefined
  let overlayScroller: ScrollBoxRenderable | undefined

  const cleanup = async () => {
    if (closed) return
    closed = true
    if (active.get() === cleanup) active.set(undefined)
    while (unsubscribers.length > 0) {
      try {
        unsubscribers.pop()?.()
      } catch {
      }
    }
    if (renderTimer) clearTimeout(renderTimer)
    setOverlay(undefined)
    if (!tempSessionID) return
    try {
      await api.client.session.delete({ sessionID: tempSessionID }, { throwOnError: true })
    } catch {
    }
  }

  const continueInMainThread = async () => {
    const answer = extractAssistantTextFromEntries(dialogState.entries) || dialogState.streamingAnswer.trim()
    if (continuing || dialogState.loading || dialogState.error || !answer) return
    continuing = true

    try {
      await api.client.session.promptAsync(
        {
          sessionID,
          parts: [{ type: "text", text: buildContinuePrompt(question, answer) }],
        },
        { throwOnError: true },
      )
      api.ui.toast({ variant: "success", message: "Continued in the main thread." })
      await cleanup()
    } catch (cause) {
      api.ui.toast({ variant: "error", message: `Failed to continue in main thread: ${getErrorMessage(cause)}` })
    } finally {
      continuing = false
    }
  }

  const renderOverlay = () => {
    if (closed) return
    if (renderTimer) {
      clearTimeout(renderTimer)
      renderTimer = undefined
    }
    api.ui.dialog.clear()
    setOverlay({
      api,
      title,
      modelName: formatResolvedModel(resolvedModel),
      state: dialogState,
      canContinue: !dialogState.loading && !dialogState.error && Boolean(extractAssistantTextFromEntries(dialogState.entries) || dialogState.streamingAnswer.trim()),
      onScroller: (scroller) => {
        overlayScroller = scroller
      },
      onClose: () => {
        void cleanup()
      },
      onContinue: () => {
        void continueInMainThread()
      },
      scrollBy: (delta) => {
        overlayScroller?.scrollBy(delta)
      },
      scrollTo: (position) => {
        overlayScroller?.scrollTo(position)
      },
    })
  }

  const scheduleRenderOverlay = () => {
    if (closed || renderTimer) return
    renderTimer = setTimeout(() => {
      renderTimer = undefined
      renderOverlay()
    }, 50)
  }

  active.set(cleanup)
  renderOverlay()

  try {
    const created = await api.client.session.create(
      {
        title: "btw (ephemeral)",
        directory: api.state.path.directory,
      },
      {
        throwOnError: true,
      },
    )
    tempSessionID = created.data.id
    const ephemeralSessionID = tempSessionID
    const refreshSession = () => {
      dialogState.entries = getSessionEntries(api, ephemeralSessionID)
      dialogState.streamingAnswer = ""
    }

    if (closed) {
      try {
        await api.client.session.delete({ sessionID: ephemeralSessionID }, { throwOnError: true })
      } catch {
      }
      return
    }

    unsubscribers.push(api.event.on("session.idle", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      refreshSession()
      if (!extractAssistantTextFromEntries(dialogState.entries)) {
        dialogState.streamingAnswer = "No response generated."
      }
      dialogState.loading = false
      renderOverlay()
    }))

    unsubscribers.push(api.event.on("message.updated", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      refreshSession()
      renderOverlay()
    }))

    unsubscribers.push(api.event.on("message.part.delta", (event) => {
      if (event.properties.sessionID !== tempSessionID || event.properties.field !== "text") return
      dialogState.streamingAnswer += event.properties.delta
      scheduleRenderOverlay()
    }))

    unsubscribers.push(api.event.on("message.part.updated", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      refreshSession()
      renderOverlay()
    }))

    unsubscribers.push(api.event.on("session.error", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      dialogState.error = extractErrorMessage(event.properties.error)
      dialogState.loading = false
      renderOverlay()
    }))

    await api.client.session.promptAsync(
      {
        sessionID: ephemeralSessionID,
        system,
        tools: config.allowTools ? { ...SAFE_TOOLS } : {},
        parts: [{ type: "text", text: question }],
        ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
        ...(resolvedModel.variant ? { variant: resolvedModel.variant } : {}),
      },
      { throwOnError: true },
    )
  } catch (cause) {
    dialogState.error = getErrorMessage(cause)
    dialogState.loading = false
    renderOverlay()
  }
}

function buildContinuePrompt(question: string, answer: string) {
  return [
    "Continue the main thread using this side-question context.",
    `Side question:\n${question}`,
    `Side answer:\n${answer}`,
    "Treat the side answer as draft context that you can refine or correct, then continue the main task from here.",
  ].join("\n\n")
}

function parseConfig(options: unknown): BtwConfig {
  const input = options && typeof options === "object" ? (options as Record<string, unknown>) : {}
  return {
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : null,
    fullTokenLimit: parsePositiveNumber(input.fullTokenLimit, DEFAULT_FULL_TOKEN_LIMIT),
    keybind: parseKeybind(input.keybind),
    allowTools: parseBoolean(input.allowTools, true),
  }
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function parseBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function parseKeybind(value: unknown) {
  if (value === false || value === "none") return false
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_KEYBIND
}

function getSessionEntries(api: TuiPluginApi, sessionID: string): SessionEntry[] {
  return api.state.session.messages(sessionID).map((info) => ({
    info,
    parts: [...api.state.part(info.id)],
  }))
}

function formatFullContext(entries: SessionEntry[], tokenLimit: number) {
  const selected: string[] = []
  let usedTokens = 0

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const chunk = formatEntry(entries[index], true)
    if (!chunk) continue

    const estimated = estimateTokens(chunk)
    if (selected.length > 0 && usedTokens + estimated > tokenLimit) break

    selected.push(chunk)
    usedTokens += estimated

    if (usedTokens >= tokenLimit) break
  }

  if (selected.length === 0) return "No conversation context available."
  return selected.reverse().join("\n\n")
}

function formatEntry(entry: SessionEntry, includeTools: boolean) {
  const lines: string[] = []

  for (const part of entry.parts) {
    if (part.type === "text" && part.text.trim()) lines.push(part.text.trim())
    if (includeTools && part.type === "tool") lines.push(formatToolPart(part))
  }

  if (lines.length === 0) return ""
  return `${entry.info.role}:\n${lines.join("\n")}`
}

function formatToolPart(part: Extract<Part, { type: "tool" }>) {
  const pairs = Object.entries(part.state.input ?? {})
    .slice(0, 4)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`)
  return pairs.length > 0 ? `[tool: ${part.tool} ${pairs.join(" ")}]` : `[tool: ${part.tool}]`
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " "), 48)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === "object") return "{...}"
  return String(value)
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.4)
}

function buildSystemPrompt(context: string, allowTools: boolean) {
  const toolNote = allowTools
    ? "You may use the available safe tools if the provided context is not enough, but prefer answering from the session context first."
    : "Do not suggest running commands or reading files; you have no tools."
  const intro = "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see."

  return `${intro} ${toolNote}\n\n<session-context>\n${context}\n</session-context>`
}

function resolveModel(modelOverride: string | null, entries: SessionEntry[]): ResolvedModel {
  if (modelOverride) return { model: parseModelOverride(modelOverride) }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { info } = entries[index]
    if (info.role === "user") {
      return {
        model: {
          providerID: info.model.providerID,
          modelID: info.model.modelID,
        },
        variant: info.model.variant,
      }
    }

    return {
      model: {
        providerID: info.providerID,
        modelID: info.modelID,
      },
      variant: info.variant,
    }
  }

  return {}
}

function parseModelOverride(value: string) {
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function formatResolvedModel(resolved: ResolvedModel) {
  if (!resolved.model) return "default"
  const base = `${resolved.model.providerID}/${resolved.model.modelID}`
  return resolved.variant ? `${base} (${resolved.variant})` : base
}

function extractAssistantTextFromEntries(entries: SessionEntry[]) {
  const chunks: string[] = []
  for (const entry of entries) {
    if (entry.info.role !== "assistant") continue
    for (const part of entry.parts) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text)
    }
  }
  return chunks.join("\n\n").trim()
}

function extractErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const data = "data" in error ? (error as { data?: { message?: unknown } }).data : undefined
    if (data && typeof data.message === "string" && data.message) return data.message
    const name = "name" in error ? (error as { name?: unknown }).name : undefined
    if (typeof name === "string" && name) return name
  }
  return "The side question failed."
}

function getErrorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message) return cause.message
  return extractErrorMessage(cause)
}

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
}

export default plugin
