import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { ResolvedModel, SessionEntry } from "./types";

export type ModelSource = "config" | "session" | "unknown";

export type ResolvedModelWithSource = {
  model: ResolvedModel;
  source: ModelSource;
  notice?: string;
};

export function resolveModel(
  modelOverride: string | null,
  variantOverride: string | null,
  entries: SessionEntry[],
): ResolvedModelWithSource {
  if (modelOverride)
    return {
      model: {
        model: parseModelOverride(modelOverride),
        ...(variantOverride ? { variant: variantOverride } : {}),
      },
      source: "config",
    };

  let assistantFallback: ResolvedModel | undefined;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { info } = entries[index];
    if (info.role === "user") {
      return {
        model: {
          model: {
            providerID: info.model.providerID,
            modelID: info.model.modelID,
          },
          variant: info.model.variant,
        },
        source: "session",
      };
    }

    if (!assistantFallback) {
      assistantFallback = {
        model: {
          providerID: info.providerID,
          modelID: info.modelID,
        },
        variant: info.variant,
      };
    }
  }

  if (assistantFallback)
    return { model: assistantFallback, source: "session" };

  return { model: {}, source: "unknown" };
}

export function parseModelOverride(value: string) {
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function resolveDefaultModel(
  providers: TuiPluginApi["state"]["provider"],
  configuredModel: string | null,
  configuredVariant: string | null,
  entries: SessionEntry[],
): ResolvedModelWithSource {
  const resolved = resolveModel(configuredModel, configuredVariant, entries);
  if (resolved.source !== "config") return resolved;
  if (isAvailableModel(providers, resolved.model)) return resolved;

  return {
    ...resolveModel(null, null, entries),
    notice: `Configured mini model ${formatResolvedModel(resolved.model)} was not found. The main session model will be used.`,
  };
}

function isAvailableModel(
  providers: TuiPluginApi["state"]["provider"],
  resolved: ResolvedModel,
) {
  const model = resolved.model;
  if (!model) return false;
  const available = providers.find((provider) => provider.id === model.providerID)
    ?.models[model.modelID];
  if (!available) return false;
  return !resolved.variant || Boolean(available.variants?.[resolved.variant]);
}

export function formatResolvedModel(resolved: ResolvedModel) {
  if (!resolved.model) return "default";
  const base = `${resolved.model.providerID}/${resolved.model.modelID}`;
  return resolved.variant ? `${base} (${resolved.variant})` : base;
}

export function resolveModelContextWindow(
  providers: TuiPluginApi["state"]["provider"],
  resolved: ResolvedModel,
) {
  const model = resolved.model;
  if (!model) return undefined;
  return providers.find((provider) => provider.id === model.providerID)?.models[
    model.modelID
  ]?.limit?.context;
}
