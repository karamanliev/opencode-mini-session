import type { AgentInfo, PermissionRule } from "@opencode/client";
import { formatResolvedModel } from "./model";
import type { TuiContext } from "./opencode";
import type { MiniConfig, MiniMode, ResolvedModel } from "./types";

const MINI_SIDE_QUESTION_INSTRUCTION =
  "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.";

const MINI_FRESH_INSTRUCTION =
  "You are answering a quick side question about an ongoing coding session. No conversation context from the main session has been copied into this mini session. Answer concisely based only on the current mini-session messages and any tools or files you inspect.";

const MINI_RECAP_INSTRUCTION =
  "You are writing a consolidated recap of a project from a digest of past assistant sessions. The digest is provided below: each section covers one session with its objective, sampled requests, extracted facts and final reported state. Write the recap from the digest only; do not investigate the workspace and do not call tools.";

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
  permission: PermissionRule[];
  permissionSource: "plugin-managed";
  tools: string[];
  notices: string[];
};

export type CustomMiniAgent = {
  mode: "custom-agent";
  requestedAgent: string;
  agent: string;
  permission?: undefined;
  permissionSource: "agent";
  notices: string[];
};

export type ResolvedMiniAgent = PluginManagedMiniAgent | CustomMiniAgent;

export type MiniSessionCreatePayload = {
  title: string;
  metadata?: Record<string, boolean>;
  location?: { directory: string };
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permissions?: PermissionRule[];
};

export type MiniPromptPayload = {
  sessionID: string;
  text: string;
};

export async function resolveRuntimeMiniAgent(
  ctx: TuiContext,
  config: MiniConfig,
): Promise<ResolvedMiniAgent> {
  const agents = await getAvailableAgents(ctx);
  const mode = resolveMiniAgentMode(config, agents);
  return buildResolvedMiniAgent(config, mode);
}

export function resolveMiniAgent(
  config: MiniConfig,
  agents: Pick<AgentInfo, "name">[] | null,
): ResolvedMiniAgent {
  return buildResolvedMiniAgent(config, resolveMiniAgentMode(config, agents));
}

export function resolveMiniAgentMode(
  config: MiniConfig,
  agents: Pick<AgentInfo, "name">[] | null,
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
): ResolvedMiniAgent {
  if (mode.mode === "custom-agent") {
    return {
      mode: "custom-agent",
      requestedAgent: mode.requestedAgent,
      agent: mode.agent,
      permissionSource: "agent",
      notices: buildMiniAgentNotices(config, mode),
    };
  }

  return {
    mode: "plugin-managed",
    requestedAgent: mode.requestedAgent,
    missingAgent: mode.missingAgent,
    unavailableAgent: mode.unavailableAgent,
    agent: null,
    permission: buildPermissionRules(config.tools),
    permissionSource: "plugin-managed",
    tools: [...config.tools],
    notices: buildMiniAgentNotices(config, mode),
  };
}

export function buildMiniSystemPrompt(
  context: string,
  resolved: ResolvedMiniAgent,
  mode: MiniMode = "main",
  directory?: string,
) {
  const intro = buildMiniSystemIntro(resolved, mode);
  const toolNote =
    resolved.mode === "plugin-managed"
      ? buildToolSystemNote(resolved.tools, directory)
      : "";

  const tag = mode === "recap" ? "recap-context" : "session-context";
  const sessionContext = context.trim()
    ? `\n\n<${tag}>\n${context}\n</${tag}>`
    : "";

  return `${intro}${toolNote}${sessionContext}`;
}

function buildMiniSystemIntro(resolved: ResolvedMiniAgent, mode: MiniMode) {
  if (mode === "recap") {
    if (resolved.mode !== "custom-agent") return MINI_RECAP_INSTRUCTION;
    return `You are writing a consolidated recap of a project from a digest of past assistant sessions and you are running as the configured OpenCode agent "${resolved.agent}". Follow that agent's own instructions, role, tone, and constraints closely while producing this recap. Below is the digest of past sessions.`;
  }

  if (resolved.mode !== "custom-agent") {
    return mode === "fresh"
      ? MINI_FRESH_INSTRUCTION
      : MINI_SIDE_QUESTION_INSTRUCTION;
  }

  if (mode === "fresh") {
    return `You are answering a quick side question about an ongoing coding session and you are running as the configured OpenCode agent "${resolved.agent}". Follow that agent's own instructions, role, tone, and constraints closely while answering this as a mini side question. No conversation context from the main session has been copied into this mini session.`;
  }

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
      ? { permissions: resolved.permission }
      : {}),
  };
}

export function buildMiniPromptPayload(
  options: { sessionID: string; prompt: string },
): MiniPromptPayload {
  return {
    sessionID: options.sessionID,
    text: options.prompt,
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
    fields.push(`tools=${resolved.tools.length}`);
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

async function getAvailableAgents(
  ctx: TuiContext,
): Promise<AgentInfo[] | null> {
  try {
    const result = await ctx.client.agent.list();
    if (Array.isArray(result.data)) return result.data;
  } catch {
    return null;
  }

  return null;
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

  return notices;
}

function buildToolSystemNote(tools: string[], directory?: string) {
  const location = directory ? ` The working directory is ${directory}.` : "";
  return `${location} You may only use the following tools: ${tools.join(", ")}. Do not attempt to use any other tools. Prefer the read tool to open files you can name; relative paths resolve from the working directory, and read on a directory lists its entries. Use glob or grep only to locate paths you do not know.`;
}

export function buildPermissionRules(
  tools: string[],
): PermissionRule[] {
  return [
    { action: "*", resource: "*", effect: "deny" },
    ...tools.map((action) => ({
      action,
      resource: "*",
      effect: "allow" as const,
    })),
  ];
}
