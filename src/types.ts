import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Message, Part } from "@opencode-ai/sdk/v2";
import type { FooterCounterState } from "./counter";

export type MiniConfig = {
  model: string | null;
  variant: string | null;
  agent: string | null;
  tokenLimit: number;
  keybind: string | false;
  freshKeybind: string | false;
  enableThinking: boolean;
  toggleThinkingKeybind: string | false;
  allowedTools: string[] | null;
  allowedToolsProvided: boolean;
};

export type MiniMode = "main" | "fresh";

export type SessionEntry = {
  info: Message;
  parts: Part[];
};

export type ResolvedModel = {
  model?: {
    providerID: string;
    modelID: string;
  };
  variant?: string;
};

export type ModelPreference = ResolvedModel | undefined;

export type ModelPreferenceState = {
  get: () => ModelPreference;
  set: (model: ModelPreference) => void;
};

export type ThinkingPreferenceState = {
  get: () => boolean;
  set: (enabled: boolean) => void;
};

export type ActiveDialog = {
  get: () => ActiveDialogController | undefined;
  set: (dialog: ActiveDialogController | undefined) => void;
};

export type ActiveDialogController = {
  close: () => Promise<void>;
  hide: () => void;
  show: () => void;
  isVisible: () => boolean;
};

export type AnswerDialogState = {
  mode: MiniMode;
  entries: SessionEntry[];
  streamingAnswer: string;
  loading: boolean;
  scrollbarVisible: boolean;
  spinnerFrame: number;
  copiedContextTokens?: number;
  copiedContextTotalTokens?: number;
  lastCompletedMiniInputTokens?: number;
  modelContextWindow?: number;
  footerCounter: FooterCounterState;
  inputPlaceholder?: string;
  thinkingEnabled: boolean;
  expandedThinkingPartIDs: Record<string, true>;
  notice?: string;
  update?: string;
  error?: string;
  errorDetail?: string;
  messageModels: Record<string, string>;
};

export type AnswerDialogProps = {
  api: TuiPluginApi;
  title: string;
  version?: string;
  modelName: string;
  hideKey: string | false;
  toggleThinkingKeybind: string | false;
  state: AnswerDialogState;
  onScroller?: (scroller: ScrollBoxRenderable | undefined) => void;
  onInput?: (input: InputRenderable | undefined) => void;
  onHide: () => void;
  onClose: () => void;
  onContinue: () => void;
  onChangeModel: () => void;
  onToggleThinking: () => void;
  onToggleThinkingPart: (partID: string) => void;
  onSubmit: (value: string) => boolean;
};

export type OverlayState = AnswerDialogProps & {
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
};
