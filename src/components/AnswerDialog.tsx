/** @jsxImportSource @opentui/solid */
import {
  type InputRenderable,
  type ScrollBoxRenderable,
  SyntaxStyle,
} from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part } from "@opencode-ai/sdk/v2";
import { createMemo, Show } from "solid-js";
import { THINKING_TEXT } from "../constants";
import type {
  AnswerDialogProps,
  AnswerDialogState,
  OverlayState,
} from "../types";
import { extractAssistantText } from "../session";
import { ActionButton } from "./ActionButton";

function buildSyntaxStyle(
  theme: TuiPluginApi["theme"]["current"],
): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    // Markdown token styles
    "markup.heading": { fg: theme.markdownHeading, bold: true },
    "markup.strong": { fg: theme.markdownStrong, bold: true },
    "markup.italic": { fg: theme.markdownEmph, italic: true },
    "markup.link": { fg: theme.markdownLink },
    "markup.link.label": { fg: theme.markdownLinkText },
    "markup.link.url": { fg: theme.markdownLink },
    "markup.raw": { fg: theme.markdownCode },
    "markup.raw.block": { fg: theme.markdownCodeBlock },
    "markup.strikethrough": { fg: theme.markdownText },
    blockquote: { fg: theme.markdownBlockQuote },
    conceal: { fg: theme.border, dim: true },
    // Syntax highlighting in code blocks
    comment: { fg: theme.syntaxComment },
    keyword: { fg: theme.syntaxKeyword },
    function: { fg: theme.syntaxFunction },
    variable: { fg: theme.syntaxVariable },
    string: { fg: theme.syntaxString },
    number: { fg: theme.syntaxNumber },
    type: { fg: theme.syntaxType },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
  });
}

type MiniPart =
  | { type: "text"; text: string }
  | {
      type: "reasoning";
      id: string;
      text: string;
      time?: { start?: number; end?: number };
      metadata?: unknown;
    }
  | { type: "tool"; text: string; status: string }
  | { type: "meta"; text: string };

type MiniMessage = {
  id: string;
  role: "user" | "assistant";
  parts: MiniPart[];
  modelName?: string;
};

const THINKING_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

export function AnswerDialog(props: AnswerDialogProps) {
  const theme = props.api.theme.current;
  const mdSyntaxStyle = buildSyntaxStyle(theme);
  let scroller: ScrollBoxRenderable | undefined;
  let input: InputRenderable | undefined;
  let inputValue = "";

  const screenWidth = props.api.renderer.width;
  const screenHeight = props.api.renderer.height;
  const panelWidth = Math.min(100, Math.floor(screenWidth * 0.85));
  const panelHeight = Math.max(
    14,
    Math.min(screenHeight - 6, Math.floor(screenHeight * 0.68)),
  );
  const transcriptWidth = Math.max(20, panelWidth - 6);
  const promptContentWidth = Math.max(10, transcriptWidth - 6);
  const transcriptHeight = Math.max(1, panelHeight - 13);
  const transcriptContentWidth = Math.max(20, transcriptWidth - 5);

  const messages = createMemo(() => buildMiniMessages(props.state));
  const estimatedContentHeight = createMemo(
    () =>
      estimateMiniMessagesHeight(
        messages(),
        props.state,
        transcriptContentWidth,
      ) + 4,
  );
  const contentOverflows = createMemo(
    () => estimatedContentHeight() > transcriptHeight - 2,
  );
  const showScrollbar = createMemo(
    () => props.state.scrollbarVisible || contentOverflows(),
  );
  const canContinue = createMemo(
    () =>
      !props.state.loading &&
      !props.state.error &&
      Boolean(
        extractAssistantText(props.state.entries) ||
        props.state.streamingAnswer.trim(),
      ),
  );
  const createUserMessageHint = createMemo(() =>
    getCreateUserMessageHint(props.state),
  );
  const footerCounter = createMemo(() => props.state.footerCounter);
  const hasFooterCounter = createMemo(
    () => Boolean(footerCounter().miniSession || footerCounter().copiedContext),
  );
  const footerModelName = createMemo(() =>
    truncateWithEllipsis(
      props.modelName,
      Math.max(
        0,
        promptContentWidth -
          getFooterCounterWidth(footerCounter()) -
          (hasFooterCounter() ? 3 : 0),
      ),
    ),
  );

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
      <box
        position="absolute"
        top={0}
        left={0}
        width={screenWidth}
        height={screenHeight}
        backgroundColor="#000000"
        opacity={0.65}
      />
      <box
        width={panelWidth}
        height={panelHeight}
        flexDirection="column"
        backgroundColor={theme.backgroundPanel}
      >
        {/* header */}
        <box
          paddingTop={1}
          paddingLeft={3}
          paddingRight={3}
          flexDirection="row"
          justifyContent="flex-start"
          alignItems="center"
          marginBottom={1}
        >
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>
              <b>{props.title}</b>
            </text>
            <Show when={props.version}>
              {(version) => <text fg={theme.textMuted}>{version()}</text>}
            </Show>
          </box>
        </box>
        {/* transcript */}
        <box paddingLeft={3} paddingRight={3}>
          <scrollbox
            ref={(node) => {
              scroller = node;
              props.onScroller?.(node);
            }}
            height={transcriptHeight}
            width={transcriptWidth}
            scrollY
            stickyScroll
            stickyStart="bottom"
            verticalScrollbarOptions={{ visible: showScrollbar() }}
          >
            <box flexDirection="column" gap={1} width={transcriptContentWidth}>
              {props.state.notice ? (
                <text fg={theme.warning}>Warning: {props.state.notice}</text>
              ) : null}
              {props.state.update ? (
                <text fg={theme.warning}>{props.state.update}</text>
              ) : null}
              {messages().length > 0 ? (
                messages().map((message) => (
                  <box flexDirection="column" gap={0}>
                    <text
                      fg={
                        message.role === "assistant"
                          ? theme.primary
                          : theme.secondary
                      }
                    >
                      <b>
                        {message.role === "assistant"
                          ? `assistant [${message.modelName ?? props.modelName}]`
                          : message.role}
                      </b>
                    </text>
                    {message.parts.map((part, index) => (
                      <box
                        marginTop={getMiniPartTopMargin(
                          message.parts,
                          index,
                          message.role,
                        )}
                      >
                        {part.type === "reasoning" ? (
                          <ThinkingPart
                            api={props.api}
                            part={part}
                            expanded={isThinkingPartExpanded(
                              props.state,
                              part,
                            )}
                            spinnerFrame={props.state.spinnerFrame}
                            onToggle={() => props.onToggleThinkingPart(part.id)}
                          />
                        ) : message.role === "assistant" &&
                        part.type === "text" &&
                        !props.state.loading ? (
                          <markdown
                            content={part.text}
                            syntaxStyle={mdSyntaxStyle}
                            fg={theme.markdownText}
                            streaming={props.state.loading}
                            width={transcriptContentWidth}
                          />
                        ) : (
                          <text fg={getMiniPartColor(theme, part)}>
                            {formatMiniPart(part)}
                          </text>
                        )}
                      </box>
                    ))}
                  </box>
                ))
              ) : props.state.loading ? (
                <text fg={theme.textMuted}>{THINKING_TEXT}</text>
              ) : (
                <text fg={theme.textMuted}>Ask a side question below.</text>
              )}
              {props.state.error ? (
                <text fg={theme.error}>Error: {props.state.error}</text>
              ) : null}
              {props.state.errorDetail ? (
                <text fg={theme.textMuted}>{props.state.errorDetail}</text>
              ) : null}
              {createUserMessageHint() ? (
                <text fg={theme.warning}>{createUserMessageHint()}</text>
              ) : null}
              {props.state.loading && messages().length > 0 ? (
                <text fg={theme.textMuted}>{THINKING_TEXT}</text>
              ) : null}
            </box>
          </scrollbox>
        </box>
        <box
          paddingLeft={3}
          paddingRight={3}
          paddingBottom={1}
          flexDirection="column"
          gap={1}
          marginTop={1}
        >
          <box
            width={transcriptWidth}
            height={6}
            backgroundColor={theme.borderSubtle}
            flexDirection="column"
            paddingTop={1}
            paddingLeft={2}
            paddingRight={2}
            paddingBottom={1}
            justifyContent="space-between"
          >
            <input
              ref={(node) => {
                input = node;
                props.onInput?.(node);
              }}
              width={promptContentWidth}
              placeholder={
                props.state.inputPlaceholder ??
                (props.state.loading
                  ? "Waiting for response..."
                  : "Ask a question...")
              }
              textColor={theme.text}
              placeholderColor={theme.textMuted}
              backgroundColor={theme.borderSubtle}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              focusedBackgroundColor={theme.borderSubtle}
              onInput={(value) => {
                inputValue = value;
              }}
              onSubmit={() => {
                const submitted = (input?.value || inputValue).trim();
                if (!submitted || props.state.loading) return;
                if (!props.onSubmit(submitted)) return;
                inputValue = "";
                if (input) input.value = "";
              }}
            />
            <box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
              width={promptContentWidth}
              gap={3}
            >
              <text fg={theme.text}>{footerModelName()}</text>
              <Show when={hasFooterCounter()}>
                <FooterCounter api={props.api} state={footerCounter()} />
              </Show>
            </box>
          </box>
          <box
            flexDirection="row"
            justifyContent="flex-end"
            alignItems="center"
            width={transcriptWidth}
            gap={2}
          >
            <Show when={canContinue()}>
              <ActionButton
                api={props.api}
                label="Continue"
                keybind="shift+enter"
                onPress={props.onContinue}
              />
            </Show>
            <ActionButton
              api={props.api}
              label="Toggle"
              keybind={props.hideKey || undefined}
              onPress={props.onHide}
            />
            <ActionButton
              api={props.api}
              label="Thinking"
              keybind={props.toggleThinkingKeybind || undefined}
              onPress={props.onToggleThinking}
            />
            <ActionButton
              api={props.api}
              label="Model"
              keybind="tab"
              onPress={props.onChangeModel}
            />
          </box>
        </box>
      </box>
    </box>
  );
}

function buildMiniMessages(state: AnswerDialogState): MiniMessage[] {
  const messages: MiniMessage[] = [];

  for (const entry of state.entries) {
    const message: MiniMessage = {
      id: entry.info.id,
      role: entry.info.role,
      parts: entry.parts
        .flatMap(toMiniParts)
        .filter((part): part is MiniPart => Boolean(part)),
      modelName:
        entry.info.role === "assistant"
          ? state.messageModels[entry.info.id]
          : undefined,
    };

    if (message.parts.length === 0) continue;

    const previous = messages[messages.length - 1];
    if (shouldMergeMiniMessages(previous, message)) {
      previous.parts.push(...message.parts);
      previous.modelName ??= message.modelName;
      continue;
    }

    messages.push(message);
  }

  if (!state.streamingAnswer) return messages;

  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!lastAssistant) {
    messages.push({
      id: "streaming-assistant",
      role: "assistant",
      parts: [{ type: "text", text: state.streamingAnswer }],
      modelName: undefined,
    });
    return messages;
  }

  const lastText = [...lastAssistant.parts]
    .reverse()
    .find(
      (part): part is Extract<MiniPart, { type: "text" }> =>
        part.type === "text",
    );

  if (lastText) {
    const streamingTrimmed = state.streamingAnswer.trim();
    const lastTextTrimmed = lastText.text.trim();

    if (streamingTrimmed === lastTextTrimmed) {
      // Identical content, no change needed
    } else if (
      streamingTrimmed.startsWith(lastTextTrimmed) &&
      streamingTrimmed.length > lastTextTrimmed.length
    ) {
      // streamingAnswer contains existing text plus more (cumulative delta)
      lastText.text = state.streamingAnswer;
    } else if (!lastTextTrimmed.endsWith(streamingTrimmed)) {
      // streamingAnswer is genuinely new text (incremental delta)
      lastText.text += state.streamingAnswer;
    }
  } else {
    const lastReasoning = [...lastAssistant.parts]
      .reverse()
      .find((part) => part.type === "reasoning");

    if (
      !lastReasoning ||
      lastReasoning.text.trim() !== state.streamingAnswer.trim()
    ) {
      lastAssistant.parts.push({ type: "text", text: state.streamingAnswer });
    }
  }

  return messages;
}

function shouldMergeMiniMessages(
  previous: MiniMessage | undefined,
  current: MiniMessage,
) {
  return Boolean(
    previous && previous.role === "assistant" && current.role === "assistant",
  );
}

type ThinkingMiniPart = Extract<MiniPart, { type: "reasoning" }>;

function ThinkingPart(props: {
  api: TuiPluginApi;
  part: ThinkingMiniPart;
  expanded: boolean;
  spinnerFrame: number;
  onToggle: () => void;
}) {
  const theme = props.api.theme.current;
  const header = () =>
    formatThinkingHeader(props.part, props.expanded, props);
  const body = () => getThinkingBodyText(props.part);

  return (
    <box flexDirection="column" gap={0} opacity={props.expanded ? 0.65 : 1}>
      <box onMouseUp={props.onToggle}>
        <text fg={theme.warning}>
          <Show when={!props.expanded} fallback={header()}>
            <b>{header()}</b>
          </Show>
        </text>
      </box>
      <Show when={props.expanded && body()}>
        <box marginLeft={2} marginTop={1}>
          <text fg={theme.markdownBlockQuote}>{body()}</text>
        </box>
      </Show>
    </box>
  );
}

function estimateMiniMessagesHeight(
  messages: MiniMessage[],
  state: AnswerDialogState,
  width: number,
) {
  let lines = 0;
  for (const message of messages) {
    lines += 1;
    for (let index = 0; index < message.parts.length; index++) {
      const part = message.parts[index];
      lines += getMiniPartTopMargin(message.parts, index, message.role);
      if (part.type === "reasoning") {
        lines += estimateWrappedLines(
          formatThinkingHeader(part, isThinkingPartExpanded(state, part), state),
          width,
        );
        if (isThinkingPartExpanded(state, part)) {
          const body = getThinkingBodyText(part);
          if (body)
            lines += 1 + estimateWrappedLines(body, Math.max(1, width - 2));
        }
      } else {
        lines += estimateWrappedLines(formatMiniPart(part), width);
      }
    }
    lines += 1;
  }
  if (state.error)
    lines += estimateWrappedLines(`Error: ${state.error}`, width);
  if (state.errorDetail)
    lines += estimateWrappedLines(state.errorDetail, width);
  const hint = getCreateUserMessageHint(state);
  if (hint) lines += estimateWrappedLines(hint, width);
  if (state.notice)
    lines += estimateWrappedLines(`Warning: ${state.notice}`, width);
  if (state.loading && messages.length > 0) lines += 1;
  if (messages.length === 0) lines += 1;
  return lines;
}

function estimateWrappedLines(text: string, width: number) {
  const lineWidth = Math.max(1, width);
  return text
    .split("\n")
    .reduce(
      (count, line) => count + Math.max(1, Math.ceil(line.length / lineWidth)),
      0,
    );
}

function getMiniPartTopMargin(
  parts: MiniPart[],
  index: number,
  role: MiniMessage["role"],
) {
  if (index === 0) return parts[0]?.type === "reasoning" && role === "assistant" ? 1 : 0;
  const previous = parts[index - 1];
  const current = parts[index];
  if (current.type === "reasoning") {
    return previous.type === "tool" || previous.type === "reasoning" ? 1 : 0;
  }
  if (current.type === "tool") {
    return previous.type === "tool" || previous.type === "reasoning" ? 1 : 0;
  }
  return current.type === "text" && previous.type !== "text" ? 1 : 0;
}

function toMiniParts(part: Part): MiniPart[] {
  if (part.type === "reasoning" && part.text.trim())
    return toReasoningMiniParts(part);

  const miniPart = toMiniPart(part);
  return miniPart ? [miniPart] : [];
}

function toMiniPart(part: Part): MiniPart | undefined {
  if (part.type === "text" && part.text.trim())
    return { type: "text", text: part.text.trim() };
  if (part.type === "tool") {
    const toolName = part.tool.charAt(0).toUpperCase() + part.tool.slice(1);
    const inputSummary = summarizeToolInput(part.state.input);
    const stateTitle =
      "title" in part.state && typeof part.state.title === "string"
        ? part.state.title
        : undefined;
    const detail = inputSummary || stateTitle;
    return {
      type: "tool",
      status: part.state.status,
      text: detail ? `→ ${toolName} ${detail}` : `→ ${toolName}`,
    };
  }
  if (part.type === "file")
    return { type: "meta", text: `file: ${part.filename ?? part.url}` };
  if (part.type === "agent")
    return { type: "meta", text: `agent: ${part.name}` };
  if (part.type === "patch")
    return { type: "meta", text: `patch: ${part.files.join(", ")}` };
  if (part.type === "retry")
    return { type: "meta", text: `retry ${part.attempt}` };
  return undefined;
}

function toReasoningMiniParts(part: Extract<Part, { type: "reasoning" }>) {
  const baseID = getReasoningPartID(part);
  const time = "time" in part && isReasoningTime(part.time) ? part.time : undefined;
  const metadata = "metadata" in part ? part.metadata : undefined;
  const segments = splitReasoningText(part.text.trim());

  return segments.map((text, index) => ({
    type: "reasoning" as const,
    id: segments.length === 1 ? baseID : `${baseID}:${index}`,
    text,
    time: index === 0 ? time : undefined,
    metadata,
  }));
}

function splitReasoningText(text: string) {
  const titlePattern = /\*\*([^*\n]+)\*\*/g;
  const matches = [...text.matchAll(titlePattern)].filter((match) =>
    isReasoningTitleMatch(text, match.index ?? -1),
  );

  if (matches.length <= 1) return [text];

  const segments: string[] = [];
  if ((matches[0].index ?? 0) > 0) {
    const intro = text.slice(0, matches[0].index).trim();
    if (intro) segments.push(intro);
  }

  for (let index = 0; index < matches.length; index++) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const segment = text.slice(start, end).trim();
    if (segment) segments.push(segment);
  }

  return segments.length > 0 ? segments : [text];
}

function isReasoningTitleMatch(text: string, index: number) {
  if (index < 0) return false;
  if (index === 0) return true;
  const before = text.slice(0, index).trimEnd();
  if (!before) return true;
  return /[.!?)]$/.test(before) || before.endsWith("...");
}

function summarizeToolInput(
  input: { [key: string]: unknown } | undefined,
): string {
  if (!input) return "";
  const entries = Object.entries(input).slice(0, 2);
  if (entries.length === 0) return "";
  return entries
    .map(([, value]) => {
      const str = typeof value === "string" ? value : String(value);
      return str.length > 60 ? `${str.slice(0, 57)}...` : str;
    })
    .join(" ");
}

function formatMiniPart(part: MiniPart) {
  return part.text;
}

function FooterCounter(props: {
  api: TuiPluginApi;
  state: AnswerDialogState["footerCounter"];
}) {
  const theme = props.api.theme.current;

  if (!props.state.miniSession && !props.state.copiedContext) return <text />;

  return (
    <box flexDirection="row" gap={1}>
      <Show when={props.state.miniSession}>
        {(miniSession) => (
          <text fg={miniSession().warning ? theme.warning : theme.textMuted}>
            {miniSession().text}
          </text>
        )}
      </Show>
      <Show when={props.state.miniSession && props.state.copiedContext}>
        <text fg={theme.textMuted}>·</text>
      </Show>
      <Show when={props.state.copiedContext}>
        {(copiedContext) => (
          <text fg={copiedContext().truncated ? theme.warning : theme.textMuted}>
            {copiedContext().text}
          </text>
        )}
      </Show>
    </box>
  );
}

function truncateWithEllipsis(text: string, maxWidth: number) {
  if (maxWidth <= 0) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return ".".repeat(maxWidth);
  return `${text.slice(0, maxWidth - 3)}...`;
}

function getFooterCounterWidth(state: AnswerDialogState["footerCounter"]) {
  const miniWidth = state.miniSession?.text.length ?? 0;
  const copiedWidth = state.copiedContext?.text.length ?? 0;
  if (miniWidth && copiedWidth) return miniWidth + copiedWidth + 3;
  return miniWidth + copiedWidth;
}

function getReasoningPartID(part: Extract<Part, { type: "reasoning" }>) {
  return "id" in part && typeof part.id === "string" ? part.id : part.text;
}

function isReasoningTime(
  value: unknown,
): value is { start?: number; end?: number } {
  return Boolean(value && typeof value === "object");
}

function isThinkingPartExpanded(
  state: AnswerDialogState,
  part: ThinkingMiniPart,
) {
  const toggled = Boolean(state.expandedThinkingPartIDs[part.id]);
  return state.thinkingEnabled ? !toggled : toggled;
}

function formatThinkingHeader(
  part: ThinkingMiniPart,
  expanded: boolean,
  spinnerSource: Pick<AnswerDialogState, "spinnerFrame">,
) {
  const title = getThinkingTitle(part);
  const duration = formatThinkingDuration(part.time);
  const prefix = isThinkingPartLoading(part)
    ? `${THINKING_SPINNER_FRAMES[spinnerSource.spinnerFrame]} `
    : expanded
      ? "- "
      : "+ ";
  if (title) return `${prefix}Thought: ${title}${duration ? ` · ${duration}` : ""}`;
  return `${prefix}Thought${duration ? `: ${duration}` : ""}`;
}

function isThinkingPartLoading(part: ThinkingMiniPart) {
  if (!part.time) return false;
  const start = Number(part.time.start);
  const end = Number(part.time.end);
  return Number.isFinite(start) && !Number.isFinite(end);
}

function getThinkingTitle(part: ThinkingMiniPart) {
  return getExplicitThinkingTitle(part.text);
}

function getExplicitThinkingTitle(text: string) {
  const line = text
    .split("\n")
    .find((candidate) => candidate.trim().length > 0)
    ?.trim();
  const match = line?.match(/^\*\*(.+?)\*\*/);
  return match?.[1]?.trim() ? truncateThinkingTitle(match[1].trim()) : "";
}

function truncateThinkingTitle(title: string) {
  return title.length > 80 ? `${title.slice(0, 77).trim()}...` : title;
}

function getThinkingBodyText(part: ThinkingMiniPart) {
  const lines = part.text.split("\n");
  const title = getThinkingTitle(part);
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex === -1) return "";

  if (!title) return part.text;

  lines[titleIndex] = lines[titleIndex].replace(/^\s*\*\*(.+?)\*\*/, "");

  return lines
    .slice(titleIndex)
    .join("\n")
    .replace(/^\s+/, "")
    .trimEnd();
}

function formatThinkingDuration(time: ThinkingMiniPart["time"]) {
  if (!time) return "";
  const start = Number(time.start);
  const end = Number(time.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return "";
  const diff = end - start;
  const milliseconds =
    start > 10_000_000_000 || end > 10_000_000_000 ? diff : diff * 1000;
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function getMiniPartColor(
  theme: TuiPluginApi["theme"]["current"],
  part: MiniPart,
) {
  if (part.type === "reasoning") return theme.textMuted;
  if (part.type === "meta") return theme.textMuted;
  if (part.type === "tool" && part.status === "error") return theme.error;
  if (part.type === "tool" && part.status === "running") return theme.info;
  if (part.type === "tool") return theme.textMuted;
  return theme.text;
}

function getCreateUserMessageHint(state: AnswerDialogState) {
  const text = [state.error, state.errorDetail].filter(Boolean).join("\n");
  if (!/SessionPrompt\.createUserMessage|createUserMessage|chat\.message/i.test(text))
    return undefined;
  return "Hint: OpenCode failed while creating the user message. A server plugin chat.message hook may be throwing.";
}

export function createOverlaySlot(getOverlay: () => OverlayState | undefined) {
  return () => {
    return (
      <Show when={getOverlay()}>
        {(current) => (
          <AnswerDialog
            api={current().api}
            title={current().title}
            version={current().version}
            modelName={current().modelName}
            hideKey={current().hideKey}
            toggleThinkingKeybind={current().toggleThinkingKeybind}
            state={current().state}
            onScroller={current().onScroller}
            onInput={current().onInput}
            onHide={current().onHide}
            onClose={current().onClose}
            onContinue={current().onContinue}
            onChangeModel={current().onChangeModel}
            onToggleThinking={current().onToggleThinking}
            onToggleThinkingPart={current().onToggleThinkingPart}
            onSubmit={current().onSubmit}
          />
        )}
      </Show>
    );
  };
}
