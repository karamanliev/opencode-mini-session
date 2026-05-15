import type { ResolvedModel, SessionEntry } from "./types";

export function resolveModel(
  modelOverride: string | null,
  entries: SessionEntry[],
  selectedModel?: ResolvedModel,
): ResolvedModel {
  if (selectedModel?.model) return selectedModel;
  if (modelOverride) return { model: parseModelOverride(modelOverride) };

  let assistantFallback: ResolvedModel | undefined;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { info } = entries[index];
    if (info.role === "user") {
      return {
        model: {
          providerID: info.model.providerID,
          modelID: info.model.modelID,
        },
        variant: info.model.variant,
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

  if (assistantFallback) return assistantFallback;

  return {};
}

export function parseModelOverride(value: string) {
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function formatResolvedModel(resolved: ResolvedModel) {
  if (!resolved.model) return "default";
  const base = `${resolved.model.providerID}/${resolved.model.modelID}`;
  return resolved.variant ? `${base} (${resolved.variant})` : base;
}
