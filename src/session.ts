import type { ScrollBoxRenderable } from "@opentui/core";
import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Setter } from "solid-js";
import { SAFE_TOOLS } from "./constants";
import { getSessionEntries, formatFullContext } from "./context";
import { resolveModel, formatResolvedModel } from "./model";
import type {
  ActiveDialog,
  AnswerDialogState,
  BtwConfig,
  ModelPreferenceState,
  OverlayState,
  ResolvedModel,
} from "./types";

type ModelSelectValue =
  | { type: "default" }
  | { type: "model"; model: NonNullable<ResolvedModel["model"]>; variant?: string };

export async function openBtw(
  api: TuiPluginApi,
  config: BtwConfig,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
) {
  const currentRoute = api.route.current;

  if (currentRoute.name !== "session") {
    api.ui.toast({ variant: "error", message: "btw only works inside a session." });
    return;
  }

  const activeDialog = active.get();
  if (activeDialog) {
    activeDialog.show();
    return;
  }

  const { sessionID } = currentRoute.params as { sessionID: string };
  const title = "btw";
  const entries = getSessionEntries(api, sessionID);
  const currentModel = resolveModel(config.model, entries, modelPreference.get());

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title,
      placeholder: `Ask a side question (${formatResolvedModel(currentModel)})`,
      onCancel: () => api.ui.dialog.clear(),
      onConfirm: (value) => {
        const question = value.trim();
        if (!question) {
          api.ui.toast({ variant: "warning", message: "Enter a question first." });
          return;
        }
        void startQuestion(
          api,
          config,
          title,
          sessionID,
          question,
          setOverlay,
          active,
          modelPreference,
        );
      },
    }),
  );
}

export async function startQuestion(
  api: TuiPluginApi,
  config: BtwConfig,
  title: string,
  sessionID: string,
  question: string,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
) {
  const entries = getSessionEntries(api, sessionID);
  const context = formatFullContext(entries, config.tokenLimit);
  const system = buildSystemPrompt(context, config.allowTools);
  const selectedModel = modelPreference.get();
  const resolvedModel = resolveModel(config.model, entries, selectedModel);
  const modelName = formatResolvedModel(resolvedModel);

  const dialogState: AnswerDialogState = {
    entries: [],
    streamingAnswer: "",
    loading: true,
    scrollbarVisible: false,
  };

  const unsubscribers: Array<() => void> = [];
  let tempSessionID: string | undefined;
  let closed = false;
  let hidden = false;
  let continuing = false;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let overlayScroller: ScrollBoxRenderable | undefined;

  const hide = () => {
    if (closed || hidden) return;
    hidden = true;
    setOverlay(undefined);
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
    setOverlay(undefined);
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
    const answer =
      extractAssistantText(dialogState.entries) ||
      dialogState.streamingAnswer.trim();
    if (continuing || dialogState.loading || dialogState.error || !answer) return;
    continuing = true;

    try {
      await api.client.session.promptAsync(
        {
          sessionID,
          parts: [{ type: "text", text: buildContinuePrompt(question, answer) }],
        },
        { throwOnError: true },
      );
      api.ui.toast({ variant: "success", message: "Continued in the main thread." });
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

  const renderOverlay = () => {
    if (closed) return;
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    if (hidden) return;
    api.ui.dialog.clear();
    setOverlay({
      api,
      title,
      modelName,
      state: dialogState,
      canContinue:
        !dialogState.loading &&
        !dialogState.error &&
        Boolean(
          extractAssistantText(dialogState.entries) ||
            dialogState.streamingAnswer.trim(),
        ),
      onScroller: (scroller) => {
        overlayScroller = scroller;
      },
      onHide: () => hide(),
      onClose: () => void cleanup(),
      onContinue: () => void continueInMainThread(),
      scrollBy: (delta) => overlayScroller?.scrollBy(delta),
      scrollTo: (position) => overlayScroller?.scrollTo(position),
    });
  };

  const show = () => {
    if (closed) return;
    hidden = false;
    renderOverlay();
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
  renderOverlay();

  try {
    const created = await api.client.session.create(
      { title: "btw (ephemeral)", directory: api.state.path.directory },
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
        refreshSession();
        if (!extractAssistantText(dialogState.entries)) {
          dialogState.streamingAnswer = "No response generated.";
        }
        dialogState.loading = false;
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
      api.event.on("message.part.delta", (event) => {
        if (
          event.properties.sessionID !== tempSessionID ||
          event.properties.field !== "text"
        )
          return;
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
        dialogState.error = extractErrorMessage(event.properties.error);
        dialogState.loading = false;
        renderOverlay();
      }),
    );

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
    );
  } catch (cause) {
    if (closed) return;
    dialogState.error = getErrorMessage(cause);
    dialogState.loading = false;
    renderOverlay();
  }
}

export function openModelPicker(
  api: TuiPluginApi,
  config: BtwConfig,
  sessionID: string,
  modelPreference: ModelPreferenceState,
) {
  const defaultModel = resolveModel(
    config.model,
    getSessionEntries(api, sessionID),
  );
  const options = buildModelOptions(api, defaultModel);

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<ModelSelectValue>({
      title: "btw model",
      placeholder: "Select model for future btw questions",
      options,
      onSelect: (option) => {
        if (option.value.type === "default") {
          modelPreference.set(undefined);
          api.ui.toast({ variant: "success", message: "btw model reset to default." });
        } else {
          modelPreference.set({
            model: option.value.model,
            variant: option.value.variant,
          });
          api.ui.toast({
            variant: "success",
            message: `btw model set to ${formatResolvedModel({
              model: option.value.model,
              variant: option.value.variant,
            })}.`,
          });
        }
        api.ui.dialog.clear();
      },
    }),
  );
}

function buildModelOptions(
  api: TuiPluginApi,
  defaultModel: ResolvedModel,
): TuiDialogSelectOption<ModelSelectValue>[] {
  const options: TuiDialogSelectOption<ModelSelectValue>[] = [
    {
      title: "Use default",
      value: { type: "default" },
      description: `Config model or main session model: ${formatResolvedModel(defaultModel)}`,
      category: "btw",
    },
  ];

  const providers = [...api.state.provider].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

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

function buildSystemPrompt(context: string, allowTools: boolean) {
  const toolNote = allowTools
    ? "You may use the available safe tools if the provided context is not enough, but prefer answering from the session context first."
    : "Do not suggest running commands or reading files; you have no tools.";
  const intro =
    "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.";

  return `${intro} ${toolNote}\n\n<session-context>\n${context}\n</session-context>`;
}

function buildContinuePrompt(question: string, answer: string) {
  return [
    "Continue the main thread using this side-question context.",
    `Side question:\n${question}`,
    `Side answer:\n${answer}`,
    "Treat the side answer as draft context that you can refine or correct, then continue the main task from here.",
  ].join("\n\n");
}

function extractErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const data =
      "data" in error
        ? (error as { data?: { message?: unknown } }).data
        : undefined;
    if (data && typeof data.message === "string" && data.message)
      return data.message;
    const name =
      "name" in error ? (error as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name) return name;
  }
  return "The side question failed.";
}

function getErrorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message) return cause.message;
  return extractErrorMessage(cause);
}
