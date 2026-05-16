import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type {
  TuiDialogSelectOption,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import type { PermissionRuleset } from "@opencode-ai/sdk/v2";
import type { Setter } from "solid-js";
import { DEFAULT_KEYBIND, SAFE_TOOLS } from "./constants";
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
  | {
      type: "model";
      model: NonNullable<ResolvedModel["model"]>;
      variant?: string;
    };

const BTW_AGENT = "general";
const SAFE_TOOL_PERMISSION_IDS = Object.keys(SAFE_TOOLS);
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

export async function openBtw(
  api: TuiPluginApi,
  config: BtwConfig,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
) {
  const currentRoute = api.route.current;

  if (currentRoute.name !== "session") {
    api.ui.toast({
      variant: "error",
      message: "btw only works inside a session.",
    });
    return;
  }

  const activeDialog = active.get();
  if (activeDialog) {
    activeDialog.show();
    return;
  }

  const { sessionID } = currentRoute.params as { sessionID: string };
  const title = "btw";
  void startQuestion(
    api,
    config,
    title,
    sessionID,
    setOverlay,
    active,
    modelPreference,
  );
}

export async function startQuestion(
  api: TuiPluginApi,
  config: BtwConfig,
  title: string,
  sessionID: string,
  setOverlay: Setter<OverlayState | undefined>,
  active: ActiveDialog,
  modelPreference: ModelPreferenceState,
) {
  const entries = getSessionEntries(api, sessionID);
  const context = formatFullContext(entries, config.tokenLimit);
  const system = buildSystemPrompt(context);
  const toolIDs = await getAvailableToolIDs(api);
  const permission = buildPermissionRules(toolIDs);
  const tools = buildToolSelection(toolIDs);
  const selectedModel = modelPreference.get();
  const resolvedModel = resolveModel(config.model, entries, selectedModel);
  const modelName = formatResolvedModel(resolvedModel);
  const hideKey = config.keybind || DEFAULT_KEYBIND;
  const previousFocus = api.renderer.currentFocusedRenderable;

  const dialogState: AnswerDialogState = {
    entries: [],
    streamingAnswer: "",
    loading: false,
    scrollbarVisible: false,
  };

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
      message: `btw hidden. Press ${hideKey} to show it.`,
      duration: 1000,
    });
  };

  const closeFromUser = async () => {
    api.ui.toast({
      variant: "info",
      message: "btw mini-session closed.",
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
      modelName,
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
        message: "btw session is still opening.",
      });
      return false;
    }

    dialogState.error = undefined;
    dialogState.loading = true;
    dialogState.streamingAnswer = "";
    renderOverlay({ focusInput: true });

    void (async () => {
      try {
        await api.client.session.promptAsync(
          {
            sessionID: tempSessionID,
            system,
            agent: BTW_AGENT,
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
        title: "btw (ephemeral)",
        directory: api.state.path.directory,
        agent: BTW_AGENT,
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
          api.ui.toast({
            variant: "success",
            message: "btw model reset to default.",
          });
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

function buildSystemPrompt(context: string) {
  const toolNote =
    "This side session is read-only. Never modify files, run write-capable tools, or change project state. You may use only the available safe read-only tools if the provided context is not enough, but prefer answering from the session context first.";
  const intro =
    "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.";

  return `${intro} ${toolNote}\n\n<session-context>\n${context}\n</session-context>`;
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

  return SAFE_TOOL_PERMISSION_IDS;
}

function buildToolSelection(toolIDs: string[]) {
  return Object.fromEntries(
    toolIDs.map((toolID) => [
      toolID,
      SAFE_TOOL_PERMISSION_IDS.includes(toolID),
    ]),
  );
}

function buildPermissionRules(toolIDs: string[]): PermissionRuleset {
  const permissionIDs = [
    ...new Set([...toolIDs, ...ADDITIONAL_PERMISSION_IDS]),
  ];
  return permissionIDs.map((permission) => ({
    permission,
    pattern: "*",
    action: SAFE_TOOL_PERMISSION_IDS.includes(permission) ? "allow" : "deny",
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
  return ["[Context from a btw mini-session]", transcript, "---\n"].join(
    "\n\n",
  );
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
