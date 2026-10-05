import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import {
  buildRecapDigest,
  collectRecapContext,
  countRecapMatches,
  extractRecapFacts,
  extractRecapMilestones,
  extractRecapObjective,
  fallbackRecapTerm,
  formatRecapNotice,
  isHandoffText,
  isRecapCandidateSession,
  matchesRecapDirectory,
  normalizeRecapText,
  parseRecapQuery,
  sameRecapDirectory,
  scoreRecapCandidate,
  selectRecapCandidates,
  stripRecapNoise,
  toRecapMessages,
  type RecapCandidate,
  type RecapSelection,
} from "../src/recap";
import type { MiniConfig } from "../src/types";

const MINI_SESSION_METADATA_KEY = "opencodeMiniSession";

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
    tools: ["read"],
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

function candidate(overrides: Partial<RecapCandidate> = {}): RecapCandidate {
  return {
    id: "ses_1",
    title: "Port do mini session",
    directory: "/tmp/project",
    createdAt: Date.UTC(2026, 8, 14),
    updatedAt: Date.UTC(2026, 8, 16),
    messages: [
      { role: "user", text: "start the port", createdAt: Date.UTC(2026, 8, 14) },
      { role: "assistant", text: "port done", createdAt: Date.UTC(2026, 8, 15) },
    ],
    ...overrides,
  };
}

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_1",
    projectID: "global",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    location: { directory: "/tmp/project" },
    ...overrides,
  } as SessionInfo;
}

function userMessage(text: string, created = 1): SessionMessageInfo {
  return { id: `m_${text.length}_${created}`, type: "user", text, time: { created } } as unknown as SessionMessageInfo;
}

function assistantMessage(text: string, created = 2): SessionMessageInfo {
  return {
    id: `m_a_${text.length}_${created}`,
    type: "assistant",
    content: [{ type: "text", text }],
    time: { created },
  } as unknown as SessionMessageInfo;
}

describe("parseRecapQuery", () => {
  it("falls back to the given term", () => {
    expect(parseRecapQuery(undefined, "fallback")).toEqual({
      term: "fallback",
      excludes: [],
    });
    expect(parseRecapQuery("   ", "fallback").term).toBe("fallback");
  });

  it("keeps multi-word terms", () => {
    expect(parseRecapQuery("mini session port", "fallback").term).toBe(
      "mini session port",
    );
  });

  it("strips the raw slash prefix", () => {
    expect(parseRecapQuery("/mini-recap mini session", "fallback").term).toBe(
      "mini session",
    );
  });

  it("parses --all", () => {
    expect(parseRecapQuery("mini --all", "fallback").scope).toBe("all");
    expect(parseRecapQuery("mini", "fallback").scope).toBeUndefined();
  });

  it("parses --exclude in both forms and ignores unknown flags", () => {
    expect(parseRecapQuery("mini --exclude popup --other", "fallback")).toEqual({
      term: "mini",
      excludes: ["popup"],
    });
    expect(parseRecapQuery("mini --exclude=popup", "fallback").excludes).toEqual([
      "popup",
    ]);
  });
});

describe("fallbackRecapTerm", () => {
  it("uses the last directory segment", () => {
    expect(fallbackRecapTerm("C:\\Users\\dev\\opencode-mini-session-v2")).toBe(
      "opencode-mini-session-v2",
    );
    expect(fallbackRecapTerm("/home/dev/project/")).toBe("project");
    expect(fallbackRecapTerm(undefined)).toBe("");
  });
});

describe("normalization and noise", () => {
  it("normalizes case and accents", () => {
    expect(normalizeRecapText("Portação SESSÃO")).toBe("portacao sessao");
    expect(normalizeRecapText("opencode-mini_session")).toBe(
      "opencode mini session",
    );
  });

  it("strips code fences and subagent reports", () => {
    const text = [
      "before ```const mini = 1;``` after",
      '<subagent sessionID="ses_2">mini session was referenced here</subagent>',
      "tail",
    ].join("\n");
    const stripped = stripRecapNoise(text);
    expect(stripped).not.toContain("const mini");
    expect(stripped).not.toContain("referenced here");
    expect(stripped).toContain("before");
    expect(stripped).toContain("tail");
  });

  it("detects handoff documents", () => {
    expect(isHandoffText("# Handoff — Port do plugin")).toBe(true);
    expect(isHandoffText("hello")).toBe(false);
  });

  it("counts occurrences", () => {
    expect(countRecapMatches("mini mini mini", "mini")).toBe(3);
    expect(countRecapMatches("mini", "")).toBe(0);
  });
});

describe("scoreRecapCandidate", () => {
  const query = { term: "mini session", excludes: [] };

  it("scores a title hit highest", () => {
    const score = scoreRecapCandidate(
      candidate({ title: "Mini session port", messages: [] }),
      query,
    );
    expect(score.titleHit).toBe(true);
    expect(score.score).toBe(5);
  });

  it("weights user messages above assistant messages", () => {
    const userScore = scoreRecapCandidate(
      candidate({
        title: "unrelated",
        messages: [{ role: "user", text: "mini session" }],
      }),
      query,
    );
    const assistantScore = scoreRecapCandidate(
      candidate({
        title: "unrelated",
        messages: [{ role: "assistant", text: "mini session" }],
      }),
      query,
    );
    expect(userScore.score).toBe(2);
    expect(assistantScore.score).toBe(1);
  });

  it("ignores mentions inside quoted content", () => {
    const score = scoreRecapCandidate(
      candidate({
        title: "unrelated",
        messages: [
          { role: "assistant", text: "```\nmini session\n```" },
          { role: "assistant", text: '<subagent id="1">mini session</subagent>' },
        ],
      }),
      query,
    );
    expect(score.score).toBe(0);
    expect(score.disqualified).toBe(false);
  });

  it("disqualifies sessions whose title matches an excluded term", () => {
    const excluded = scoreRecapCandidate(
      candidate({
        title: "Publicação do opencode-status-popup 0.2.0",
        messages: [{ role: "user", text: "about mini session" }],
      }),
      { term: "mini session", excludes: ["popup"] },
    );
    expect(excluded.disqualified).toBe(true);
    expect(excluded.score).toBe(0);

    const passing = scoreRecapCandidate(
      candidate({
        title: "mini session port",
        messages: [{ role: "user", text: "unrelated note about the popup" }],
      }),
      { term: "mini session", excludes: ["popup"] },
    );
    expect(passing.disqualified).toBe(false);
    expect(passing.score).toBeGreaterThan(0);
  });
});

describe("selectRecapCandidates", () => {
  it("filters by threshold, orders by score then recency and caps", () => {
    const strong = candidate({ id: "strong", title: "mini session" });
    const medium = candidate({
      id: "medium",
      title: "unrelated",
      updatedAt: 10,
      messages: [{ role: "user", text: "mini session" }],
    });
    const weak = candidate({
      id: "weak",
      title: "unrelated",
      messages: [{ role: "assistant", text: "mini session" }],
    });

    const selected = selectRecapCandidates([weak, medium, strong], {
      term: "mini session",
      excludes: [],
    }, { minScore: 2, maxSessions: 5 });

    expect(selected.map((entry) => entry.candidate.id)).toEqual([
      "strong",
      "medium",
    ]);
    expect(
      selectRecapCandidates([strong, medium], {
        term: "mini session",
        excludes: [],
      }, { minScore: 2, maxSessions: 1 }).map((entry) => entry.candidate.id),
    ).toEqual(["strong"]);
  });
});

describe("digest extraction", () => {
  it("prefers the objective section of a pasted handoff", () => {
    const objective = extractRecapObjective([
      {
        role: "user",
        text: "# Handoff — Port\n\n## Objetivo e status\nPortar o plugin.\n\n## Decisões\nnada",
      },
    ]);
    expect(objective).toContain("Portar o plugin");
    expect(objective).not.toContain("Decisões");
  });

  it("uses the first plain user message as the objective", () => {
    expect(
      extractRecapObjective([
        { role: "assistant", text: "hi" },
        { role: "user", text: "build the port" },
      ]),
    ).toBe("build the port");
  });

  it("samples milestones evenly and skips handoffs", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      text: `request ${index}`,
    }));
    messages.splice(2, 0, {
      role: "user" as const,
      text: "# Handoff — something",
    });

    const milestones = extractRecapMilestones(messages, 3);
    expect(milestones.length).toBe(3);
    expect(milestones[0].text).toBe("request 0");
    expect(milestones[2].text).toBe("request 9");
    expect(milestones.some((message) => message.text.startsWith("# Handoff"))).toBe(
      false,
    );
  });

  it("strips quoted noise from sampled milestones", () => {
    const milestones = extractRecapMilestones(
      [
        {
          role: "user",
          text: '<subagent sessionID="ses_x">long report</subagent>\n\nupdate the README',
        },
      ],
      3,
    );
    expect(milestones).toEqual([
      { role: "user", text: "update the README", createdAt: undefined },
    ]);
  });

  it("extracts and dedupes facts", () => {
    const facts = extractRecapFacts(
      [
        "PR #25 and #26 are open",
        "commit `40482ce` fixed it, see commit abc1234",
        "bumped to 2.0.5 then 2.0.6",
        "https://github.com/LucasInstra/opencode-mini-session/pull/25",
        "changed `src/session.ts` and `src/session.ts`",
      ].join("\n"),
    );
    expect(facts).toContain("#25");
    expect(facts).toContain("#26");
    expect(facts).toContain("40482ce");
    expect(facts).toContain("abc1234");
    expect(facts).toContain("2.0.5");
    expect(facts).toContain("https://github.com/LucasInstra/opencode-mini-session/pull/25");
    expect(facts).toContain("src/session.ts");
    expect(facts.filter((fact) => fact === "src/session.ts")).toHaveLength(1);
  });
});

describe("buildRecapDigest", () => {
  function selection(id: string, score: number): RecapSelection {
    return {
      candidate: candidate({
        id,
        title: `Session ${id}`,
        messages: [{ role: "user", text: "do the work" }],
      }),
      score,
      titleHit: true,
      userHits: 1,
      assistantHits: 1,
      disqualified: false,
    };
  }

  it("renders sections, counts matches and reports the notice", () => {
    const digest = buildRecapDigest([selection("one", 9), selection("two", 7)], {
      term: "mini",
      tokenLimit: 50_000,
      perSessionTokenLimit: 1200,
    });

    expect(digest.included).toBe(2);
    expect(digest.considered).toBe(2);
    expect(digest.matches).toBe(4);
    expect(digest.text).toContain('Multi-session digest for "mini"');
    expect(digest.text).toContain("## Session 1: Session one");
    expect(digest.text).toContain("- id: one");
    expect(digest.text).toContain("- id: two");
    expect(formatRecapNotice(digest)).toContain("2 sessions");
    expect(formatRecapNotice(digest)).toContain("4 matches");
  });

  it("reports unreadable sessions in the notice", () => {
    const digest = buildRecapDigest([selection("one", 9)], {
      term: "mini",
      tokenLimit: 50_000,
      perSessionTokenLimit: 1200,
    });

    expect(formatRecapNotice({ ...digest, scanned: 3, unreadable: 2 })).toContain(
      "2 unreadable",
    );
  });

  it("drops sessions over the token budget", () => {
    const bigMessages = Array.from({ length: 200 }, (_, index) => ({
      role: "user" as const,
      text: `request ${index} `.repeat(20),
    }));
    const selections = [1, 2, 3].map((index) => ({
      ...selection(`s${index}`, 9 - index),
      candidate: candidate({
        id: `ses_${index}`,
        title: `Session ${index}`,
        messages: bigMessages,
      }),
    }));

    const digest = buildRecapDigest(selections, {
      term: "mini",
      tokenLimit: 900,
      perSessionTokenLimit: 600,
    });

    expect(digest.included).toBe(1);
    expect(digest.skipped).toBe(2);
    expect(formatRecapNotice(digest)).toContain("over budget");
  });
});

describe("session filtering", () => {
  it("excludes subagent and mini sessions", () => {
    const options = { scope: "project" as const, directory: "/tmp/project", excludeDirs: [] };
    expect(
      isRecapCandidateSession(sessionInfo({ parentID: "ses_parent" }), options),
    ).toBe(false);
    expect(
      isRecapCandidateSession(
        sessionInfo({ metadata: { [MINI_SESSION_METADATA_KEY]: true } }),
        options,
      ),
    ).toBe(false);
    expect(isRecapCandidateSession(sessionInfo(), options)).toBe(true);
  });

  it("keeps only the requested project when scope is project", () => {
    const options = { scope: "project" as const, directory: "/tmp/project", excludeDirs: [] };
    expect(sameRecapDirectory("C:\\tmp\\project", "c:/tmp/project")).toBe(true);
    expect(sameRecapDirectory("/tmp/project/sub", "/tmp/project")).toBe(true);
    expect(sameRecapDirectory("/tmp/other", "/tmp/project")).toBe(false);
    expect(
      isRecapCandidateSession(
        sessionInfo({ location: { directory: "/tmp/other" } }),
        options,
      ),
    ).toBe(false);
    expect(
      isRecapCandidateSession(sessionInfo({ location: { directory: "/tmp/other" } }), {
        ...options,
        scope: "all",
      }),
    ).toBe(true);
  });

  it("fails closed for project scope without a directory", () => {
    expect(
      isRecapCandidateSession(sessionInfo(), { scope: "project", excludeDirs: [] }),
    ).toBe(false);
    expect(
      isRecapCandidateSession(sessionInfo(), { scope: "all", excludeDirs: [] }),
    ).toBe(true);
  });

  it("honours excluded directories", () => {
    expect(matchesRecapDirectory("**/secret/**", "/home/dev/secret/repo")).toBe(true);
    expect(matchesRecapDirectory("/tmp/private", "/tmp/private")).toBe(true);
    expect(
      isRecapCandidateSession(sessionInfo({ location: { directory: "/tmp/private" } }), {
        scope: "all",
        excludeDirs: ["/tmp/private"],
      }),
    ).toBe(false);
  });
});

describe("toRecapMessages", () => {
  it("keeps user and assistant text and drops other messages", () => {
    const messages = toRecapMessages([
      userMessage("hello"),
      assistantMessage("world"),
      { id: "s1", type: "synthetic", text: "ignored", time: { created: 3 } } as unknown as SessionMessageInfo,
      { id: "t1", type: "system", time: { created: 4 } } as unknown as SessionMessageInfo,
    ]);
    expect(messages).toEqual([
      { role: "user", text: "hello", createdAt: 1 },
      { role: "assistant", text: "world", createdAt: 2 },
    ]);
  });
});

describe("collectRecapContext", () => {
  function fakeCtx(sessions: SessionInfo[], messages: Record<string, SessionMessageInfo[]>) {
    return {
      client: {
        session: {
          list: vi.fn(async () => ({ data: sessions, cursor: {} })),
          export: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
            info: sessions.find((session) => session.id === sessionID),
            messages: messages[sessionID] ?? [],
          })),
        },
      },
      data: {
        session: { list: () => [], message: { list: () => [] } },
      },
    } as any;
  }

  it("exports candidate sessions and builds a digest", async () => {
    const sessions = [
      sessionInfo({ id: "ses_title", title: "mini session port" }),
      sessionInfo({ id: "ses_body", title: "unrelated" }),
      sessionInfo({ id: "ses_sub", parentID: "ses_title", title: "mini session subagent" }),
    ];
    const ctx = fakeCtx(sessions, {
      ses_body: [
        userMessage("we talked about mini session here"),
        userMessage("mini session follow-up", 3),
      ],
    });

    const digest = await collectRecapContext({
      ctx,
      config: config(),
      query: { term: "mini session", excludes: [] },
      directory: "/tmp/project",
    });

    expect(ctx.client.session.list).toHaveBeenCalledWith({
      limit: 50,
      order: "desc",
      parentID: null,
    });
    expect(ctx.client.session.export).toHaveBeenCalledTimes(2);
    expect(digest.included).toBe(2);
    expect(digest.considered).toBe(2);
    expect(digest.scanned).toBe(2);
    expect(digest.unreadable).toBe(0);
    expect(digest.matches).toBeGreaterThan(0);
    expect(digest.text).toContain("ses_title");
    expect(digest.text).toContain("ses_body");
  });

  it("counts sessions it could not read", async () => {
    const ctx = fakeCtx([sessionInfo({ id: "ses_bad", title: "mini session" })], {});
    ctx.client.session.export = vi.fn(async () => {
      throw new Error("boom");
    });
    ctx.data.session.message.list = () => {
      throw new Error("no cache");
    };

    const digest = await collectRecapContext({
      ctx,
      config: config(),
      query: { term: "mini session", excludes: [] },
      directory: "/tmp/project",
    });

    expect(digest.scanned).toBe(1);
    expect(digest.unreadable).toBe(1);
    expect(digest.included).toBe(0);
  });

  it("returns an empty digest when the scan is aborted", async () => {
    const ctx = fakeCtx([sessionInfo({ title: "mini session" })], {});
    const digest = await collectRecapContext({
      ctx,
      config: config(),
      query: { term: "mini session", excludes: [] },
      directory: "/tmp/project",
      signal: AbortSignal.abort(),
    });
    expect(digest.included).toBe(0);
    expect(digest.considered).toBe(0);
  });

  it("survives a missing session list", async () => {
    const ctx = { client: { session: {} }, data: {} } as any;
    const digest = await collectRecapContext({
      ctx,
      config: config(),
      query: { term: "mini session", excludes: [] },
      directory: "/tmp/project",
    });
    expect(digest.included).toBe(0);
  });
});
