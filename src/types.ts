import type { ScrollBoxRenderable } from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Message, Part } from "@opencode-ai/sdk/v2";

export type BtwConfig = {
  model: string | null;
  tokenLimit: number;
  keybind: string | false;
  allowTools: boolean;
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
  error?: string;
};

export type AnswerDialogProps = {
  api: TuiPluginApi;
  title: string;
  modelName: string;
  state: AnswerDialogState;
  canContinue: boolean;
  onScroller?: (scroller: ScrollBoxRenderable | undefined) => void;
  onHide: () => void;
  onClose: () => void;
  onContinue: () => void;
};

export type OverlayState = Omit<AnswerDialogProps, "state"> & {
  state: AnswerDialogState;
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
};
