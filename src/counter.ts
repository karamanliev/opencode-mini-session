import type { MiniMode } from "./types";

export const MINI_SESSION_WARNING_PERCENT = 85;
export const MINI_SESSION_LIMIT_PERCENT = 95;

export type FooterCounterState = {
  copiedContext?: {
    usedTokens: number;
    totalAvailableTokens: number;
    tokenLimit: number;
    text: string;
    truncated: boolean;
  };
  miniSession?: {
    usedTokens: number;
    percentUsed?: number;
    text: string;
    warning: boolean;
    limitReached: boolean;
  };
  placeholder?: string;
};

export function formatTokenCount(value: number) {
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function getUsagePercent(usedTokens: number, limit: number) {
  if (limit <= 0) return undefined;
  return (usedTokens / limit) * 100;
}

export function getDisplayPercent(usedTokens: number, limit: number) {
  const percent = getUsagePercent(usedTokens, limit);
  return percent === undefined ? undefined : Math.round(percent);
}

export function isMiniSessionWarning(percentUsed?: number) {
  return Boolean(percentUsed !== undefined && percentUsed >= MINI_SESSION_WARNING_PERCENT);
}

export function isMiniSessionLimitReached(percentUsed?: number) {
  return Boolean(percentUsed !== undefined && percentUsed >= MINI_SESSION_LIMIT_PERCENT);
}

export function buildFooterCounterState(options: {
  mode: MiniMode;
  copiedContextTokens?: number;
  copiedContextTotalTokens?: number;
  tokenLimit: number;
  lastCompletedMiniInputTokens?: number;
  modelContextWindow?: number;
}): FooterCounterState {
  const copiedContextTotalTokens =
    options.copiedContextTotalTokens ?? options.copiedContextTokens;
  const copiedContextTruncated =
    options.copiedContextTokens !== undefined &&
    copiedContextTotalTokens !== undefined &&
    copiedContextTotalTokens > options.copiedContextTokens;
  const copiedContext =
    options.mode === "main" && options.copiedContextTokens !== undefined
      ? {
          usedTokens: options.copiedContextTokens,
          totalAvailableTokens: copiedContextTotalTokens ?? options.copiedContextTokens,
          tokenLimit: options.tokenLimit,
          text: formatCopiedContextCounter(
            options.copiedContextTokens,
            copiedContextTotalTokens ?? options.copiedContextTokens,
            options.tokenLimit,
          ),
          truncated: copiedContextTruncated,
        }
      : undefined;

  const miniSession =
    options.lastCompletedMiniInputTokens !== undefined
      ? buildMiniSessionCounter(
          options.lastCompletedMiniInputTokens,
          options.modelContextWindow,
        )
      : undefined;

  return {
    copiedContext,
    miniSession,
    placeholder:
      miniSession?.limitReached ? "Session context limit reached..." : undefined,
  };
}

function formatCopiedContextCounter(
  usedTokens: number,
  totalAvailableTokens: number,
  tokenLimit: number,
) {
  if (totalAvailableTokens <= usedTokens) return `main ${formatTokenCount(usedTokens)}`;
  return `main ${formatTokenCount(Math.min(usedTokens, tokenLimit))}/${formatTokenCount(totalAvailableTokens)}`;
}

function buildMiniSessionCounter(usedTokens: number, modelContextWindow?: number) {
  const percentUsed =
    modelContextWindow !== undefined
      ? getDisplayPercent(usedTokens, modelContextWindow)
      : undefined;

  return {
    usedTokens,
    percentUsed,
    text:
      percentUsed !== undefined
        ? `${formatTokenCount(usedTokens)} (${formatPercent(percentUsed)})`
        : formatTokenCount(usedTokens),
    warning: isMiniSessionWarning(percentUsed),
    limitReached: isMiniSessionLimitReached(percentUsed),
  };
}
