import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { isMiniSession } from "./cleanup";
import { estimateTokens, getMessageParts } from "./context";
import { formatTokenCount } from "./counter";
import type { TuiContext } from "./opencode";
import type { MiniConfig, RecapQuery, RecapScope } from "./types";

export const DEFAULT_RECAP_MILESTONES = 8;
export const DEFAULT_RECAP_FACTS = 12;
export const DEFAULT_RECAP_SESSION_TOKENS = 1200;

const RECAP_SCAN_CONCURRENCY = 3;
const RECAP_EARLY_STOP_FACTOR = 2;
const RECAP_EARLY_STOP_MIN_SCANNED = 8;
const OBJECTIVE_MAX_LENGTH = 400;
const MILESTONE_MAX_LENGTH = 240;
const FINAL_STATE_MAX_LENGTH = 700;

export type RecapMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
};

export type RecapCandidate = {
  id: string;
  title: string;
  directory?: string;
  createdAt?: number;
  updatedAt?: number;
  messages: RecapMessage[];
};

export type RecapScore = {
  score: number;
  titleHit: boolean;
  userHits: number;
  assistantHits: number;
  disqualified: boolean;
};

export type RecapSelection = RecapScore & { candidate: RecapCandidate };

export type RecapDigest = {
  term: string;
  text: string;
  usedTokens: number;
  availableTokens: number;
  /** Sessions that made it into the digest. */
  included: number;
  /** Sessions that matched the term and were considered. */
  considered: number;
  /** Total term occurrences in the included sessions. */
  matches: number;
  /** Matching sessions dropped because the token budget was exhausted. */
  skipped: number;
  /** Sessions that were scanned for content. */
  scanned: number;
  /** Sessions that could not be read while scanning. */
  unreadable: number;
};

export type RecapProgress = (message: string) => void;

export function parseRecapQuery(
  input: string | undefined,
  fallbackTerm: string,
): RecapQuery {
  const raw = (input ?? "")
    .replace(/^\/mini-recap(?:\s+|$)/i, "")
    .trim();
  const terms: string[] = [];
  const excludes: string[] = [];
  let scope: RecapScope | undefined;
  let expectExclude = false;

  for (const part of raw.split(/\s+/).filter(Boolean)) {
    if (expectExclude) {
      excludes.push(part);
      expectExclude = false;
      continue;
    }
    if (part === "--all") {
      scope = "all";
      continue;
    }
    if (part === "--exclude") {
      expectExclude = true;
      continue;
    }
    if (part.startsWith("--exclude=")) {
      const value = part.slice("--exclude=".length).trim();
      if (value) excludes.push(value);
      continue;
    }
    if (part.startsWith("--")) continue;
    terms.push(part);
  }

  return {
    term: terms.length > 0 ? terms.join(" ") : fallbackTerm,
    excludes,
    ...(scope ? { scope } : {}),
  };
}

export function fallbackRecapTerm(directory: string | undefined): string {
  if (!directory) return "";
  const normalized = directory.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

export function normalizeRecapText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes pasted handoffs, subagent reports and fenced code blocks. */
export function stripRecapNoise(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<subagent[\s\S]*?(?:<\/subagent>|$)/g, " ");
}

export function isHandoffText(value: string): boolean {
  return /^\s*#{1,3}\s*handoff\b/im.test(value);
}

export function countRecapMatches(haystack: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = haystack.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(term, index + term.length);
  }
  return count;
}

export function scoreRecapCandidate(
  candidate: RecapCandidate,
  query: RecapQuery,
): RecapScore {
  const term = normalizeRecapText(query.term);
  const excludes = query.excludes
    .map((value) => normalizeRecapText(value))
    .filter(Boolean);
  const title = normalizeRecapText(candidate.title);
  const titleHit = term.length > 0 && title.includes(term);

  let userHits = 0;
  let assistantHits = 0;
  for (const message of candidate.messages) {
    const hits = countRecapMatches(
      normalizeRecapText(stripRecapNoise(message.text)),
      term,
    );
    if (hits === 0) continue;
    if (message.role === "user") userHits += hits;
    else assistantHits += hits;
  }

  const disqualified = excludes.some((excluded) => title.includes(excluded));

  const score = disqualified
    ? 0
    : (titleHit ? 5 : 0) +
      Math.min(userHits, 5) * 2 +
      Math.min(assistantHits, 5);

  return { score, titleHit, userHits, assistantHits, disqualified };
}

export function selectRecapCandidates(
  candidates: RecapCandidate[],
  query: RecapQuery,
  options: { minScore: number; maxSessions: number },
): RecapSelection[] {
  return candidates
    .map((candidate) => ({ candidate, ...scoreRecapCandidate(candidate, query) }))
    .filter((entry) => !entry.disqualified && entry.score >= options.minScore)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate.updatedAt ?? 0) - (left.candidate.updatedAt ?? 0),
    )
    .slice(0, options.maxSessions);
}

export function extractRecapObjective(
  messages: RecapMessage[],
): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = stripRecapNoise(message.text).trim();
    if (!text) continue;
    if (isHandoffText(text)) {
      const objective = extractHandoffObjective(text);
      if (objective) return clampText(objective, OBJECTIVE_MAX_LENGTH);
      continue;
    }
    return clampText(text, OBJECTIVE_MAX_LENGTH);
  }
  return undefined;
}

export function extractRecapMilestones(
  messages: RecapMessage[],
  max: number,
): RecapMessage[] {
  if (max <= 0) return [];
  const requests = messages
    .filter((message) => {
      if (message.role !== "user") return false;
      const text = stripRecapNoise(message.text).trim();
      return Boolean(text) && !isHandoffText(text);
    })
    .map((message) => ({
      ...message,
      text: stripRecapNoise(message.text).trim(),
    }));
  if (requests.length <= max) return requests;
  if (max === 1) return [requests[requests.length - 1]];

  const picked: RecapMessage[] = [];
  for (let index = 0; index < max; index += 1) {
    const source = Math.round((index * (requests.length - 1)) / (max - 1));
    const message = requests[source];
    if (!picked.includes(message)) picked.push(message);
  }
  return picked;
}

export function extractRecapFacts(text: string, limit = DEFAULT_RECAP_FACTS): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const fact = value.trim();
    if (!fact || seen.has(fact)) return;
    seen.add(fact);
    facts.push(fact);
  };

  for (const match of text.matchAll(/(?:^|\s)#(\d{1,6})\b/gm)) {
    push(`#${match[1]}`);
    if (facts.length >= limit) return facts;
  }
  for (const match of text.matchAll(/`([0-9a-f]{7,40})`/g)) {
    push(match[1]);
    if (facts.length >= limit) return facts;
  }
  for (const match of text.matchAll(/\bcommit\s+([0-9a-f]{7,40})\b/gi)) {
    push(match[1].toLowerCase());
    if (facts.length >= limit) return facts;
  }
  for (const match of text.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)) {
    push(match[1]);
    if (facts.length >= limit) return facts;
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)`"']+/g)) {
    push(match[0].replace(/[.,;:]+$/, ""));
    if (facts.length >= limit) return facts;
  }
  for (const match of text.matchAll(
    /`([^`\n]+(?:\/|\\|\.(?:ts|tsx|js|mjs|json|md|cs|ps1|yml|yaml|toml|rs|py|go|java))[^`\n]*)`/g,
  )) {
    push(match[1]);
    if (facts.length >= limit) return facts;
  }
  return facts;
}

export function buildRecapDigest(
  selections: RecapSelection[],
  options: { term: string; tokenLimit: number; perSessionTokenLimit: number },
): RecapDigest {
  const sections = selections.map((selection, index) => {
    const text = buildRecapSessionSection(selection, index, options.perSessionTokenLimit);
    return { text, tokens: estimateTokens(text), selection };
  });

  const included: string[] = [];
  const header = `Multi-session digest for "${options.term}" (${selections.length} matching sessions, newest first).`;
  let usedTokens = estimateTokens(header);
  let skipped = 0;
  let matches = 0;

  for (const [index, section] of sections.entries()) {
    if (index > 0 && usedTokens + section.tokens > options.tokenLimit) {
      skipped += 1;
      continue;
    }
    included.push(section.text);
    matches += section.selection.userHits + section.selection.assistantHits;
    usedTokens += section.tokens;
  }

  const finalHeader = `Multi-session digest for "${options.term}" (${included.length} of ${selections.length} matching sessions, newest first).`;
  const text = included.length > 0 ? [finalHeader, ...included].join("\n\n") : "";
  const availableTokens =
    sections.reduce((total, section) => total + section.tokens, 0) +
    estimateTokens(finalHeader);

  return {
    term: options.term,
    text,
    usedTokens: estimateTokens(text),
    availableTokens,
    included: included.length,
    considered: selections.length,
    matches,
    skipped,
    scanned: selections.length,
    unreadable: 0,
  };
}

export function formatRecapNotice(digest: RecapDigest): string {
  const sessions = `${digest.included} session${digest.included === 1 ? "" : "s"}`;
  const matches = `${digest.matches} match${digest.matches === 1 ? "" : "es"}`;
  const tokens = `${formatTokenCount(digest.usedTokens)} tokens`;
  const skipped = digest.skipped > 0 ? ` · ${digest.skipped} over budget` : "";
  const unreadable =
    digest.unreadable > 0 ? ` · ${digest.unreadable} unreadable` : "";
  return `recap ${digest.term}: ${sessions} · ${matches} · ${tokens}${skipped}${unreadable}`;
}

export function isRecapCandidateSession(
  session: SessionInfo,
  options: { scope: RecapScope; directory?: string; excludeDirs: string[] },
): boolean {
  if (session.parentID) return false;
  if (isMiniSession(session)) return false;

  const directory = session.location?.directory;
  if (
    directory &&
    options.excludeDirs.some((pattern) => matchesRecapDirectory(pattern, directory))
  ) {
    return false;
  }

  if (options.scope === "project") {
    return options.directory
      ? sameRecapDirectory(directory, options.directory)
      : false;
  }

  return true;
}

export function sameRecapDirectory(
  sessionDirectory: string | undefined,
  currentDirectory: string,
): boolean {
  if (!sessionDirectory) return false;
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const left = normalize(sessionDirectory);
  const right = normalize(currentDirectory);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function matchesRecapDirectory(pattern: string, directory: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const escaped = normalize(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, ".");
  try {
    return new RegExp(escaped).test(normalize(directory));
  } catch {
    return false;
  }
}

export function toRecapMessages(
  messages: readonly SessionMessageInfo[],
): RecapMessage[] {
  const recapMessages: RecapMessage[] = [];
  for (const info of messages) {
    if (info.type !== "user" && info.type !== "assistant") continue;
    const text = getMessageParts(info)
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) continue;
    recapMessages.push({
      role: info.type,
      text,
      createdAt: info.time?.created,
    });
  }
  return recapMessages;
}

export async function collectRecapContext(options: {
  ctx: TuiContext;
  config: MiniConfig;
  query: RecapQuery;
  directory?: string;
  signal?: AbortSignal;
  onProgress?: RecapProgress;
}): Promise<RecapDigest> {
  const { ctx, config, query, signal } = options;
  const scope = query.scope ?? config.recapScope;
  const minScore = config.recapMinScore;
  const maxSessions = config.recapSessions;

  const sessions = (await listRecapSessions(ctx, config.recapScanLimit, signal))
    .filter((session) =>
      isRecapCandidateSession(session, {
        scope,
        directory: options.directory,
        excludeDirs: config.recapExcludeDirs,
      }),
    )
    .slice(0, config.recapScanLimit);

  const candidates: RecapCandidate[] = [];
  let scanned = 0;
  let unreadable = 0;
  let stop = false;
  const total = sessions.length;
  const report = () =>
    options.onProgress?.(`Scanning sessions ${scanned}/${total}...`);

  report();
  await mapWithConcurrency(sessions, RECAP_SCAN_CONCURRENCY, async (session) => {
    if (stop || signal?.aborted) return;
    scanned += 1;
    const exported = await exportRecapMessages(ctx, session.id, signal);
    if (stop || signal?.aborted) return;
    if (exported === undefined) {
      unreadable += 1;
      report();
      return;
    }
    const candidate: RecapCandidate = {
      id: session.id,
      title: session.title ?? "(untitled)",
      directory: session.location?.directory,
      createdAt: session.time?.created,
      updatedAt: session.time?.updated,
      messages: toRecapMessages(exported),
    };
    if (scoreRecapCandidate(candidate, query).score >= minScore) {
      candidates.push(candidate);
      if (
        candidates.length >= maxSessions * RECAP_EARLY_STOP_FACTOR &&
        scanned >= RECAP_EARLY_STOP_MIN_SCANNED
      ) {
        stop = true;
      }
    }
    report();
  });

  if (signal?.aborted) return emptyRecapDigest(query.term);

  const selections = selectRecapCandidates(candidates, query, {
    minScore,
    maxSessions,
  });

  return {
    ...buildRecapDigest(selections, {
      term: query.term,
      tokenLimit: config.tokenLimit,
      perSessionTokenLimit: DEFAULT_RECAP_SESSION_TOKENS,
    }),
    scanned,
    unreadable,
  };
}

function emptyRecapDigest(term: string): RecapDigest {
  return {
    term,
    text: "",
    usedTokens: 0,
    availableTokens: 0,
    included: 0,
    considered: 0,
    matches: 0,
    skipped: 0,
    scanned: 0,
    unreadable: 0,
  };
}

function buildRecapSessionSection(
  selection: RecapSelection,
  index: number,
  perSessionTokenLimit: number,
): string {
  const { candidate } = selection;
  const lines = [`## Session ${index + 1}: ${candidate.title}`];

  lines.push(`- id: ${candidate.id}`);
  const period = formatRecapPeriod(candidate.createdAt, candidate.updatedAt);
  if (period) lines.push(`- period: ${period}`);
  if (candidate.directory) lines.push(`- directory: ${candidate.directory}`);

  const objective = extractRecapObjective(candidate.messages);
  if (objective) lines.push(`- objective: ${objective}`);

  const milestones = extractRecapMilestones(
    candidate.messages,
    DEFAULT_RECAP_MILESTONES,
  );
  if (milestones.length > 0) {
    lines.push("- requests:");
    for (const milestone of milestones) {
      lines.push(
        `  - [${formatRecapDate(milestone.createdAt)}] ${clampText(milestone.text, MILESTONE_MAX_LENGTH)}`,
      );
    }
  }

  const facts = extractRecapFacts(
    candidate.messages.map((message) => message.text).join("\n"),
  );
  if (facts.length > 0) lines.push(`- facts: ${facts.join("; ")}`);

  const finalState = lastAssistantText(candidate.messages);
  if (finalState) {
    lines.push(`- final state: ${clampText(finalState, FINAL_STATE_MAX_LENGTH)}`);
  }

  return clampTokens(lines.join("\n"), perSessionTokenLimit);
}

function lastAssistantText(messages: RecapMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.text.trim();
    if (text) return text;
  }
  return undefined;
}

function extractHandoffObjective(text: string): string | undefined {
  const match = text.match(
    /^#{1,3}\s*(?:objetivo|objective)[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|$)/im,
  );
  return match?.[1]?.trim() || undefined;
}

function formatRecapPeriod(
  createdAt: number | undefined,
  updatedAt: number | undefined,
): string | undefined {
  const start = formatRecapDate(createdAt);
  const end = formatRecapDate(updatedAt);
  if (!start && !end) return undefined;
  if (!start || start === end) return start ?? end;
  return `${start} -> ${end}`;
}

function formatRecapDate(timestamp: number | undefined): string | undefined {
  if (!timestamp) return undefined;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function clampText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function clampTokens(value: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.4);
  return value.length > maxChars
    ? `${value.slice(0, maxChars - 1)}…`
    : value;
}

const RECAP_MAX_PAGES = 4;

async function listRecapSessions(
  ctx: TuiContext,
  limit: number,
  signal?: AbortSignal,
): Promise<SessionInfo[]> {
  const pageSize = Math.min(limit, 50);
  const collected: SessionInfo[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < RECAP_MAX_PAGES; page += 1) {
    if (signal?.aborted) break;
    try {
      const input = {
        limit: pageSize,
        order: "desc" as const,
        parentID: null,
        ...(cursor ? { cursor } : {}),
      };
      const result = signal
        ? await ctx.client.session.list(input, { signal })
        : await ctx.client.session.list(input);
      if (Array.isArray(result)) {
        collected.push(...(result as SessionInfo[]));
        break;
      }
      const data = (result as { data?: SessionInfo[] } | undefined)?.data;
      if (Array.isArray(data)) collected.push(...data);
      cursor = (result as { cursor?: { next?: string | null } } | undefined)
        ?.cursor?.next ?? undefined;
      if (!cursor || collected.length >= limit) break;
    } catch {
      break;
    }
  }

  if (collected.length > 0) return collected.slice(0, limit);

  try {
    const cached = ctx.data.session.list();
    if (Array.isArray(cached)) return cached.slice(0, limit);
  } catch {}

  return [];
}

async function exportRecapMessages(
  ctx: TuiContext,
  sessionID: string,
  signal?: AbortSignal,
): Promise<readonly SessionMessageInfo[] | undefined> {
  try {
    const result = signal
      ? await ctx.client.session.export({ sessionID }, { signal })
      : await ctx.client.session.export({ sessionID });
    const payload = result as
      | {
          messages?: SessionMessageInfo[];
          data?: { messages?: SessionMessageInfo[] };
        }
      | undefined;
    const messages = payload?.messages ?? payload?.data?.messages;
    if (Array.isArray(messages)) return messages;
  } catch {
    return undefined;
  }

  try {
    const cached = ctx.data.session.message.list(sessionID);
    if (Array.isArray(cached)) return cached;
  } catch {}

  return undefined;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
}
