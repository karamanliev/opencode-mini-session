/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Message, Part } from "@opencode-ai/sdk/v2"

const PLUGIN_ID = "local.opencode-btw"
const CMD_OPEN = "btw.open"
const CMD_OPEN_MINI = "btw.open-mini"
const DEFAULT_FULL_TOKEN_LIMIT = 50_000
const DEFAULT_MINI_MESSAGE_LIMIT = 6
const DEFAULT_KEYBIND = "ctrl+shift+b"
const SPINNER_FRAMES = [".", "..", "...", "...."]

type Mode = "full" | "mini"

type BtwConfig = {
  model: string | null
  fullTokenLimit: number
  miniMessageLimit: number
  streamAnswer: boolean
  keybind: string | false
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
  answer: string
  loading: boolean
  error?: string
  spinnerFrame: number
}

const tui: TuiPlugin = async (api, options) => {
  const config = parseConfig(options)
  let activeCleanup: (() => Promise<void>) | undefined

  api.lifecycle.onDispose(() => activeCleanup?.())

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
          void openBtw(api, config, "full", {
            get: () => activeCleanup,
            set: (cleanup) => {
              activeCleanup = cleanup
            },
          })
        },
      },
      {
        namespace: "palette",
        name: CMD_OPEN_MINI,
        title: "btw-mini",
        desc: "Ask a side question with recent text-only context",
        category: "Plugin",
        slashName: "btw-mini",
        enabled: () => api.route.current.name === "session",
        run() {
          void openBtw(api, config, "mini", {
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

async function openBtw(api: TuiPluginApi, config: BtwConfig, mode: Mode, active: ActiveDialog) {
  const currentRoute = api.route.current

  if (currentRoute.name !== "session") {
    api.ui.toast({ variant: "error", message: "btw only works inside a session." })
    return
  }

  await active.get()?.()

  const { sessionID } = currentRoute.params as { sessionID: string }
  const title = mode === "full" ? "btw" : "btw-mini"

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
        void startQuestion(api, config, mode, title, sessionID, question, active)
      },
    },
  ))
}

async function startQuestion(
  api: TuiPluginApi,
  config: BtwConfig,
  mode: Mode,
  title: string,
  sessionID: string,
  question: string,
  active: ActiveDialog,
) {
  const entries = getSessionEntries(api, sessionID)
  const context = mode === "full"
    ? formatFullContext(entries, config.fullTokenLimit)
    : formatMiniContext(entries, config.miniMessageLimit)
  const system = buildSystemPrompt(mode, context)
  const resolvedModel = resolveModel(config.model, entries)
  const dialogState: AnswerDialogState = {
    answer: "",
    loading: true,
    spinnerFrame: 0,
  }
  const textParts = new Map<string, string>()
  const partOrder: string[] = []
  const unsubscribers: Array<() => void> = []
  let tempSessionID: string | undefined
  let spinnerTimer: ReturnType<typeof setInterval> | undefined
  let closed = false

  const syncAnswer = () => partOrder.map((id) => textParts.get(id) ?? "").filter(Boolean).join("\n\n")
  const renderDialog = () => {
    if (closed) return
    api.ui.dialog.setSize("large")
    api.ui.dialog.replace(() => api.ui.DialogAlert({
      title,
      message: formatAnswerMessage(question, dialogState),
      onConfirm: () => {
        void cleanup()
      },
    }))
  }

  const cleanup = async () => {
    if (closed) return
    closed = true
    if (active.get() === cleanup) active.set(undefined)
    if (spinnerTimer) clearInterval(spinnerTimer)
    while (unsubscribers.length > 0) {
      try {
        unsubscribers.pop()?.()
      } catch {
      }
    }
    api.ui.dialog.clear()
    if (!tempSessionID) return
    try {
      await api.client.session.delete({ sessionID: tempSessionID }, { throwOnError: true })
    } catch {
    }
  }

  active.set(cleanup)
  spinnerTimer = setInterval(() => {
    if (closed || !dialogState.loading || dialogState.answer || dialogState.error) return
    dialogState.spinnerFrame = (dialogState.spinnerFrame + 1) % SPINNER_FRAMES.length
    renderDialog()
  }, 250)
  renderDialog()

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

    if (closed) {
      try {
        await api.client.session.delete({ sessionID: ephemeralSessionID }, { throwOnError: true })
      } catch {
      }
      return
    }

    unsubscribers.push(api.event.on("message.part.delta", (event) => {
      if (!config.streamAnswer) return
      if (event.properties.sessionID !== tempSessionID) return
      if (event.properties.field !== "text") return

      if (!textParts.has(event.properties.partID)) partOrder.push(event.properties.partID)
      textParts.set(event.properties.partID, `${textParts.get(event.properties.partID) ?? ""}${event.properties.delta}`)
      dialogState.answer = syncAnswer()
      renderDialog()
    }))

    unsubscribers.push(api.event.on("message.part.updated", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      if (event.properties.part.type !== "text") return

      const part = event.properties.part
      if (!textParts.has(part.id)) partOrder.push(part.id)
      textParts.set(part.id, part.text)

      if (config.streamAnswer) {
        dialogState.answer = syncAnswer()
        renderDialog()
      }
    }))

    unsubscribers.push(api.event.on("session.idle", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      const finalAnswer = extractAssistantText(api, tempSessionID) || syncAnswer()
      dialogState.answer = finalAnswer || "No response generated."
      dialogState.loading = false
      renderDialog()
    }))

    unsubscribers.push(api.event.on("session.error", (event) => {
      if (event.properties.sessionID !== tempSessionID) return
      dialogState.error = extractErrorMessage(event.properties.error)
      dialogState.loading = false
      renderDialog()
    }))

    await api.client.session.promptAsync(
      {
        sessionID: ephemeralSessionID,
        system,
        tools: {},
        parts: [{ type: "text", text: question }],
        ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
        ...(resolvedModel.variant ? { variant: resolvedModel.variant } : {}),
      },
      { throwOnError: true },
    )
  } catch (cause) {
    dialogState.error = getErrorMessage(cause)
    dialogState.loading = false
    renderDialog()
  }
}

function formatAnswerMessage(question: string, state: AnswerDialogState) {
  const sections = [`Question:\n${question}`]

  if (state.error) {
    sections.push(`Error:\n${state.error}`)
    return sections.join("\n\n")
  }

  if (state.answer) {
    sections.push(`Answer:\n${state.answer}`)
  } else {
    sections.push(`Answer:\nThinking${SPINNER_FRAMES[state.spinnerFrame]}`)
  }

  if (state.loading) {
    sections.push(state.answer ? "Streaming answer..." : "Waiting for answer...")
  }

  return sections.join("\n\n")
}

function parseConfig(options: unknown): BtwConfig {
  const input = options && typeof options === "object" ? (options as Record<string, unknown>) : {}
  return {
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : null,
    fullTokenLimit: parsePositiveNumber(input.fullTokenLimit, DEFAULT_FULL_TOKEN_LIMIT),
    miniMessageLimit: parsePositiveNumber(input.miniMessageLimit, DEFAULT_MINI_MESSAGE_LIMIT),
    streamAnswer: typeof input.streamAnswer === "boolean" ? input.streamAnswer : true,
    keybind: parseKeybind(input.keybind),
  }
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
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

function formatMiniContext(entries: SessionEntry[], messageLimit: number) {
  const recent = entries.slice(-messageLimit)
  const chunks = recent.map((entry) => formatEntry(entry, false)).filter(Boolean)
  return chunks.length > 0 ? chunks.join("\n\n") : "No conversation context available."
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

function buildSystemPrompt(mode: Mode, context: string) {
  const intro = mode === "full"
    ? "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see. Do not suggest running commands or reading files; you have no tools."
    : "You are answering a quick side question about an ongoing coding session. Below is a recent excerpt from the session. Answer concisely. Do not suggest running commands or reading files; you have no tools."

  return `${intro}\n\n<session-context>\n${context}\n</session-context>`
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

function extractAssistantText(api: TuiPluginApi, sessionID: string) {
  const chunks: string[] = []
  for (const message of api.state.session.messages(sessionID)) {
    if (message.role !== "assistant") continue
    for (const part of api.state.part(message.id)) {
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
