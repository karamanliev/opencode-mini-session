import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { ModelInfo, ProviderInfo, SessionMessageInfo } from "@opencode/client";
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
import { MINI_SESSION_METADATA_KEY } from "./constants";
import { getErrorMessage } from "./diagnostics";
import {
  resolveDefaultModel,
  formatResolvedModel,
  resolveModelContextWindow,
} from "./model";
import { getCurrentRoute, type TuiContext } from "./opencode";
import type {
  ActiveDialog,
  AnswerDialogState,
  MiniConfig,
  MiniMode,
  ModelPreference,
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
  | "session.prompt throw"
  | "session.execution.failed event"
  | "session.create throw";

const SYSTEM_INSTRUCTION_KEY = "mini.system";

/**
 * The server rejects instruction entries larger than 256 KiB. Clamp ours below
 * that so a large copied context degrades into a truncated entry instead of a
 * failed `put` (which would drop the whole mini instruction).
 */
export const MAX_INSTRUCTION_BYTES = 250_000;

export function clampInstructionValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= MAX_INSTRUCTION_BYTES) return value;
  const truncated = new TextDecoder().decode(
    bytes.slice(0, MAX_INSTRUCTION_BYTES),
  );
  return `${truncated}\n\n[Session context truncated to fit the instruction limit.]`;
}

export type MiniSessionOptions = {
  ctx: TuiContext;
  config: MiniConfig;
  mode: MiniMode;
  sessionID: string;
  setOverlay: Setter<OverlayState | undefined>;
  active: ActiveDialog;
  modelPreference: ModelPreferenceState;
  thinkingPreference: ThinkingPreferenceState;
  openPickerFn: (onAfterSelect: () => void) => void;
  getUpdateWarning?: () => string | undefined;
  initialQuestion?: string;
  handoff?: boolean;
  isDisposed?: () => boolean;
};

export function openMiniSession(options: MiniSessionOptions): boolean {
  const { ctx, active } = options;
  const route = getCurrentRoute(ctx);

  if (route.kind !== "session") {
    ctx.ui.toast.show({
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

  void startQuestion({ ...options, sessionID: route.sessionID });
  return true;
}

export async function startQuestion(options: MiniSessionOptions) {
  const {
    ctx,
    config,
    mode,
    sessionID,
    setOverlay,
    active,
    modelPreference,
    thinkingPreference,
    openPickerFn,
    getUpdateWarning,
    initialQuestion,
    handoff,
    isDisposed,
  } = options;
  const disposed = () => closed || isDisposed?.() === true;
  const [messages, models, providers, defaultModelResult] = await Promise.all([
    fetchSessionMessages(ctx, sessionID),
    fetchModels(ctx),
    fetchProviders(ctx),
    fetchDefaultModel(ctx),
  ]);
  if (isDisposed?.()) return;
  const entries = getSessionEntries(messages);
  const copiedContext =
    mode === "main"
      ? buildCopiedContext(entries, config.tokenLimit)
      : { text: "", usedTokens: undefined, totalAvailableTokens: undefined };
  const context = copiedContext.text;
  const defaultResolvedModel = resolveDefaultModel(
    models,
    config.model,
    config.variant,
    entries,
    defaultModelResult,
  );
  const getResolvedModel = () =>
    modelPreference.get() ?? defaultResolvedModel.model;
  const getModelName = () => formatResolvedModel(getResolvedModel());
  const hideKey = mode === "fresh" ? config.freshKeybind : config.keybind;
  const hiddenCommand = mode === "fresh" ? "/mini-fresh" : "/mini";
  const handoffMode = handoff === true;
  const title = handoffMode
    ? "mini handoff"
    : mode === "fresh"
      ? "mini fresh"
      : "mini session";
  const continueLabel = handoffMode
    ? "Copy handoff"
    : config.continueAction === "clipboard"
      ? "Copy"
      : "Continue";
  const copiesToClipboard = handoffMode || config.continueAction === "clipboard";
  const previousFocus = ctx.renderer.currentFocusedRenderable;
  let resolvedAgent: ResolvedMiniAgent;
  let system = "";
  let lastPrompt: string | undefined;

  const dialogState: AnswerDialogState = {
    mode,
    entries: [],
    loading: false,
    waitingForResponse: false,
    scrollbarVisible: false,
    spinnerFrame: 0,
    copiedContextTokens: copiedContext.usedTokens,
    copiedContextTotalTokens: copiedContext.totalAvailableTokens,
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
  let submissionGeneration = 0;

  const unsubscribers: Array<() => void> = [];
  let tempSessionID: string | undefined;
  let closed = false;
  let hidden = false;
  let continuing = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
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
  let currentTokenMessageID: string | undefined;
  const incrementedTokenMessageIDs = new Set<string>();
  let sessionModelKey = formatSessionModelKey(defaultResolvedModel.model);

  const syncCounterState = () => {
    dialogState.modelContextWindow = resolveModelContextWindow(
      models,
      getResolvedModel(),
    );
    dialogState.footerCounter = buildFooterCounterState({
      mode: dialogState.mode,
      copiedContextTokens: dialogState.copiedContextTokens,
      copiedContextTotalTokens: dialogState.copiedContextTotalTokens,
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

  const clearRefreshTimer = () => {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
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
      ctx.renderer.requestRender();
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
      ctx.renderer.requestRender();
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
      ctx.renderer.requestRender();
    }, 0);
  };

  const hide = () => {
    if (closed || hidden) return;
    hidden = true;
    clearScrollTimer();
    clearFocusTimer();
    clearSpinnerTimer();
    clearRefreshTimer();
    setOverlay(undefined);
    restorePreviousFocus();
    ctx.ui.toast.show({
      variant: "info",
      message: hideKey
        ? `mini hidden. Press ${hideKey} to show it.`
        : `mini hidden. Run ${hiddenCommand} to show it.`,
      duration: 1000,
    });
  };

  const closeFromUser = async () => {
    ctx.ui.toast.show({
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
    clearScrollTimer();
    clearFocusTimer();
    clearSpinnerTimer();
    clearRefreshTimer();
    setOverlay(undefined);
    restorePreviousFocus();
    if (!tempSessionID) return;
    const ephemeralSessionID = tempSessionID;
    tempSessionID = undefined;
    try {
      await ctx.client.session.interrupt({ sessionID: ephemeralSessionID });
    } catch {}
    try {
      await ctx.client.session.remove({ sessionID: ephemeralSessionID });
    } catch {}
  };

  const continueInMainThread = async () => {
    if (continuing) return;
    if (dialogState.loading) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "Wait for the response to finish.",
      });
      return;
    }
    const transcript = buildMiniSessionTranscript(dialogState);
    const handoffText = handoffMode
      ? extractLastAssistantText(dialogState.entries)
      : "";
    const text = handoffMode ? handoffText : buildContinuePrompt(transcript);
    const hasText = handoffMode
      ? Boolean(handoffText.trim())
      : Boolean(transcript.trim());
    if (!hasText) {
      if (handoffMode) {
        ctx.ui.toast.show({
          variant: "warning",
          message: "No handoff document yet.",
        });
      }
      return;
    }
    if (!handoffMode && dialogState.error) return;
    continuing = true;

    try {
      if (handoffMode || config.continueAction === "clipboard") {
        if (!copyTextToClipboard(ctx, text)) {
          ctx.ui.toast.show({
            variant: "error",
            message: handoffMode
              ? "Clipboard is not supported by this terminal; the handoff was not copied."
              : 'Clipboard is not supported by this terminal. Use continueAction "queue" or copy from the transcript.',
          });
          return;
        }
        ctx.ui.toast.show({
          variant: "success",
          message: handoffMode
            ? "Handoff copied to clipboard."
            : "Side answer copied to clipboard.",
        });
        await cleanup();
        return;
      }

      await ctx.client.session.prompt({
        sessionID,
        text,
        delivery: "queue",
      });
      ctx.ui.toast.show({
        variant: "success",
        message: "Side answer queued in the main session.",
      });
      await cleanup();
    } catch (cause) {
      ctx.ui.toast.show({
        variant: "error",
        message: `Failed to continue in main thread: ${getErrorMessage(cause)}`,
      });
    } finally {
      continuing = false;
    }
  };

  const retryLastPrompt = () => {
    if (closed || dialogState.loading) return;
    if (!lastPrompt) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "Nothing to retry yet. Close and reopen the mini session.",
      });
      return;
    }
    if (!tempSessionID) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "mini session is still opening.",
      });
      return;
    }
    dialogState.error = undefined;
    dialogState.errorDetail = undefined;
    submitPrompt(lastPrompt);
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
    const streamingActive = dialogState.loading;
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
    if (hidden) return;
    setOverlay({
      api: ctx,
      title,
      version,
      modelName: getModelName(),
      hideKey,
      toggleThinkingKeybind: config.toggleThinkingKeybind,
      continueLabel,
      continueOnError: handoffMode,
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
      onRetry: retryLastPrompt,
      onEmptySubmit: copiesToClipboard
        ? () => void continueInMainThread()
        : undefined,
      onChangeModel: () =>
        openPickerFn(() => renderOverlay({ focusInput: true })),
      onToggleThinking: toggleThinking,
      onToggleThinkingPart: toggleThinkingPart,
      onSubmit: submitPrompt,
      scrollBy,
      scrollTo,
      submit: () => {
        const value = (overlayInput?.value || "").trim();
        if (value && !dialogState.loading && submitPrompt(value)) {
          if (overlayInput) overlayInput.value = "";
        }
      },
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

  active.set(controller);
  renderOverlay({ focusInput: true });

  try {
    resolvedAgent = await resolveRuntimeMiniAgent(ctx, config);
  } catch (cause) {
    if (closed) return;
    ctx.ui.toast.show({
      variant: "error",
      message: `Failed to open mini session: ${getErrorMessage(cause)}`,
    });
    await cleanup();
    return;
  }

  if (disposed()) return;
  system = buildMiniSystemPrompt(
    context,
    resolvedAgent,
    mode,
    ctx.location?.directory,
  );
  dialogState.notice = formatMiniNotice(
    defaultResolvedModel.notice,
    ...resolvedAgent.notices,
  );
  renderOverlay();

  function submitPrompt(value: string) {
    const prompt = value.trim();
    if (!prompt || closed) return false;
    if (dialogState.loading) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "Wait for the current response.",
      });
      return false;
    }
    if (!tempSessionID) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "mini session is still opening.",
      });
      return false;
    }
    const promptSessionID = tempSessionID;
    const generation = ++submissionGeneration;
    clearRefreshTimer();
    lastPrompt = prompt;

    dialogState.error = undefined;
    dialogState.errorDetail = undefined;
    dialogState.loading = true;
    dialogState.waitingForResponse = true;
    dialogState.spinnerFrame = 0;
    followStreamingToBottom = true;
    forceScrollToBottom = true;
    submissionModelQueue.push(getModelName());

    renderOverlay({ focusInput: true });

    void (async () => {
      try {
        const resolvedModel = getResolvedModel();
        const nextModelKey = formatSessionModelKey(resolvedModel);
        if (nextModelKey !== sessionModelKey) {
          await ctx.client.session.switchModel({
            sessionID: promptSessionID,
            model: {
              id: resolvedModel.model?.modelID ?? "",
              providerID: resolvedModel.model?.providerID ?? "",
              ...(resolvedModel.variant ? { variant: resolvedModel.variant } : {}),
            },
          });
          sessionModelKey = nextModelKey;
        }
        await ctx.client.session.prompt(
          buildMiniPromptPayload({
            sessionID: promptSessionID,
            prompt,
          }),
        );
      } catch (cause) {
        if (closed || generation !== submissionGeneration) return;
        setPromptError("session.prompt throw", cause);
        renderOverlay();
      }
    })();

    return true;
  }

  try {
    const created = await ctx.client.session.create(
      buildMiniSessionCreatePayload(resolvedAgent, {
        title: "mini session",
        metadata: { [MINI_SESSION_METADATA_KEY]: true },
        ...(ctx.location?.directory
          ? { location: { directory: ctx.location.directory } }
          : {}),
        ...(defaultResolvedModel.model.model
          ? {
              model: {
                id: defaultResolvedModel.model.model.modelID,
                providerID: defaultResolvedModel.model.model.providerID,
                ...(defaultResolvedModel.model.variant
                  ? { variant: defaultResolvedModel.model.variant }
                  : {}),
              },
            }
          : {}),
      }),
    );
    tempSessionID = created.id;
    const ephemeralSessionID = tempSessionID;

    if (system.trim()) {
      try {
        await ctx.client.session.instructions.entry.put({
          sessionID: ephemeralSessionID,
          key: SYSTEM_INSTRUCTION_KEY,
          value: clampInstructionValue(system),
        });
      } catch (cause) {
        if (closed) return;
        ctx.ui.toast.show({
          variant: "warning",
          message: `Failed to attach mini instructions: ${getErrorMessage(cause)}`,
        });
      }
    }

    const refreshLastCompletedMiniInputTokens = () => {
      const latest = getLastCompletedMiniInputUsage(dialogState.entries);
      if (!latest) return;

      const current = dialogState.lastCompletedMiniInputTokens;
      if (current === undefined || latest.totalTokens > current) {
        dialogState.lastCompletedMiniInputTokens = latest.totalTokens;
        currentTokenMessageID = latest.messageID;
        return;
      }

      if (latest.messageID === currentTokenMessageID) {
        return;
      }

      if (incrementedTokenMessageIDs.has(latest.messageID)) {
        return;
      }

      incrementedTokenMessageIDs.add(latest.messageID);
      dialogState.lastCompletedMiniInputTokens = current + latest.inputTokens;
      currentTokenMessageID = latest.messageID;
    };

    const refreshSession = async (generation: number, assistantMessageID?: string) => {
      if (closed || !tempSessionID || generation !== submissionGeneration) return;
      // The host projects live parts before plugin event listeners run. Context
      // reads contain durable content and omit the body of an active stream.
      const messages = ctx.data.session.message.list(tempSessionID);
      dialogState.entries = getSessionEntries(messages);
      if (
        dialogState.entries.some((entry) =>
          entry.info.type === "assistant" &&
          (entry.info.time.completed === undefined || entry.info.id === assistantMessageID) &&
          entry.parts.length > 0,
        )
      ) dialogState.waitingForResponse = false;
      refreshLastCompletedMiniInputTokens();
    };

    const scheduleSessionRefresh = (delay = 50, assistantMessageID?: string) => {
      if (closed || refreshTimer) return;
      const generation = submissionGeneration;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshSession(generation, assistantMessageID)
          .then(() => {
            if (closed || generation !== submissionGeneration) return;
            renderOverlay();
          })
          .catch(() => {});
      }, delay);
    };

    const finishResponse = () => {
      if (closed || !dialogState.loading) return;
      const usedModel = submissionModelQueue.shift();
      if (usedModel) {
        for (const entry of dialogState.entries) {
          if (
            entry.info.type === "assistant" &&
            !dialogState.messageModels[entry.info.id]
          ) {
            dialogState.messageModels[entry.info.id] = usedModel;
          }
        }
      }
      dialogState.loading = false;
      clearSpinnerTimer();
    };

    const completeResponse = () => {
      const generation = submissionGeneration;
      void refreshSession(generation)
        .then(() => {
          if (closed || generation !== submissionGeneration) return;
          finishResponse();
          renderOverlay();
        })
        .catch(() => {});
    };

    if (disposed()) {
      try {
        await ctx.client.session.remove({ sessionID: ephemeralSessionID });
      } catch {}
      return;
    }

    unsubscribers.push(
      ctx.data.on("session.idle", (event) => {
        if (event.data.sessionID !== tempSessionID) return;
        completeResponse();
      }),
    );

    unsubscribers.push(
      ctx.data.on("session.execution.succeeded", (event) => {
        if (event.data.sessionID !== tempSessionID) return;
        completeResponse();
      }),
    );

    unsubscribers.push(
      ctx.data.on("session.execution.failed", (event) => {
        if (event.data.sessionID !== tempSessionID) return;
        setPromptError("session.execution.failed event", event.data.error);
        renderOverlay();
      }),
    );

    unsubscribers.push(
      ctx.data.listen(({ details: event }) => {
        if (!("sessionID" in event.data) || event.data.sessionID !== tempSessionID)
          return;
        scheduleSessionRefresh(
          event.type.endsWith(".delta") ? 50 : 0,
          "assistantMessageID" in event.data ? event.data.assistantMessageID : undefined,
        );
      }),
    );

    if (initialQuestion) {
      submitPrompt(initialQuestion);
    }
  } catch (cause) {
    if (closed) return;
    setPromptError("session.create throw", cause);
    renderOverlay();
  }
}

export function openModelPicker(
  ctx: TuiContext,
  config: MiniConfig,
  sessionID: string,
  modelPreference: ModelPreferenceState,
  onAfterSelect?: () => void,
  onOpenChange?: (open: boolean) => void,
) {
  onOpenChange?.(true);
  void (async () => {
    try {
      const [messages, models, providers, defaultModelResult] = await Promise.all([
        fetchSessionMessages(ctx, sessionID),
        fetchModels(ctx),
        fetchProviders(ctx),
        fetchDefaultModel(ctx),
      ]);
      const entries = getSessionEntries(messages);
      const { model: defaultModel } = resolveDefaultModel(
        models,
        config.model,
        config.variant,
        entries,
        defaultModelResult,
      );
      const options = buildModelOptions(
        models,
        providers,
        defaultModel,
        defaultModelResult,
      );
      const current = findCurrentModelValue(options, modelPreference.get());

      const selected = await ctx.ui.dialog.select<ModelSelectValue>({
        title: "Mini session model",
        placeholder: "Select model for future mini-session questions",
        options,
        ...(current ? { current } : {}),
      });

      if (selected === undefined) return;
      if (selected.type === "default") {
        modelPreference.set(undefined);
        ctx.ui.toast.show({
          variant: "success",
          message: "mini model reset to default.",
        });
      } else {
        modelPreference.set({
          model: selected.model,
          variant: selected.variant,
        });
        ctx.ui.toast.show({
          variant: "success",
          message: `mini model set to ${formatResolvedModel({
            model: selected.model,
            variant: selected.variant,
          })}.`,
        });
      }
      onAfterSelect?.();
    } catch (cause) {
      ctx.ui.toast.show({
        variant: "error",
        message: `Failed to change mini model: ${getErrorMessage(cause)}`,
      });
    } finally {
      onOpenChange?.(false);
    }
  })();
}

function findCurrentModelValue(
  options: { value: ModelSelectValue }[],
  preference: ModelPreference,
): ModelSelectValue | undefined {
  const model = preference?.model;
  if (!model) {
    return options.find((option) => option.value.type === "default")?.value;
  }

  return options.find(
    (option) =>
      option.value.type === "model" &&
      option.value.model.providerID === model.providerID &&
      option.value.model.modelID === model.modelID &&
      (option.value.variant ?? undefined) === (preference?.variant ?? undefined),
  )?.value;
}

function buildModelOptions(
  models: ModelInfo[],
  providers: ProviderInfo[],
  defaultModel: ResolvedModel,
  fallbackModel: ResolvedModel | undefined,
): { title: string; value: ModelSelectValue; description?: string; category?: string }[] {
  const providerName = (providerID: string) =>
    providers.find((provider) => provider.id === providerID)?.name ?? providerID;

  const defaultModelName = defaultModel.model
    ? models.find(
        (model) =>
          model.providerID === defaultModel.model!.providerID &&
          model.id === defaultModel.model!.modelID,
      )?.name ?? defaultModel.model.modelID
    : fallbackModel?.model?.modelID ?? "default";

  const sortedModels = [...models].sort((left, right) => {
    const providerCompare = providerName(left.providerID).localeCompare(
      providerName(right.providerID),
    );
    if (providerCompare !== 0) return providerCompare;
    return left.name.localeCompare(right.name);
  });

  const options: {
    title: string;
    value: ModelSelectValue;
    description?: string;
    category?: string;
  }[] = [
    {
      title:
        defaultModelName +
        (defaultModel.variant ? ` (${defaultModel.variant})` : ""),
      value: { type: "default" },
      description: formatResolvedModel(defaultModel),
      category: "Default",
    },
  ];

  for (const model of sortedModels) {
    const resolved = {
      providerID: model.providerID,
      modelID: model.id,
    };
    const category = providerName(model.providerID);
    options.push({
      title: model.name || model.id,
      value: { type: "model", model: resolved },
      description: `${model.providerID}/${model.id}`,
      category,
    });

    for (const variant of model.variants
      .map((candidate) => candidate.id)
      .sort()) {
      options.push({
        title: `${model.name || model.id} (${variant})`,
        value: { type: "model", model: resolved, variant },
        description: `${model.providerID}/${model.id}`,
        category,
      });
    }
  }

  return options;
}

export function extractAssistantText(
  entries: AnswerDialogState["entries"],
): string {
  const chunks: string[] = [];
  for (const entry of entries) {
    if (entry.info.type !== "assistant") continue;
    for (const part of entry.parts) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text);
    }
  }
  return chunks.join("\n\n").trim();
}

export function extractLastAssistantText(
  entries: AnswerDialogState["entries"],
): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.info.type !== "assistant") continue;
    const text = entry.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return "";
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
      lines.push(`${entry.info.type}:\n${chunks.join("\n\n")}`);
  }

  return lines.join("\n\n").trim();
}

function buildContinuePrompt(transcript: string) {
  return ["[Context from a mini session]", transcript, "---\n"].join("\n\n");
}

function getLastCompletedMiniInputUsage(entries: AnswerDialogState["entries"]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const info = entries[index]?.info;
    if (info.type !== "assistant") continue;
    if (!info.time?.completed) continue;
    if (info.tokens) {
      return {
        messageID: info.id,
        inputTokens: info.tokens.input,
        totalTokens: getAssistantInputTokens(info.tokens),
      };
    }
  }
  return undefined;
}

function getAssistantInputTokens(tokens: {
  input: number;
  cache?: { read?: number; write?: number };
}) {
  return tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
}

function formatSessionModelKey(resolved: ResolvedModel) {
  if (!resolved.model) return "";
  return `${resolved.model.providerID}/${resolved.model.modelID}${resolved.variant ? `#${resolved.variant}` : ""}`;
}

export function copyTextToClipboard(ctx: TuiContext, text: string): boolean {
  const renderer = ctx.renderer as {
    isOsc52Supported?: () => boolean;
    copyToClipboardOSC52?: (value: string) => boolean;
  };
  if (typeof renderer.isOsc52Supported === "function" && !renderer.isOsc52Supported()) {
    return false;
  }
  if (typeof renderer.copyToClipboardOSC52 !== "function") return false;
  return renderer.copyToClipboardOSC52(text);
}

async function fetchSessionMessages(
  ctx: TuiContext,
  sessionID: string,
): Promise<SessionMessageInfo[]> {
  try {
    return await ctx.client.session.context({ sessionID });
  } catch {
    return ctx.data.session.message.list(sessionID);
  }
}

async function fetchModels(ctx: TuiContext): Promise<ModelInfo[]> {
  try {
    const result = await ctx.client.model.list();
    if (Array.isArray(result.data)) return result.data;
  } catch {}
  return [];
}

async function fetchProviders(ctx: TuiContext): Promise<ProviderInfo[]> {
  try {
    const result = await ctx.client.provider.list();
    if (Array.isArray(result.data)) return result.data;
  } catch {}
  return [];
}

async function fetchDefaultModel(
  ctx: TuiContext,
): Promise<ResolvedModel | undefined> {
  try {
    const result = await ctx.client.model.default();
    const model = result.data;
    if (model) {
      return {
        model: { providerID: model.providerID, modelID: model.id },
      };
    }
  } catch {}
  return undefined;
}
