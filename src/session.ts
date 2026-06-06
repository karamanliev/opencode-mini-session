import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type {
  TuiDialogSelectOption,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import type { Setter } from "solid-js";
import { version } from "../package.json";
import { buildFooterCounterState } from "./counter";
import {
  buildMiniErrorDetail,
  buildMiniPromptPayload,
  buildMiniSessionCreatePayload,
  buildMiniSystemPrompt,
  formatMiniNotice,
  resolveRuntimeMiniAgent,
  type ResolvedMiniAgent,
} from "./agent";
import { buildCopiedContext, getSessionEntries } from "./context";
import { getErrorMessage } from "./diagnostics";
import {
  resolveDefaultModel,
  formatResolvedModel,
  resolveModelContextWindow,
  type ModelSource,
} from "./model";
import type {
  ActiveDialog,
  AnswerDialogState,
  MiniConfig,
  MiniMode,
  ModelPreferenceState,
  OverlayState,
  ResolvedModel,
  ThinkingPreferenceState,
} from "./types";

type ModelSelectValue =
  | { type: "default" }
  | {
      type: "model";
      model: NonNullable<ResolvedModel["model"]>;
      variant?: string;
    };

type ErrorPath =
  | "promptAsync throw"
  | "session.error event"
  | "session.create throw";


export function openMiniSession(
  api: TuiPluginApi,
  config: MiniConfig,
  mode: MiniMode,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
  thinkingPreference: ThinkingPreferenceState,
  openPickerFn: (onAfterSelect: () => void) => void,
  getUpdateWarning?: () => string | undefined,
): boolean {
  const currentRoute = api.route.current;

  if (currentRoute.name !== "session") {
    api.ui.toast({
      variant: "error",
      message: "mini only works inside a session.",
    });
    return false;
  }

  const activeDialog = active.get();
  if (activeDialog) {
    activeDialog.show();
    return false;
  }

  const { sessionID } = currentRoute.params as { sessionID: string };
  void startQuestion(
    api,
    config,
    mode,
    sessionID,
    setOverlay,
    active,
    modelPreference,
    thinkingPreference,
    openPickerFn,
    getUpdateWarning,
  );
  return true;
}

export async function startQuestion(
  api: TuiPluginApi,
  config: MiniConfig,
  mode: MiniMode,
  sessionID: string,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
  thinkingPreference: ThinkingPreferenceState,
  openPickerFn: (onAfterSelect: () => void) => void,
  getUpdateWarning?: () => string | undefined,
) {
  const entries = getSessionEntries(api, sessionID);
  const copiedContext =
    mode === "main"
      ? buildCopiedContext(entries, config.tokenLimit)
      : { text: "", usedTokens: undefined };
  const context = copiedContext.text;
  const defaultResolvedModel = resolveDefaultModel(
    api.state.provider,
    config.model,
    config.variant,
    entries,
  );
  const getResolvedModel = () =>
    modelPreference.get() ?? defaultResolvedModel.model;
  const getModelName = () => formatResolvedModel(getResolvedModel());
  const hideKey = mode === "fresh" ? config.freshKeybind : config.keybind;
  const hiddenCommand = mode === "fresh" ? "/mini-fresh" : "/mini";
  const title = mode === "fresh" ? "mini fresh" : "mini session";
  const previousFocus = api.renderer.currentFocusedRenderable;
  let resolvedAgent: ResolvedMiniAgent;
  let system = "";

  const dialogState: AnswerDialogState = {
    mode,
    entries: [],
    streamingAnswer: "",
    loading: false,
    scrollbarVisible: false,
    spinnerFrame: 0,
    copiedContextTokens: copiedContext.usedTokens,
    lastCompletedMiniInputTokens: undefined,
    modelContextWindow: undefined,
    footerCounter: {},
    inputPlaceholder: undefined,
    thinkingEnabled: thinkingPreference.get(),
    expandedThinkingPartIDs: {},
    update: getUpdateWarning?.(),
    notice: undefined,
    errorDetail: undefined,
    messageModels: {},
  };

  const submissionModelQueue: string[] = [];

  const unsubscribers: Array<() => void> = [];
  let tempSessionID: string | undefined;
  let closed = false;
  let hidden = false;
  let continuing = false;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let overlayInput: InputRenderable | undefined;
  let overlayScroller: ScrollBoxRenderable | undefined;
  let followStreamingToBottom = true;
  let forceScrollToBottom = true;
  let pendingScrollToBottom = false;
  let lastScrollTop = 0;
  let lastScrollHeight = 0;

  const syncCounterState = () => {
    dialogState.modelContextWindow = resolveModelContextWindow(
      api.state.provider,
      getResolvedModel(),
    );
    dialogState.footerCounter = buildFooterCounterState({
      mode: dialogState.mode,
      copiedContextTokens: dialogState.copiedContextTokens,
      tokenLimit: config.tokenLimit,
      lastCompletedMiniInputTokens: dialogState.lastCompletedMiniInputTokens,
      modelContextWindow: dialogState.modelContextWindow,
    });
    dialogState.inputPlaceholder = dialogState.footerCounter.placeholder;
  };

  const clearScrollTimer = () => {
    pendingScrollToBottom = false;
    if (!scrollTimer) return;
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  };

  const clearFocusTimer = () => {
    if (!focusTimer) return;
    clearTimeout(focusTimer);
    focusTimer = undefined;
  };

  const clearSpinnerTimer = () => {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
  };

  const startSpinnerTimer = () => {
    if (spinnerTimer || closed || hidden || !dialogState.loading) return;
    spinnerTimer = setInterval(() => {
      if (closed || hidden || !dialogState.loading) {
        clearSpinnerTimer();
        return;
      }
      dialogState.spinnerFrame = (dialogState.spinnerFrame + 1) % 10;
      renderOverlay();
    }, 80);
  };

  const scheduleInputFocus = () => {
    if (closed || hidden) return;
    clearFocusTimer();
    focusTimer = setTimeout(() => {
      focusTimer = undefined;
      if (closed || hidden) return;
      overlayInput?.focus();
      api.renderer.requestRender();
    }, 0);
  };

  const isScrollerAtBottom = () => {
    if (!overlayScroller) return true;
    const maxScrollTop = Math.max(
      0,
      overlayScroller.scrollHeight - overlayScroller.viewport.height,
    );
    return overlayScroller.scrollTop >= maxScrollTop - 1;
  };

  const updateScrollSnapshot = () => {
    lastScrollTop = overlayScroller?.scrollTop ?? 0;
    lastScrollHeight = overlayScroller?.scrollHeight ?? 0;
  };

  const scheduleScrollToBottom = () => {
    if (closed || hidden) return;
    clearScrollTimer();
    pendingScrollToBottom = true;
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      if (closed || hidden) {
        pendingScrollToBottom = false;
        return;
      }
      overlayScroller?.scrollTo(Number.MAX_SAFE_INTEGER);
      updateScrollSnapshot();
      pendingScrollToBottom = false;
      api.renderer.requestRender();
    }, 0);
  };

  const scrollBy = (delta: number) => {
    followStreamingToBottom = false;
    forceScrollToBottom = false;
    pendingScrollToBottom = false;
    clearScrollTimer();
    overlayScroller?.scrollBy(delta);
    updateScrollSnapshot();
  };

  const scrollTo = (position: number) => {
    followStreamingToBottom = position === Number.MAX_SAFE_INTEGER;
    forceScrollToBottom = position === Number.MAX_SAFE_INTEGER;
    pendingScrollToBottom = false;
    if (position !== Number.MAX_SAFE_INTEGER) clearScrollTimer();
    overlayScroller?.scrollTo(position);
    updateScrollSnapshot();
  };

  const restorePreviousFocus = () => {
    setTimeout(() => {
      if (previousFocus && !previousFocus.isDestroyed) {
        previousFocus.focus();
      }
      api.renderer.requestRender();
    }, 0);
  };

  const hide = () => {
    if (closed || hidden) return;
    hidden = true;
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    clearScrollTimer();
    clearFocusTimer();
    clearSpinnerTimer();
    setOverlay(undefined);
    restorePreviousFocus();
    api.ui.toast({
      variant: "info",
      message: hideKey
        ? `mini hidden. Press ${hideKey} to show it.`
        : `mini hidden. Run ${hiddenCommand} to show it.`,
      duration: 1000,
    });
  };

  const closeFromUser = async () => {
    api.ui.toast({
      variant: "info",
      message: "mini session closed.",
      duration: 1000,
    });
    await cleanup();
  };

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (active.get() === controller) active.set(undefined);
    while (unsubscribers.length > 0) {
      try {
        unsubscribers.pop()?.();
      } catch {}
    }
    if (renderTimer) clearTimeout(renderTimer);
    clearScrollTimer();
    clearFocusTimer();
    clearSpinnerTimer();
    setOverlay(undefined);
    restorePreviousFocus();
    if (!tempSessionID) return;
    const ephemeralSessionID = tempSessionID;
    tempSessionID = undefined;
    try {
      await api.client.session.abort(
        { sessionID: ephemeralSessionID },
        { throwOnError: true },
      );
    } catch {}
    try {
      await api.client.session.delete(
        { sessionID: ephemeralSessionID },
        { throwOnError: true },
      );
    } catch {}
  };

  const continueInMainThread = async () => {
    const transcript = buildMiniSessionTranscript(dialogState);
    if (continuing || dialogState.loading || dialogState.error || !transcript)
      return;
    continuing = true;

    try {
      await api.client.tui.appendPrompt(
        { text: buildContinuePrompt(transcript) },
        { throwOnError: true },
      );
      api.ui.toast({
        variant: "success",
        message: "Side answer added to prompt.",
      });
      await cleanup();
    } catch (cause) {
      api.ui.toast({
        variant: "error",
        message: `Failed to continue in main thread: ${getErrorMessage(cause)}`,
      });
    } finally {
      continuing = false;
    }
  };

  const toggleThinking = () => {
    dialogState.thinkingEnabled = !dialogState.thinkingEnabled;
    thinkingPreference.set(dialogState.thinkingEnabled);
    dialogState.expandedThinkingPartIDs = {};
    renderOverlay();
  };

  const toggleThinkingPart = (partID: string) => {
    if (dialogState.expandedThinkingPartIDs[partID]) {
      delete dialogState.expandedThinkingPartIDs[partID];
    } else {
      dialogState.expandedThinkingPartIDs[partID] = true;
    }
    renderOverlay();
  };

  const renderOverlay = (options: { focusInput?: boolean } = {}) => {
    if (closed) return;
    syncCounterState();
    const streamingActive =
      dialogState.loading || Boolean(dialogState.streamingAnswer);
    const currentScrollTop = overlayScroller?.scrollTop ?? 0;
    const currentScrollHeight = overlayScroller?.scrollHeight ?? 0;
    if (streamingActive && !forceScrollToBottom && !pendingScrollToBottom) {
      if (isScrollerAtBottom()) {
        followStreamingToBottom = true;
      } else if (
        currentScrollTop < lastScrollTop ||
        currentScrollHeight <= lastScrollHeight
      ) {
        followStreamingToBottom = false;
      }
    }
    const shouldScrollToBottom =
      forceScrollToBottom || (streamingActive && followStreamingToBottom);
    forceScrollToBottom = false;
    updateScrollSnapshot();
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    if (hidden) return;
    setOverlay({
      api,
      title,
      version,
      modelName: getModelName(),
      hideKey,
      toggleThinkingKeybind: config.toggleThinkingKeybind,
      state: dialogState,
      onScroller: (scroller) => {
        overlayScroller = scroller;
      },
      onInput: (input) => {
        overlayInput = input;
      },
      onHide: () => hide(),
      onClose: () => void closeFromUser(),
      onContinue: () => void continueInMainThread(),
      onChangeModel: () =>
        openPickerFn(() => renderOverlay({ focusInput: true })),
      onToggleThinking: toggleThinking,
      onToggleThinkingPart: toggleThinkingPart,
      onSubmit: submitPrompt,
      scrollBy,
      scrollTo,
    });
    if (options.focusInput) scheduleInputFocus();
    if (dialogState.loading) startSpinnerTimer();
    else clearSpinnerTimer();
    if (shouldScrollToBottom) scheduleScrollToBottom();
  };

  const setPromptError = (path: ErrorPath, cause: unknown) => {
    dialogState.error = getErrorMessage(cause);
    dialogState.errorDetail = buildMiniErrorDetail({
      path,
      sessionID: tempSessionID,
      resolvedModel: getResolvedModel(),
      resolvedAgent,
    });
    dialogState.loading = false;
    clearSpinnerTimer();
  };

  const show = () => {
    if (closed) return;
    hidden = false;
    renderOverlay({ focusInput: true });
  };

  const controller = {
    close: cleanup,
    hide,
    show,
    isVisible: () => !hidden,
  };

  const scheduleRenderOverlay = () => {
    if (closed || renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      renderOverlay();
    }, 50);
  };

  active.set(controller);
  renderOverlay({ focusInput: true });

  try {
    resolvedAgent = await resolveRuntimeMiniAgent(api, config);
  } catch (cause) {
    if (closed) return;
    api.ui.toast({
      variant: "error",
      message: `Failed to open mini session: ${getErrorMessage(cause)}`,
    });
    await cleanup();
    return;
  }

  if (closed) return;
  system = buildMiniSystemPrompt(context, resolvedAgent, mode);
  dialogState.notice = formatMiniNotice(
    defaultResolvedModel.notice,
    ...resolvedAgent.notices,
  );
  renderOverlay();

  function submitPrompt(value: string) {
    const prompt = value.trim();
    if (!prompt || closed) return false;
    if (dialogState.loading) {
      api.ui.toast({
        variant: "warning",
        message: "Wait for the current response.",
      });
      return false;
    }
    if (!tempSessionID) {
      api.ui.toast({
        variant: "warning",
        message: "mini session is still opening.",
      });
      return false;
    }
    const promptSessionID = tempSessionID;

    dialogState.error = undefined;
    dialogState.errorDetail = undefined;
    dialogState.loading = true;
    dialogState.spinnerFrame = 0;
    dialogState.streamingAnswer = "";
    followStreamingToBottom = true;
    forceScrollToBottom = true;
    submissionModelQueue.push(getModelName());

    renderOverlay({ focusInput: true });

    void (async () => {
      try {
        const resolvedModel = getResolvedModel();
        await api.client.session.promptAsync(
          buildMiniPromptPayload(resolvedAgent, {
            sessionID: promptSessionID,
            system,
            prompt,
            resolvedModel,
          }),
          { throwOnError: true },
        );
      } catch (cause) {
        if (closed) return;
        setPromptError("promptAsync throw", cause);
        renderOverlay();
      }
    })();

    return true;
  }

  try {
    const created = await api.client.session.create(
      buildMiniSessionCreatePayload(resolvedAgent, {
        parentID: sessionID,
        title: "mini session",
        directory: api.state.path.directory,
      }),
      { throwOnError: true },
    );
    tempSessionID = created.data.id;
    const ephemeralSessionID = tempSessionID;

    const refreshSession = () => {
      dialogState.entries = getSessionEntries(api, ephemeralSessionID);
      dialogState.streamingAnswer = "";
    };

    if (closed) {
      try {
        await api.client.session.delete(
          { sessionID: ephemeralSessionID },
          { throwOnError: true },
        );
      } catch {}
      return;
    }

    unsubscribers.push(
      api.event.on("session.idle", (event) => {
        if (event.properties.sessionID !== tempSessionID) return;
        const usedModel = submissionModelQueue.shift();
        refreshSession();
        dialogState.lastCompletedMiniInputTokens =
          getLastCompletedMiniInputTokens(dialogState.entries) ??
          dialogState.lastCompletedMiniInputTokens;
        if (usedModel) {
          for (const entry of dialogState.entries) {
            if (
              entry.info.role === "assistant" &&
              !dialogState.messageModels[entry.info.id]
            ) {
              dialogState.messageModels[entry.info.id] = usedModel;
            }
          }
        }
        if (!extractAssistantText(dialogState.entries)) {
          dialogState.streamingAnswer = "No response generated.";
        }
        dialogState.loading = false;
        clearSpinnerTimer();
        renderOverlay();
      }),
    );

    unsubscribers.push(
      api.event.on("message.updated", (event) => {
        if (event.properties.sessionID !== tempSessionID) return;
        refreshSession();
        renderOverlay();
      }),
    );

    unsubscribers.push(
      api.event.on("session.next.text.delta", (event) => {
        if (event.properties.sessionID !== tempSessionID) return;
        dialogState.streamingAnswer += event.properties.delta;
        scheduleRenderOverlay();
      }),
    );

    unsubscribers.push(
      api.event.on("message.part.updated", (event) => {
        if (event.properties.sessionID !== tempSessionID) return;
        refreshSession();
        renderOverlay();
      }),
    );

    unsubscribers.push(
      api.event.on("session.error", (event) => {
        if (event.properties.sessionID !== tempSessionID) return;
        setPromptError("session.error event", event.properties.error);
        renderOverlay();
      }),
    );
  } catch (cause) {
    if (closed) return;
    setPromptError("session.create throw", cause);
    renderOverlay();
  }
}

export function openModelPicker(
  api: TuiPluginApi,
  config: MiniConfig,
  sessionID: string,
  modelPreference: ModelPreferenceState,
  onAfterSelect?: () => void,
) {
  const { model: defaultModel, source: defaultSource } = resolveDefaultModel(
    api.state.provider,
    config.model,
    config.variant,
    getSessionEntries(api, sessionID),
  );
  const options = buildModelOptions(api, defaultModel, defaultSource);

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<ModelSelectValue>({
      title: "mini model",
      placeholder: "Select model for future mini-session questions",
      options,
      onSelect: (option) => {
        if (option.value.type === "default") {
          modelPreference.set(undefined);
          api.ui.toast({
            variant: "success",
            message: "mini model reset to default.",
          });
        } else {
          modelPreference.set({
            model: option.value.model,
            variant: option.value.variant,
          });
          api.ui.toast({
            variant: "success",
            message: `mini model set to ${formatResolvedModel({
              model: option.value.model,
              variant: option.value.variant,
            })}.`,
          });
        }
        api.ui.dialog.clear();
        onAfterSelect?.();
      },
    }),
  );
}

function buildModelOptions(
  api: TuiPluginApi,
  defaultModel: ResolvedModel,
  defaultSource: ModelSource,
): TuiDialogSelectOption<ModelSelectValue>[] {
  const providers = [...api.state.provider].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  const defaultModelName = defaultModel.model
    ? providers.find((p) => p.id === defaultModel.model!.providerID)?.models[
        defaultModel.model!.modelID
      ]?.name || defaultModel.model!.modelID
    : "default";

  const sourceLabel: Record<ModelSource, string> = {
    config: "config",
    session: "main session",
    unknown: "unknown",
  };

  const options: TuiDialogSelectOption<ModelSelectValue>[] = [
    {
      title:
        defaultModelName +
        (defaultModel.variant ? ` (${defaultModel.variant})` : ""),
      value: { type: "default" },
      description: `${formatResolvedModel(defaultModel)}`,
      category: `Default [${sourceLabel[defaultSource]}]`,
    },
  ];

  for (const provider of providers) {
    const models = Object.values(provider.models).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const model of models) {
      const resolved = {
        providerID: model.providerID,
        modelID: model.id,
      };
      options.push({
        title: model.name || model.id,
        value: { type: "model", model: resolved },
        description: `${provider.id}/${model.id}`,
        category: provider.name,
      });

      for (const variant of Object.keys(model.variants ?? {}).sort()) {
        options.push({
          title: `${model.name || model.id} (${variant})`,
          value: { type: "model", model: resolved, variant },
          description: `${provider.id}/${model.id}`,
          category: provider.name,
        });
      }
    }
  }

  return options;
}

export function extractAssistantText(
  entries: AnswerDialogState["entries"],
): string {
  const chunks: string[] = [];
  for (const entry of entries) {
    if (entry.info.role !== "assistant") continue;
    for (const part of entry.parts) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text);
    }
  }
  return chunks.join("\n\n").trim();
}

function buildMiniSessionTranscript(state: AnswerDialogState) {
  const lines: string[] = [];

  for (const entry of state.entries) {
    const chunks: string[] = [];
    for (const part of entry.parts) {
      if (part.type === "text" && part.text.trim())
        chunks.push(part.text.trim());
    }
    if (chunks.length > 0)
      lines.push(`${entry.info.role}:\n${chunks.join("\n\n")}`);
  }

  if (state.streamingAnswer.trim()) {
    lines.push(`assistant:\n${state.streamingAnswer.trim()}`);
  }

  return lines.join("\n\n").trim();
}

function buildContinuePrompt(transcript: string) {
  return ["[Context from a mini session]", transcript, "---\n"].join("\n\n");
}

function getLastCompletedMiniInputTokens(entries: AnswerDialogState["entries"]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const info = entries[index]?.info;
    if (info.role !== "assistant") continue;
    if (!info.time?.completed) continue;
    if (typeof info.tokens?.input === "number") return info.tokens.input;
  }
  return undefined;
}
