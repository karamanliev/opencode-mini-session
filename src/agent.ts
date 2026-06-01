import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Agent, PermissionRuleset } from "@opencode-ai/sdk/v2";
import { DEFAULT_ALLOWED_TOOLS } from "./constants";
import { formatResolvedModel } from "./model";
import type { MiniConfig, ResolvedModel } from "./types";

const MINI_SIDE_QUESTION_INSTRUCTION =
  "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.";

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

export type MiniAgentMode = "plugin-managed" | "custom-agent";
export type MiniPermissionSource = "plugin-managed" | "agent";

export type MiniAgentModeResolution =
  | {
      mode: "plugin-managed";
      requestedAgent: string | null;
      missingAgent?: string;
      unavailableAgent?: string;
    }
  | {
      mode: "custom-agent";
      requestedAgent: string;
      agent: string;
    };

export type PluginManagedMiniAgent = {
  mode: "plugin-managed";
  requestedAgent: string | null;
  missingAgent?: string;
  unavailableAgent?: string;
  agent: null;
  allowedTools: string[];
  permission: PermissionRuleset;
  permissionSource: "plugin-managed";
  notices: string[];
};

export type CustomMiniAgent = {
  mode: "custom-agent";
  requestedAgent: string;
  agent: string;
  allowedTools: null;
  permission?: undefined;
  permissionSource: "agent";
  notices: string[];
};

export type ResolvedMiniAgent = PluginManagedMiniAgent | CustomMiniAgent;

export type MiniSessionCreatePayload = {
  parentID: string;
  title: string;
  directory: string;
  agent?: string;
  permission?: PermissionRuleset;
};

export type MiniPromptPayload = {
  sessionID: string;
  system: string;
  agent?: string;
  model?: NonNullable<ResolvedModel["model"]>;
  variant?: string;
  parts: Array<{ type: "text"; text: string }>;
};

export async function resolveRuntimeMiniAgent(
  api: TuiPluginApi,
  config: MiniConfig,
): Promise<ResolvedMiniAgent> {
  const agents = await getAvailableAgents(api);
  const mode = resolveMiniAgentMode(config, agents);
  const toolIDs =
    mode.mode === "plugin-managed" ? await getAvailableToolIDs(api) : [];

  return buildResolvedMiniAgent(config, mode, toolIDs);
}

export function resolveMiniAgent(
  config: MiniConfig,
  agents: Pick<Agent, "name">[] | null,
  availableToolIDs: string[] = DEFAULT_ALLOWED_TOOLS,
): ResolvedMiniAgent {
  return buildResolvedMiniAgent(
    config,
    resolveMiniAgentMode(config, agents),
    availableToolIDs,
  );
}

export function resolveMiniAgentMode(
  config: MiniConfig,
  agents: Pick<Agent, "name">[] | null,
): MiniAgentModeResolution {
  if (!config.agent) {
    return { mode: "plugin-managed", requestedAgent: null };
  }

  if (agents === null) {
    return {
      mode: "plugin-managed",
      requestedAgent: config.agent,
      unavailableAgent: config.agent,
    };
  }

  const match = agents.find((agent) => agent.name === config.agent);
  if (match) {
    return {
      mode: "custom-agent",
      requestedAgent: config.agent,
      agent: match.name,
    };
  }

  return {
    mode: "plugin-managed",
    requestedAgent: config.agent,
    missingAgent: config.agent,
  };
}

export function buildResolvedMiniAgent(
  config: MiniConfig,
  mode: MiniAgentModeResolution,
  availableToolIDs: string[],
): ResolvedMiniAgent {
  if (mode.mode === "custom-agent") {
    return {
      mode: "custom-agent",
      requestedAgent: mode.requestedAgent,
      agent: mode.agent,
      allowedTools: null,
      permissionSource: "agent",
      notices: buildMiniAgentNotices(config, mode),
    };
  }

  const allowedTools = resolveCompatibleAllowedTools(
    config.allowedTools,
    availableToolIDs,
  );

  return {
    mode: "plugin-managed",
    requestedAgent: mode.requestedAgent,
    missingAgent: mode.missingAgent,
    unavailableAgent: mode.unavailableAgent,
    agent: null,
    allowedTools,
    permission: buildPermissionRules(availableToolIDs, allowedTools),
    permissionSource: "plugin-managed",
    notices: buildMiniAgentNotices(config, mode),
  };
}

export function buildMiniSystemPrompt(
  context: string,
  resolved: ResolvedMiniAgent,
) {
  const intro = buildMiniSystemIntro(resolved);
  const toolNote =
    resolved.mode === "plugin-managed"
      ? buildAllowedToolSystemNote(resolved.allowedTools)
      : "";

  return `${intro}${toolNote}\n\n<session-context>\n${context}\n</session-context>`;
}

function buildMiniSystemIntro(resolved: ResolvedMiniAgent) {
  if (resolved.mode !== "custom-agent") return MINI_SIDE_QUESTION_INSTRUCTION;

  return `You are answering a quick side question about an ongoing coding session and you are running as the configured OpenCode agent "${resolved.agent}". Follow that agent's own instructions, role, tone, and constraints closely while answering this as a mini side question. Below is the conversation context from the session.`;
}

export function buildMiniSessionCreatePayload(
  resolved: ResolvedMiniAgent,
  base: MiniSessionCreatePayload,
): MiniSessionCreatePayload {
  return {
    ...base,
    ...(resolved.mode === "custom-agent" ? { agent: resolved.agent } : {}),
    ...(resolved.mode === "plugin-managed"
      ? { permission: resolved.permission }
      : {}),
  };
}

export function buildMiniPromptPayload(
  resolved: ResolvedMiniAgent,
  options: {
    sessionID: string;
    system: string;
    prompt: string;
    resolvedModel: ResolvedModel;
  },
): MiniPromptPayload {
  return {
    sessionID: options.sessionID,
    system: options.system,
    parts: [{ type: "text", text: options.prompt }],
    ...(resolved.mode === "custom-agent" ? { agent: resolved.agent } : {}),
    ...(options.resolvedModel.model ? { model: options.resolvedModel.model } : {}),
    ...(options.resolvedModel.variant
      ? { variant: options.resolvedModel.variant }
      : {}),
  };
}

export function formatMiniNotice(...notices: Array<string | undefined>) {
  const filtered = notices.filter(
    (notice): notice is string => typeof notice === "string" && Boolean(notice),
  );
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

export function formatMiniAgentDiagnostics(resolved: ResolvedMiniAgent) {
  const fields = [
    `mode=${resolved.mode}`,
    `agent=${resolved.agent ?? "(default)"}`,
    `permission=${resolved.permissionSource}`,
  ];

  if (resolved.mode === "plugin-managed" && resolved.requestedAgent) {
    fields.push(`requestedAgent=${resolved.requestedAgent}`);
  }

  if (resolved.mode === "plugin-managed") {
    fields.push(`tools=${resolved.allowedTools.length}`);
  }

  return fields;
}

export function buildMiniErrorDetail(options: {
  path: string;
  sessionID?: string;
  resolvedModel: ResolvedModel;
  resolvedAgent: ResolvedMiniAgent;
}) {
  return [
    `Diagnostics: path=${options.path}`,
    `session=${options.sessionID ?? "pending"}`,
    ...formatMiniAgentDiagnostics(options.resolvedAgent),
    `model=${formatResolvedModel(options.resolvedModel)}`,
  ].join(", ");
}

async function getAvailableAgents(api: TuiPluginApi): Promise<Agent[] | null> {
  try {
    const result = await api.client.app.agents(
      { directory: api.state.path.directory },
      { throwOnError: true },
    );
    if (Array.isArray(result.data)) return result.data;
  } catch {
    return null;
  }

  return null;
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

  return DEFAULT_ALLOWED_TOOLS;
}

function buildMiniAgentNotices(
  config: MiniConfig,
  mode: MiniAgentModeResolution,
) {
  const notices: string[] = [];

  if (mode.mode === "plugin-managed" && mode.missingAgent) {
    notices.push(
      `Configured mini agent ${mode.missingAgent} was not found. Falling back to plugin-managed mini mode.`,
    );
  }

  if (mode.mode === "plugin-managed" && mode.unavailableAgent) {
    notices.push(
      `Could not verify configured mini agent ${mode.unavailableAgent} because the agent list is unavailable. Falling back to plugin-managed mini mode.`,
    );
  }

  if (config.allowedToolsProvided && config.allowedTools !== null) {
    notices.push(
      mode.mode === "custom-agent"
        ? "allowedTools is deprecated and ignored because agent is configured. Configure permissions on the OpenCode agent instead."
        : "allowedTools is deprecated and will be removed in the next release. Configure an OpenCode agent with permissions instead.",
    );
  }

  return notices;
}

function buildAllowedToolSystemNote(allowedTools: string[]) {
  return allowedTools.length === 0
    ? " No tools are available in this session. Do not attempt to use any tools."
    : ` You may only use the following tools: ${allowedTools.join(", ")}. Do not attempt to use any other tools.`;
}

// TODO(vNext): remove allowedTools compatibility.
function resolveCompatibleAllowedTools(
  allowedTools: string[] | null,
  availableToolIDs: string[],
): string[] {
  if (allowedTools === null) return DEFAULT_ALLOWED_TOOLS;
  if (allowedTools.includes("*")) return [...availableToolIDs];
  return [...allowedTools];
}

// TODO(vNext): remove allowedTools compatibility.
function buildPermissionRules(
  toolIDs: string[],
  allowedTools: string[],
): PermissionRuleset {
  const permissionIDs = [
    ...new Set([...toolIDs, ...ADDITIONAL_PERMISSION_IDS, ...allowedTools]),
  ];
  return permissionIDs.map((permission) => ({
    permission,
    pattern: "*",
    action: allowedTools.includes(permission) ? "allow" : "deny",
  }));
}
