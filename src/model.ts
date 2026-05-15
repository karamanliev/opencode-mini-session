import type { ResolvedModel, SessionEntry } from "./types";

export function resolveModel(
  modelOverride: string | null,
  entries: SessionEntry[],
): ResolvedModel {
  if (modelOverride) return { model: parseModelOverride(modelOverride) };

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

    return {
      model: {
        providerID: info.providerID,
        modelID: info.modelID,
      },
      variant: info.variant,
    };
  }

  return {};
}

function parseModelOverride(value: string) {
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
