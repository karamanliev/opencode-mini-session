import type { Agent, PermissionRuleset } from "@opencode-ai/sdk/v2";
import { describe, expect, it } from "vitest";
import {
  buildMiniErrorDetail,
  buildMiniPromptPayload,
  buildMiniSessionCreatePayload,
  buildMiniSystemPrompt,
  resolveMiniAgent,
} from "../src/agent";
import { parseConfig } from "../src/config";
import type { MiniConfig } from "../src/types";

function config(overrides: Partial<MiniConfig> = {}): MiniConfig {
  return {
    model: null,
    agent: null,
    tokenLimit: 50_000,
    keybind: "alt+b",
    enableThinking: false,
    toggleThinkingKeybind: "ctrl+t",
    allowedTools: null,
    allowedToolsProvided: false,
    ...overrides,
  };
}

function agent(
  name: string,
  mode: Agent["mode"] = "primary",
  hidden = false,
): Agent {
  return {
    name,
    mode,
    hidden,
    permission: [],
    options: {},
  };
}

function actionFor(rules: PermissionRuleset, permission: string) {
  return rules.find((rule) => rule.permission === permission)?.action;
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

  it("tracks when allowedTools was present", () => {
    expect(parseConfig({}).allowedToolsProvided).toBe(false);
    expect(parseConfig({ allowedTools: null }).allowedToolsProvided).toBe(true);
    expect(parseConfig({ allowedTools: ["read"] }).allowedToolsProvided).toBe(
      true,
    );
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
      parseConfig({ toggleThinkingKeybind: " ctrl+r " })
        .toggleThinkingKeybind,
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
});

describe("agent resolution", () => {
  it("uses plugin-managed mode when agent is omitted", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(config(), [agent("build")], ["read"]),
    );

    expect(resolved.agent).toBeNull();
    expect(resolved.notices).toEqual([]);
  });

  it.each(["primary", "subagent", "all"] as const)(
    "accepts existing %s agents",
    (mode) => {
      const resolved = resolveMiniAgent(
        config({ agent: mode }),
        [agent(mode, mode)],
        ["read"],
      );

      expect(resolved.mode).toBe("custom-agent");
      expect(resolved.agent).toBe(mode);
      expect(resolved.permissionSource).toBe("agent");
    },
  );

  it("accepts hidden agents", () => {
    const resolved = resolveMiniAgent(
      config({ agent: "summary" }),
      [agent("summary", "subagent", true)],
      ["read"],
    );

    expect(resolved.mode).toBe("custom-agent");
    expect(resolved.agent).toBe("summary");
  });

  it("falls back when the configured agent is missing", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(
        config({ agent: "missing" }),
        [agent("build")],
        ["read"],
      ),
    );

    expect(resolved.missingAgent).toBe("missing");
    expect(resolved.notices.join(" ")).toContain("was not found");
  });

  it("falls back when the agent list is unavailable", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(config({ agent: "build" }), null, ["read"]),
    );

    expect(resolved.agent).toBeNull();
    expect(resolved.permissionSource).toBe("plugin-managed");
    expect(resolved.notices.join(" ")).toContain("Could not verify");
    expect(resolved.notices.join(" ")).toContain("Falling back");
  });
});

describe("plugin-managed permissions", () => {
  const availableTools = ["glob", "grep", "list", "read", "webfetch", "edit", "bash"];

  it("allows the default read tools", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(config(), [], availableTools),
    );

    expect(actionFor(resolved.permission, "read")).toBe("allow");
    expect(actionFor(resolved.permission, "grep")).toBe("allow");
    expect(actionFor(resolved.permission, "edit")).toBe("deny");
    expect(actionFor(resolved.permission, "bash")).toBe("deny");
  });

  it("honors an empty allowedTools list", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(
        config({ allowedTools: [], allowedToolsProvided: true }),
        [],
        availableTools,
      ),
    );

    expect(actionFor(resolved.permission, "read")).toBe("deny");
    expect(actionFor(resolved.permission, "bash")).toBe("deny");
  });

  it("honors wildcard allowedTools", () => {
    const resolved = asPluginManaged(
      resolveMiniAgent(
        config({ allowedTools: ["*"], allowedToolsProvided: true }),
        [],
        availableTools,
      ),
    );

    expect(actionFor(resolved.permission, "read")).toBe("allow");
    expect(actionFor(resolved.permission, "bash")).toBe("allow");
  });
});

describe("custom agent behavior", () => {
  it("omits plugin permissions", () => {
    const resolved = resolveMiniAgent(
      config({ agent: "build" }),
      [agent("build")],
      ["read"],
    );

    expect(resolved.mode).toBe("custom-agent");
    expect(resolved.permission).toBeUndefined();
    expect(resolved.allowedTools).toBeNull();
  });
});

describe("system prompts", () => {
  it("includes the mini instruction and context in plugin-managed mode", () => {
    const resolved = resolveMiniAgent(config(), [], ["read"]);
    const prompt = buildMiniSystemPrompt("main context", resolved);

    expect(prompt).toContain(
      "You are answering a quick side question about an ongoing coding session. Below is the conversation context from the session. Answer concisely based on what you can see.",
    );
    expect(prompt).toContain("<session-context>\nmain context\n</session-context>");
    expect(prompt).toContain("You may only use the following tools");
    expect(prompt).not.toContain("configured OpenCode agent");
  });

  it("includes custom agent guidance without tool wording in custom-agent mode", () => {
    const resolved = resolveMiniAgent(
      config({ agent: "build" }),
      [agent("build")],
      ["read"],
    );
    const prompt = buildMiniSystemPrompt("main context", resolved);

    expect(prompt).toContain(
      'You are answering a quick side question about an ongoing coding session and you are running as the configured OpenCode agent "build". Follow that agent\'s own instructions, role, tone, and constraints closely while answering this as a mini side question. Below is the conversation context from the session.',
    );
    expect(prompt).toContain("<session-context>\nmain context\n</session-context>");
    expect(prompt).not.toContain("You may only use the following tools");
  });
});

describe("payload helpers", () => {
  it("omits agent in plugin-managed session and prompt payloads", () => {
    const resolved = asPluginManaged(resolveMiniAgent(config(), [], ["read"]));
    const createPayload = buildMiniSessionCreatePayload(resolved, {
      parentID: "parent",
      title: "mini session",
      directory: "/tmp/project",
    });
    const promptPayload = buildMiniPromptPayload(resolved, {
      sessionID: "mini",
      system: "system",
      prompt: "question",
      resolvedModel: {},
    });

    expect(createPayload).not.toHaveProperty("agent");
    expect(createPayload.permission).toBeDefined();
    expect(promptPayload).not.toHaveProperty("agent");
    expect(promptPayload).not.toHaveProperty("tools");
  });

  it("includes agent in custom agent session and prompt payloads", () => {
    const resolved = resolveMiniAgent(
      config({ agent: "build" }),
      [agent("build")],
      ["read"],
    );
    const createPayload = buildMiniSessionCreatePayload(resolved, {
      parentID: "parent",
      title: "mini session",
      directory: "/tmp/project",
    });
    const promptPayload = buildMiniPromptPayload(resolved, {
      sessionID: "mini",
      system: "system",
      prompt: "question",
      resolvedModel: {},
    });

    expect(createPayload.agent).toBe("build");
    expect(createPayload.permission).toBeUndefined();
    expect(promptPayload.agent).toBe("build");
    expect(promptPayload).not.toHaveProperty("tools");
  });
});

describe("notices and diagnostics", () => {
  it("warns when allowedTools is used in plugin-managed mode", () => {
    const resolved = resolveMiniAgent(
      config({ allowedTools: ["read"], allowedToolsProvided: true }),
      [],
      ["read"],
    );

    expect(resolved.notices.join(" ")).toContain("deprecated");
  });

  it("warns and ignores allowedTools in custom-agent mode", () => {
    const resolved = resolveMiniAgent(
      config({
        agent: "build",
        allowedTools: ["read"],
        allowedToolsProvided: true,
      }),
      [agent("build")],
      ["read"],
    );

    expect(resolved.notices.join(" ")).toContain("ignored");
    expect(resolved.permission).toBeUndefined();
  });

  it("does not warn for explicit null allowedTools", () => {
    const resolved = resolveMiniAgent(
      config({ allowedTools: null, allowedToolsProvided: true }),
      [],
      ["read"],
    );

    expect(resolved.notices).toEqual([]);
  });

  it("includes mode, agent, and permission source diagnostics", () => {
    const resolved = resolveMiniAgent(
      config({ agent: "build" }),
      [agent("build")],
      ["read"],
    );
    const detail = buildMiniErrorDetail({
      path: "promptAsync throw",
      sessionID: "mini",
      resolvedModel: {},
      resolvedAgent: resolved,
    });

    expect(detail).toContain("mode=custom-agent");
    expect(detail).toContain("agent=build");
    expect(detail).toContain("permission=agent");
  });
});
