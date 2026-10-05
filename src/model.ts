import type { ModelInfo, ProviderInfo } from "@opencode/client";
import type { ResolvedModel, SessionEntry } from "./types";

export type ModelSource = "config" | "session" | "default" | "unknown";

export type ResolvedModelWithSource = {
  model: ResolvedModel;
  source: ModelSource;
  notice?: string;
};

export function resolveModel(
  modelOverride: string | null,
  variantOverride: string | null,
  entries: SessionEntry[],
  fallbackModel?: ResolvedModel,
): ResolvedModelWithSource {
  if (modelOverride)
    return {
      model: {
        model: parseModelOverride(modelOverride),
        ...(variantOverride ? { variant: variantOverride } : {}),
      },
      source: "config",
    };

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { info } = entries[index];
    if (info.type !== "assistant") continue;
    return {
      model: {
        model: {
          providerID: info.model.providerID,
          modelID: info.model.id,
        },
        variant: info.model.variant,
      },
      source: "session",
    };
  }

  if (fallbackModel?.model) {
    return { model: fallbackModel, source: "default" };
  }

  return { model: {}, source: "unknown" };
}

export function parseModelOverride(value: string) {
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function resolveDefaultModel(
  models: ModelInfo[],
  configuredModel: string | null,
  configuredVariant: string | null,
  entries: SessionEntry[],
  fallbackModel?: ResolvedModel,
): ResolvedModelWithSource {
  const resolved = resolveModel(
    configuredModel,
    configuredVariant,
    entries,
    fallbackModel,
  );
  if (resolved.source !== "config") return resolved;
  if (isAvailableModel(models, resolved.model)) return resolved;

  return {
    ...resolveModel(null, null, entries, fallbackModel),
    notice: `Configured mini model ${formatResolvedModel(resolved.model)} was not found. The main session model will be used.`,
  };
}

function isAvailableModel(models: ModelInfo[], resolved: ResolvedModel) {
  const model = resolved.model;
  if (!model) return false;
  const available = models.find(
    (candidate) =>
      candidate.providerID === model.providerID && candidate.id === model.modelID,
  );
  if (!available) return false;
  return (
    !resolved.variant ||
    available.variants.some((variant) => variant.id === resolved.variant)
  );
}

export function formatResolvedModel(resolved: ResolvedModel) {
  if (!resolved.model) return "default";
  const base = `${resolved.model.providerID}/${resolved.model.modelID}`;
  return resolved.variant ? `${base} (${resolved.variant})` : base;
}

export function resolveModelContextWindow(
  models: ModelInfo[],
  resolved: ResolvedModel,
) {
  const model = resolved.model;
  if (!model) return undefined;
  return models.find(
    (candidate) =>
      candidate.providerID === model.providerID && candidate.id === model.modelID,
  )?.limit?.context;
}
