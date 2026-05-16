/** @jsxImportSource @opentui/solid */
import { type InputRenderable, type ScrollBoxRenderable, SyntaxStyle } from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part } from "@opencode-ai/sdk/v2";
import { createMemo, Show } from "solid-js";
import { THINKING_TEXT } from "../constants";
import type { AnswerDialogProps, AnswerDialogState, OverlayState } from "../types";
import { extractAssistantText } from "../session";
import { ActionButton } from "./ActionButton";
import { HintBar } from "./HintBar";

function buildSyntaxStyle(theme: TuiPluginApi["theme"]["current"]): SyntaxStyle {
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
  | { type: "reasoning"; text: string }
  | { type: "tool"; text: string; status: string }
  | { type: "meta"; text: string };

type MiniMessage = {
  id: string;
  role: "user" | "assistant";
  parts: MiniPart[];
};

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
    12,
    Math.min(screenHeight - 6, Math.floor(screenHeight * 0.68)),
  );
  const transcriptHeight = Math.max(5, panelHeight - 9);
  const transcriptWidth = Math.max(20, panelWidth - 8);
  const transcriptContentWidth = Math.max(20, transcriptWidth - 5);

  const messages = createMemo(() => buildMiniMessages(props.state));
  const estimatedContentHeight = createMemo(
    () =>
      estimateMiniMessagesHeight(messages(), props.state, transcriptContentWidth) + 4,
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
        gap={0}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.backgroundPanel}
        border
        borderColor={theme.border}
      >
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={theme.text}>
            <b>{props.title}</b>
          </text>
          <HintBar api={props.api} hideKey={props.hideKey} />
        </box>
        <box
          border
          borderColor={theme.backgroundElement}
          height={transcriptHeight}
          width={transcriptWidth + 2}
        >
          <scrollbox
            ref={(node) => {
              scroller = node;
              props.onScroller?.(node);
            }}
            height={transcriptHeight - 2}
            width={transcriptWidth}
            scrollY
            stickyScroll={false}
            verticalScrollbarOptions={{ visible: showScrollbar() }}
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
              {messages().length > 0 ? (
                messages().map((message) => (
                  <box flexDirection="column" gap={0}>
                    <text
                      fg={
                        message.role === "assistant"
                          ? theme.primary
                          : theme.textMuted
                      }
                    >
                      <b>{message.role}</b>
                    </text>
                    {message.parts.map((part, index) => (
                      <box marginTop={getMiniPartTopMargin(message.parts, index)}>
                        {message.role === "assistant" &&
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
              {props.state.loading && messages().length > 0 ? (
                <text fg={theme.textMuted}>{THINKING_TEXT}</text>
              ) : null}
              <box height={1} />
            </box>
          </scrollbox>
        </box>
        <box
          border
          borderColor={theme.backgroundElement}
          width={transcriptWidth + 2}
          height={3}
          paddingLeft={1}
          paddingRight={1}
        >
          <input
            ref={(node) => {
              input = node;
              props.onInput?.(node);
            }}
            width={Math.max(1, transcriptWidth - 2)}
            placeholder={props.state.loading ? "Waiting for response..." : ""}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            backgroundColor={theme.backgroundPanel}
            focusedTextColor={theme.text}
            focusedBackgroundColor={theme.backgroundPanel}
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
        </box>
        <box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          width={transcriptWidth + 2}
          marginTop={1}
        >
          <box flexDirection="row" gap={1}>
            <ActionButton
              api={props.api}
              label="Continue In Main Thread"
              primary
              disabled={!canContinue()}
              onPress={props.onContinue}
            />
            <ActionButton api={props.api} label="Hide" onPress={props.onHide} />
            <ActionButton api={props.api} label="Close" onPress={props.onClose} />
          </box>
          <text fg={theme.textMuted}>{props.modelName}</text>
        </box>
      </box>
    </box>
  );
}

function buildMiniMessages(state: AnswerDialogState): MiniMessage[] {
  const messages = state.entries
    .map((entry) => ({
      id: entry.info.id,
      role: entry.info.role,
      parts: entry.parts
        .map(toMiniPart)
        .filter((part): part is MiniPart => Boolean(part)),
    }))
    .filter((message) => message.parts.length > 0);

  if (!state.streamingAnswer) return messages;

  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!lastAssistant) {
    messages.push({
      id: "streaming-assistant",
      role: "assistant",
      parts: [{ type: "text", text: state.streamingAnswer }],
    });
    return messages;
  }

  const lastText = [...lastAssistant.parts]
    .reverse()
    .find((part): part is Extract<MiniPart, { type: "text" }> => part.type === "text");

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

function estimateMiniMessagesHeight(
  messages: MiniMessage[],
  state: AnswerDialogState,
  width: number,
) {
  let lines = 0;
  for (const message of messages) {
    lines += 1;
    for (const part of message.parts) {
      lines += estimateWrappedLines(formatMiniPart(part), width);
    }
    lines += 1;
  }
  if (state.error) lines += estimateWrappedLines(`Error: ${state.error}`, width);
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

function getMiniPartTopMargin(parts: MiniPart[], index: number) {
  if (index === 0) return 0;
  const previous = parts[index - 1];
  const current = parts[index];
  return current.type === "text" && previous.type !== "text" ? 1 : 0;
}

function toMiniPart(part: Part): MiniPart | undefined {
  if (part.type === "text" && part.text.trim())
    return { type: "text", text: part.text.trim() };
  if (part.type === "reasoning" && part.text.trim())
    return { type: "reasoning", text: part.text.trim() };
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

function summarizeToolInput(input: { [key: string]: unknown } | undefined): string {
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
  if (part.type === "reasoning") return `thinking: ${part.text}`;
  return part.text;
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

export function createOverlaySlot(getOverlay: () => OverlayState | undefined) {
  return () => {
    return (
      <Show when={getOverlay()}>
        {(current) => (
          <AnswerDialog
            api={current().api}
            title={current().title}
            modelName={current().modelName}
            hideKey={current().hideKey}
            state={current().state}
            onScroller={current().onScroller}
            onInput={current().onInput}
            onHide={current().onHide}
            onClose={current().onClose}
            onContinue={current().onContinue}
            onSubmit={current().onSubmit}
          />
        )}
      </Show>
    );
  };
}
