import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Message, Part } from "@opencode-ai/sdk/v2";

export type MiniConfig = {
  model: string | null;
  tokenLimit: number;
  keybind: string | false;
  allowedTools: string[] | null;
};

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
  entries: SessionEntry[];
  streamingAnswer: string;
  loading: boolean;
  scrollbarVisible: boolean;
  notice?: string;
  error?: string;
  errorDetail?: string;
  messageModels: Record<string, string>;
};

export type AnswerDialogProps = {
  api: TuiPluginApi;
  title: string;
  version?: string;
  modelName: string;
  hideKey: string;
  state: AnswerDialogState;
  onScroller?: (scroller: ScrollBoxRenderable | undefined) => void;
  onInput?: (input: InputRenderable | undefined) => void;
  onHide: () => void;
  onClose: () => void;
  onContinue: () => void;
  onChangeModel: () => void;
  onSubmit: (value: string) => boolean;
};

export type OverlayState = AnswerDialogProps & {
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
};
