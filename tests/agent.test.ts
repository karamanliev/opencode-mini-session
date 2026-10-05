import type { AgentInfo, PermissionRule } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  buildMiniErrorDetail,
  buildMiniPromptPayload,
  buildMiniSessionCreatePayload,
  buildMiniSystemPrompt,
  resolveMiniAgent,
} from "../src/agent";
import { parseConfig } from "../src/config";
import { DEFAULT_ALLOWED_TOOLS } from "../src/constants";
import type { MiniConfig } from "../src/types";

function config(overrides: Partial<MiniConfig> = {}): MiniConfig {
  return {
    model: null,
    variant: null,
    agent: null,
    tokenLimit: 50_000,
    keybind: "alt+b",
    freshKeybind: "alt+n",
    enableThinking: false,
    toggleThinkingKeybind: "ctrl+t",
    tools: [...DEFAULT_ALLOWED_TOOLS],
    continueAction: "queue",
    cleanupStaleSessions: true,
    recapKeybind: false,
    recapScope: "project",
    recapSessions: 15,
    recapScanLimit: 50,
    recapMinScore: 4,
    recapExcludeDirs: [],
    ...overrides,
  };
}

function agent(
  name: string,
  mode: AgentInfo["mode"] = "primary",
  hidden = false,
): AgentInfo {
  return {
    id: name,
    name,
    mode,
    hidden,
    request: {},
    permissions: [],
  } as unknown as AgentInfo;
}

function effectFor(rules: PermissionRule[], action: string) {
  let effect: PermissionRule["effect"] | undefined;
  for (const rule of rules) {
    if (rule.action === action || rule.action === "*") effect = rule.effect;
  }
  return effect;
}

function asPluginManaged(resolved: ReturnType<typeof resolveMiniAgent>) {
  expect(resolved.mode).toBe("plugin-managed");
  if (resolved.mode !== "plugin-managed") {
    throw new Error("expected plugin-managed mode");
  }
  return resolved;
}

describe("config parsing", () => {
  it("parses agent names and normalizes invalid values to null", () => {
    expect(parseConfig({}).agent).toBeNull();
    expect(parseConfig({ agent: null }).agent).toBeNull();
    expect(parseConfig({ agent: 123 }).agent).toBeNull();
    expect(parseConfig({ agent: "" }).agent).toBeNull();
    expect(parseConfig({ agent: " build " }).agent).toBe("build");
  });

  it("parses variant values and normalizes invalid values to null", () => {
    expect(parseConfig({}).variant).toBeNull();
    expect(parseConfig({ variant: null }).variant).toBeNull();
    expect(parseConfig({ variant: 123 }).variant).toBeNull();
    expect(parseConfig({ variant: "" }).variant).toBeNull();
    expect(parseConfig({ variant: " fast " }).variant).toBe("fast");
  });

  it("parses thinking config defaults and explicit values", () => {
    expect(parseConfig({}).enableThinking).toBe(false);
    expect(parseConfig({ enableThinking: false }).enableThinking).toBe(false);
    expect(parseConfig({ enableThinking: true }).enableThinking).toBe(true);
    expect(parseConfig({ enableThinking: "false" }).enableThinking).toBe(false);
  });

  it("parses thinking keybind values", () => {
    expect(parseConfig({}).toggleThinkingKeybind).toBe("ctrl+t");
    expect(
      parseConfig({ toggleThinkingKeybind: " ctrl+r " }).toggleThinkingKeybind,
    ).toBe("ctrl+r");
    expect(
      parseConfig({ toggleThinkingKeybind: false }).toggleThinkingKeybind,
    ).toBe(false);
    expect(
      parseConfig({ toggleThinkingKeybind: "none" }).toggleThinkingKeybind,
    ).toBe(false);
  });

  it("disables the main keybind with false or none", () => {
    expect(parseConfig({ keybind: false }).keybind).toBe(false);
    expect(parseConfig({ keybind: "none" }).keybind).toBe(false);
  });

  it("parses fresh keybind values", () => {
    expect(parseConfig({}).freshKeybind).toBe("alt+n");
    expect(parseConfig({ freshKeybind: " alt+f " }).freshKeybind).toBe("alt+f");
    expect(parseConfig({ freshKeybind: false }).freshKeybind).toBe(false);
    expect(parseConfig({ freshKeybind: "none" }).freshKeybind).toBe(false);
  });

  it("parses tools with a read-only whitelist", () => {
    expect(parseConfig({}).tools).toEqual(DEFAULT_ALLOWED_TOOLS);
    expect(parseConfig({ tools: ["read", "websearch"] }).tools).toEqual([
      "read",
      "websearch",
    ]);
    expect(
      parseConfig({ tools: ["read", "read", "websearch", "bogus"] }).tools,
    ).toEqual(["read", "websearch"]);
    expect(parseConfig({ tools: ["edit", "shell"] }).tools).toEqual(
      DEFAULT_ALLOWED_TOOLS,
    );
    expect(parseConfig({ tools: [] }).tools).toEqual(DEFAULT_ALLOWED_TOOLS);
    expect(parseConfig({ tools: "read" }).tools).toEqual(DEFAULT_ALLOWED_TOOLS);
  });

  it("parses model and tokenLimit values", () => {
    expect(parseConfig({}).model).toBeNull();
    expect(parseConfig({ model: " anthropic/claude " }).model).toBe(
      "anthropic/claude",
    );
    expect(parseConfig({ model: 123 }).model).toBeNull();
    expect(parseConfig({}).tokenLimit).toBe(50_000);
    expect(parseConfig({ tokenLimit: 1234.9 }).tokenLimit).toBe(1234);
    expect(parseConfig({ tokenLimit: -5 }).tokenLimit).toBe(50_000);
    expect(parseConfig({ tokenLimit: "100" }).tokenLimit).toBe(50_000);
  });

  it("parses continueAction and cleanupStaleSessions", () => {
    expect(parseConfig({}).continueAction).toBe("queue");
    expect(parseConfig({ continueAction: "clipboard" }).continueAction).toBe(
      "clipboard",
    );
    expect(parseConfig({ continueAction: "bogus" }).continueAction).toBe(
      "queue",
    );
    expect(parseConfig({}).cleanupStaleSessions).toBe(true);
    expect(
      parseConfig({ cleanupStaleSessions: false }).cleanupStaleSessions,
    ).toBe(false);
  });

  it("parses the recap options", () => {
    const defaults = parseConfig({});
    expect(defaults.recapKeybind).toBe(false);
    expect(defaults.recapScope).toBe("project");
    expect(defaults.recapSessions).toBe(15);
    expect(defaults.recapScanLimit).toBe(50);
    expect(defaults.recapMinScore).toBe(4);
    expect(defaults.recapExcludeDirs).toEqual([]);

    expect(parseConfig({ recapKeybind: "alt+r" }).recapKeybind).toBe("alt+r");
    expect(parseConfig({ recapKeybind: "none" }).recapKeybind).toBe(false);
    expect(parseConfig({ recapScope: "all" }).recapScope).toBe("all");
    expect(parseConfig({ recapScope: "bogus" }).recapScope).toBe("project");
    expect(parseConfig({ recapSessions: 3.9 }).recapSessions).toBe(3);
    expect(parseConfig({ recapSessions: 0 }).recapSessions).toBe(15);
    expect(parseConfig({ recapScanLimit: "10" }).recapScanLimit).toBe(50);
    expect(parseConfig({ recapMinScore: 0 }).recapMinScore).toBe(0);
    expect(parseConfig({ recapMinScore: -1 }).recapMinScore).toBe(4);
    expect(
      parseConfig({ recapExcludeDirs: [" /tmp/private ", "/tmp/private", 7] })
        .recapExcludeDirs,
    ).toEqual(["/tmp/private"]);
  });
});

describe("agent resolution", () => {
  it("uses plugin-managed mode when agent is omitted", () => {
    const resolved = asPluginManaged(resolveMiniAgent(config(), [agent("build")]));

    expect(resolved.agent).toBeNull();
    expect(resolved.notices).toEqual([]);
  });

  it.each(["primary", "subagent", "all"] as const)(
    "accepts existing %s agents",
    (mode) => {
      const resolved = resolveMiniAgent(config({ agent: mode }), [
        agent(mode, mode),
      ]);

      expect(resolved.mode).toBe("custom-agent");
      expect(resolved.agent).toBe(mode);
      expect(resolved.permissionSource).toBe("agent");
    },
  );

  it("accepts hidden agents", () => {
    const resolved = resolveMiniAgent(config({ agent: "summary" }), [
      agent("summary", "subagent", true),
    ]);

    expect(resolved.mode).toBe("custom-agent");
    expect(resolved.agent).toBe("summary");
  });

  it("falls back when the configured agent is missing", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(config({ agent: "missing" }), [agent("build")]),
    );

    expect(resolved.missingAgent).toBe("missing");
    expect(resolved.notices.join(" ")).toContain("was not found");
  });

  it("falls back when the agent list is unavailable", () => {
    const resolved = asPluginManaged(resolveMiniAgent(config({ agent: "build" }), null));

    expect(resolved.agent).toBeNull();
    expect(resolved.permissionSource).toBe("plugin-managed");
    expect(resolved.notices.join(" ")).toContain("Could not verify");
    expect(resolved.notices.join(" ")).toContain("Falling back");
  });
});

describe("plugin-managed permissions", () => {
  it("allows only the default read actions", () => {
    const resolved = asPluginManaged(resolveMiniAgent(config(), []));

    for (const action of DEFAULT_ALLOWED_TOOLS) {
      expect(effectFor(resolved.permission, action)).toBe("allow");
    }
    for (const action of ["edit", "shell", "subagent", "websearch"]) {
      expect(effectFor(resolved.permission, action)).toBe("deny");
    }
  });

  it("uses configured tools for permissions and system prompts", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(config({ tools: ["read", "websearch"] }), []),
    );

    expect(effectFor(resolved.permission, "read")).toBe("allow");
    expect(effectFor(resolved.permission, "websearch")).toBe("allow");
    expect(effectFor(resolved.permission, "glob")).toBe("deny");

    const prompt = buildMiniSystemPrompt("", resolved);
    expect(prompt).toContain("You may only use the following tools: read, websearch");
    expect(prompt).not.toContain("webfetch");
  });
});

describe("custom agent behavior", () => {
  it("omits plugin permissions", () => {
    const resolved = resolveMiniAgent(config({ agent: "build" }), [
      agent("build"),
    ]);

    expect(resolved.mode).toBe("custom-agent");
    expect(resolved.permission).toBeUndefined();
  });
});

describe("system prompts", () => {
  it("includes the mini instruction and context in plugin-managed mode", () => {
    const resolved = resolveMiniAgent(config(), []);
    const prompt = buildMiniSystemPrompt("main context", resolved);

    expect(prompt).toContain(
      "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.",
    );
    expect(prompt).toContain("<session-context>\nmain context\n</session-context>");
    expect(prompt).toContain("You may only use the following tools");
    expect(prompt).not.toContain("configured OpenCode agent");
  });

  it("uses the recap instruction and context tag in recap mode", () => {
    const resolved = resolveMiniAgent(config(), []);
    const prompt = buildMiniSystemPrompt("digest text", resolved, "recap");

    expect(prompt).toContain("consolidated recap");
    expect(prompt).toContain("<recap-context>\ndigest text\n</recap-context>");
    expect(prompt).not.toContain("<session-context>");
  });

  it("guides file reads toward the read tool with the working directory", () => {
    const resolved = resolveMiniAgent(config(), []);
    const prompt = buildMiniSystemPrompt(
      "main context",
      resolved,
      "main",
      "/tmp/project",
    );

    expect(prompt).toContain("The working directory is /tmp/project.");
    expect(prompt).toContain("Prefer the read tool to open files you can name");
    expect(prompt).toContain(
      "Use glob or grep only to locate paths you do not know",
    );
  });

  it("omits the working directory note when it is unknown", () => {
    const resolved = resolveMiniAgent(config(), []);
    const prompt = buildMiniSystemPrompt("main context", resolved);

    expect(prompt).not.toContain("The working directory is");
  });

  it("omits session context tags in fresh plugin-managed mode", () => {
    const resolved = resolveMiniAgent(config(), []);
    const prompt = buildMiniSystemPrompt("", resolved, "fresh");

    expect(prompt).toContain(
      "No conversation context from the main session has been copied into this mini session.",
    );
    expect(prompt).not.toContain("<session-context>");
    expect(prompt).toContain("You may only use the following tools");
  });

  it("includes custom agent guidance without tool wording in custom-agent mode", () => {
    const resolved = resolveMiniAgent(config({ agent: "build" }), [
      agent("build"),
    ]);
    const prompt = buildMiniSystemPrompt("main context", resolved);

    expect(prompt).toContain(
      'You are answering a quick side question about an ongoing coding session and you are running as the configured OpenCode agent "build". Follow that agent\'s own instructions, role, tone, and constraints closely while answering this as a mini side question. Below is the conversation context from the session.',
    );
    expect(prompt).toContain("<session-context>\nmain context\n</session-context>");
    expect(prompt).not.toContain("You may only use the following tools");
  });

  it("uses fresh custom-agent wording without context tags", () => {
    const resolved = resolveMiniAgent(config({ agent: "build" }), [
      agent("build"),
    ]);
    const prompt = buildMiniSystemPrompt("", resolved, "fresh");

    expect(prompt).toContain(
      'You are answering a quick side question about an ongoing coding session and you are running as the configured OpenCode agent "build".',
    );
    expect(prompt).toContain(
      "No conversation context from the main session has been copied into this mini session.",
    );
    expect(prompt).not.toContain("<session-context>");
    expect(prompt).not.toContain("You may only use the following tools");
  });
});

describe("payload helpers", () => {
  it("omits agent in plugin-managed session payloads", () => {
    const resolved = asPluginManaged(resolveMiniAgent(config(), []));
    const createPayload = buildMiniSessionCreatePayload(resolved, {
      title: "mini session",
      location: { directory: "/tmp/project" },
    });

    expect(createPayload).not.toHaveProperty("agent");
    expect(createPayload.permissions).toBeDefined();
  });

  it("includes agent in custom agent session payloads", () => {
    const resolved = resolveMiniAgent(config({ agent: "build" }), [
      agent("build"),
    ]);
    const createPayload = buildMiniSessionCreatePayload(resolved, {
      title: "mini session",
    });

    expect(createPayload.agent).toBe("build");
    expect(createPayload.permissions).toBeUndefined();
  });

  it("builds a plain text prompt payload", () => {
    const payload = buildMiniPromptPayload({
      sessionID: "mini",
      prompt: "question",
    });

    expect(payload).toEqual({ sessionID: "mini", text: "question" });
  });
});

describe("notices and diagnostics", () => {
  it("includes mode, agent, and permission source diagnostics", () => {
    const resolved = resolveMiniAgent(config({ agent: "build" }), [
      agent("build"),
    ]);
    const detail = buildMiniErrorDetail({
      path: "session.prompt throw",
      sessionID: "mini",
      resolvedModel: {},
      resolvedAgent: resolved,
    });

    expect(detail).toContain("mode=custom-agent");
    expect(detail).toContain("agent=build");
    expect(detail).toContain("permission=agent");
  });
});
