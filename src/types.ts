import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { SessionMessageInfo } from "@opencode/client";
import type { FooterCounterState } from "./counter";
import type { TuiContext } from "./opencode";

export type ContinueAction = "queue" | "clipboard";

export type RecapScope = "project" | "all";

export type RecapQuery = {
  term: string;
  excludes: string[];
  scope?: RecapScope;
};

export type MiniConfig = {
  model: string | null;
  variant: string | null;
  agent: string | null;
  tokenLimit: number;
  keybind: string | false;
  freshKeybind: string | false;
  enableThinking: boolean;
  toggleThinkingKeybind: string | false;
  tools: string[];
  continueAction: ContinueAction;
  cleanupStaleSessions: boolean;
  recapKeybind: string | false;
  recapScope: RecapScope;
  recapSessions: number;
  recapScanLimit: number;
  recapMinScore: number;
  recapExcludeDirs: string[];
};

export type MiniMode = "main" | "fresh" | "recap";

export type SessionToolStatus = "streaming" | "running" | "completed" | "error";

export type SessionPart =
  | { type: "text"; text: string }
  | {
      type: "reasoning";
      id: string;
      text: string;
      time?: { created?: number; completed?: number };
    }
  | {
      type: "tool";
      name: string;
      status: SessionToolStatus;
      input?: Record<string, unknown>;
      title?: string;
    };

export type SessionEntry = {
  info: SessionMessageInfo;
  parts: SessionPart[];
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
  loading: boolean;
  waitingForResponse: boolean;
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
  api: TuiContext;
  title: string;
  version?: string;
  modelName: string;
  hideKey: string | false;
  toggleThinkingKeybind: string | false;
  continueLabel: string;
  continueOnError?: boolean;
  state: AnswerDialogState;
  onScroller?: (scroller: ScrollBoxRenderable | undefined) => void;
  onInput?: (input: InputRenderable | undefined) => void;
  onHide: () => void;
  onClose: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onEmptySubmit?: () => void;
  onChangeModel: () => void;
  onToggleThinking: () => void;
  onToggleThinkingPart: (partID: string) => void;
  onSubmit: (value: string) => boolean;
};

export type OverlayState = AnswerDialogProps & {
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
  submit: () => void;
};
