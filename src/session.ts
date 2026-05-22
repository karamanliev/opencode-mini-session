import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type {
  TuiDialogSelectOption,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import type { PermissionRuleset } from "@opencode-ai/sdk/v2";
import type { Setter } from "solid-js";
import { DEFAULT_ALLOWED_TOOLS, DEFAULT_KEYBIND } from "./constants";
import { getSessionEntries, formatFullContext } from "./context";
import { resolveDefaultModel, formatResolvedModel, type ModelSource } from "./model";
import type {
  ActiveDialog,
  AnswerDialogState,
  MiniConfig,
  ModelPreferenceState,
  OverlayState,
  ResolvedModel,
} from "./types";

type ModelSelectValue =
  | { type: "default" }
  | {
      type: "model";
      model: NonNullable<ResolvedModel["model"]>;
      variant?: string;
    };

const MINI_AGENT = "general";
const ADDITIONAL_PERMISSION_IDS = [
  "edit",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "websearch",
  "codesearch",
  "repo_clone",
  "repo_overview",
  "lsp",
  "doom_loop",
  "skill",
];

export async function openMiniSession(
  api: TuiPluginApi,
  config: MiniConfig,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
  openPickerFn: (onAfterSelect: () => void) => void,
) {
  const currentRoute = api.route.current;

  if (currentRoute.name !== "session") {
    api.ui.toast({
      variant: "error",
      message: "mini only works inside a session.",
    });
    return;
  }

  const activeDialog = active.get();
  if (activeDialog) {
    activeDialog.show();
    return;
  }

  const { sessionID } = currentRoute.params as { sessionID: string };
  const title = "mini session";
  void startQuestion(
    api,
    config,
    title,
    sessionID,
    setOverlay,
    active,
    modelPreference,
    openPickerFn,
  );
}

export async function startQuestion(
  api: TuiPluginApi,
  config: MiniConfig,
  title: string,
  sessionID: string,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
  openPickerFn: (onAfterSelect: () => void) => void,
) {
  const entries = getSessionEntries(api, sessionID);
  const context = formatFullContext(entries, config.tokenLimit);
  const toolIDs = await getAvailableToolIDs(api);
  const resolvedTools = resolveAllowedTools(config.allowedTools, toolIDs);
  const system = buildSystemPrompt(context, resolvedTools);
  const permission = buildPermissionRules(toolIDs, resolvedTools);
  const tools = buildToolSelection(toolIDs, resolvedTools);
  const defaultResolvedModel = resolveDefaultModel(
    api.state.provider,
    config.model,
    entries,
  );
  const getResolvedModel = () =>
    modelPreference.get() ?? defaultResolvedModel.model;
  const getModelName = () => formatResolvedModel(getResolvedModel());
  const hideKey = config.keybind || DEFAULT_KEYBIND;
  const previousFocus = api.renderer.currentFocusedRenderable;

  const dialogState: AnswerDialogState = {
    entries: [],
    streamingAnswer: "",
    loading: false,
    scrollbarVisible: false,
    notice: defaultResolvedModel.notice,
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
  let overlayInput: InputRenderable | undefined;
  let overlayScroller: ScrollBoxRenderable | undefined;

  const clearScrollTimer = () => {
    if (!scrollTimer) return;
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  };

  const clearFocusTimer = () => {
    if (!focusTimer) return;
    clearTimeout(focusTimer);
    focusTimer = undefined;
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

  const scheduleScrollToBottom = () => {
    if (closed || hidden) return;
    clearScrollTimer();
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      if (closed || hidden) return;
      overlayScroller?.scrollTo(Number.MAX_SAFE_INTEGER);
      api.renderer.requestRender();
    }, 0);
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
    setOverlay(undefined);
    restorePreviousFocus();
    api.ui.toast({
      variant: "info",
      message: `mini hidden. Press ${hideKey} to show it.`,
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

  const renderOverlay = (options: { focusInput?: boolean } = {}) => {
    if (closed) return;
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    if (hidden) return;
    setOverlay({
      api,
      title,
      modelName: getModelName(),
      hideKey,
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
      onSubmit: submitPrompt,
      scrollBy: (delta) => overlayScroller?.scrollBy(delta),
      scrollTo: (position) => overlayScroller?.scrollTo(position),
    });
    if (options.focusInput) scheduleInputFocus();
    if (dialogState.loading || dialogState.streamingAnswer)
      scheduleScrollToBottom();
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

    dialogState.error = undefined;
    dialogState.loading = true;
    dialogState.streamingAnswer = "";
    submissionModelQueue.push(getModelName());
    renderOverlay({ focusInput: true });

    void (async () => {
      try {
        const resolvedModel = getResolvedModel();
        await api.client.session.promptAsync(
          {
            sessionID: tempSessionID,
            system,
            agent: MINI_AGENT,
            tools,
            parts: [{ type: "text", text: prompt }],
            ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
            ...(resolvedModel.variant
              ? { variant: resolvedModel.variant }
              : {}),
          },
          { throwOnError: true },
        );
      } catch (cause) {
        if (closed) return;
        dialogState.error = getErrorMessage(cause);
        dialogState.loading = false;
        renderOverlay();
      }
    })();

    return true;
  }

  try {
    const created = await api.client.session.create(
      {
        title: "mini session",
        directory: api.state.path.directory,
        agent: MINI_AGENT,
        permission,
      },
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
  } catch (cause) {
    if (closed) return;
    dialogState.error = getErrorMessage(cause);
    dialogState.loading = false;
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
    ? providers
        .find((p) => p.id === defaultModel.model!.providerID)
        ?.models[defaultModel.model!.modelID]?.name ||
      defaultModel.model!.modelID
    : "default";

  const sourceLabel: Record<ModelSource, string> = {
    config: "config",
    session: "main session",
    unknown: "unknown",
  };

  const options: TuiDialogSelectOption<ModelSelectValue>[] = [
    {
      title: defaultModelName + (defaultModel.variant ? ` (${defaultModel.variant})` : ""),
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

function buildSystemPrompt(context: string, allowedTools: string[]) {
  const intro =
    "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.";

  const toolNote =
    allowedTools.length === 0
      ? " No tools are available in this session. Do not attempt to use any tools."
      : ` You may only use the following tools: ${allowedTools.join(", ")}. Do not attempt to use any other tools.`;

  return `${intro}${toolNote}\n\n<session-context>\n${context}\n</session-context>`;
}

function resolveAllowedTools(
  allowedTools: string[] | null,
  availableToolIDs: string[],
): string[] {
  if (allowedTools === null) return DEFAULT_ALLOWED_TOOLS;
  if (allowedTools.includes("*")) return [...availableToolIDs];
  return allowedTools;
}

async function getAvailableToolIDs(api: TuiPluginApi): Promise<string[]> {
  try {
    const result = await api.client.tool.ids(
      { directory: api.state.path.directory },
      { throwOnError: true },
    );
    if (
      Array.isArray(result.data) &&
      result.data.every((item) => typeof item === "string")
    ) {
      return result.data;
    }
  } catch {}

  return DEFAULT_ALLOWED_TOOLS;
}

function buildToolSelection(toolIDs: string[], allowedTools: string[]) {
  return Object.fromEntries(
    toolIDs.map((toolID) => [toolID, allowedTools.includes(toolID)]),
  );
}

function buildPermissionRules(
  toolIDs: string[],
  allowedTools: string[],
): PermissionRuleset {
  const permissionIDs = [
    ...new Set([...toolIDs, ...ADDITIONAL_PERMISSION_IDS]),
  ];
  return permissionIDs.map((permission) => ({
    permission,
    pattern: "*",
    action: allowedTools.includes(permission) ? "allow" : "deny",
  }));
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
