# `/mini-recap` — design notes

> Status: **implemented (v1)** on this branch, which is stacked on `v2-features` (the feature
> PR #26); the recap PR lands after the V2 port (#25) and the features (#26).
>
> The numbers below come from a real dry run on a live database (108 sessions): the term
> `mini-session` matched 5 root sessions, of which only 2 were actually about the project —
> the other 3 mentioned it incidentally. The dry run produced a ~1.9k-token digest and a
> single model call.

## Problem

Work on a project is spread across many sessions, and OpenCode has no cross-session
search. `GET /api/session` accepts a `search` parameter, but it is currently ignored:
three different terms (`handoff`, `mini`, `OSC52`) returned the same page of most recent
sessions on 2.0.6. Finding "everything we did on project X" means opening sessions one by
one.

`/mini-handoff` solves the within-session version of this problem. `/mini-recap` is the
cross-session counterpart: one command that collects the relevant sessions, builds a
bounded digest, and asks the model for a consolidated recap.

## Goals

- One command collects the sessions relevant to a project or topic and produces a recap
  with a fixed skeleton: objective, timeline, decisions, current state, open questions,
  next steps.
- Collection is local: no new server API, no index. Cost is a single bounded model call.
- Work is bounded and cancelable: caps on scanned sessions, sessions included and tokens;
  `esc` aborts in-flight fetches.
- Reuse the existing mini overlay: streaming, token counter, `continueAction`
  (queue/clipboard), persisted preferences and the OSC 52 clipboard helper.

## Non-goals (v1)

- Server-side indexing or full-text search.
- Including subagent transcripts (they are children of a root session and repeat context).
- Recaps on a schedule or in the background.

## UX

Command:

```
/mini-recap [term] [--all] [--since 7d] [--exclude <term>] [--yes] [--refresh] [--handoff]
```

- `/mini-recap mini-session` — sessions in the current project scope mentioning the term.
- `/mini-recap` without a term — uses the current directory name as the term.
- Optional keybind (`alt+r`, configurable, disabled by default).

Flow:

1. **Scan** — list sessions, score candidates, fetch transcripts for the promising ones.
   The overlay shows progress (`scanning 3/12…`) and `esc` cancels.
2. **Select** (P1) — a checkbox list of the matching sessions, newest first, pre-checked by
   score. `enter` confirms, `space` toggles. `--yes` skips this step.
3. **Generate** — one prompt with the digest in the mini overlay.
4. **Act** — the mini overlay actions: **Copy recap** (OSC 52), **Save** (`recaps/<slug>-<date>.md`),
   **Continue** (queue into the main session, existing `continueAction`). Follow-up questions
   work in the same overlay without re-scanning, because the digest stays in the mini session.

## Design

### Phase 1 — candidate scan

```ts
client.session.list({ limit: config.recapScanLimit, order: "desc" })
```

Keep root sessions only:

- skip `parentID != null` (subagents),
- skip sessions tagged `metadata.opencodeMiniSession`,
- with `recapScope: "project"` (default), keep only sessions whose `directory` matches the
  current location,
- skip directories matching `recapExcludeDirs`.

Two passes:

1. **Title pass (free).** Normalize the term (case- and accent-insensitive) and match
   against titles. Title matches are strong candidates.
2. **Content pass (bounded).** For the remaining sessions inside the scan window, call
   `client.session.export({ sessionID })`, extract user/assistant text, keep matches,
   discard the rest. Exports are local to the server; this costs no tokens.

### Phase 2 — scoring and selection

| Signal | Weight |
| --- | --- |
| Match in the title | 5 |
| Match in a **user** message | 2 each (cap 5 messages) |
| Match in an assistant message | 1 each (cap 5) |
| Match only inside quoted content (handoff blocks, `<subagent …>` pastes, code fences) | 0 |
| Session is a subagent, a mini session, or in an excluded directory | disqualified |

- Keep sessions with `score >= recapMinScore` (default 4).
- Order by score, then by `time.updated` (newest first).
- Cap at `recapSessions` (default 15).
- The dry run shows why this matters: with a plain keyword filter the popup sessions came
  in as false positives; the title/user weighting left exactly the two real sessions.

P1 adds the selection picker so the user can confirm the list before spending a model call.

### Phase 3 — digest

Per selected session:

- header: title, session id, date range, directory, model;
- objective: first user message that is not a pasted handoff; when it is a handoff, use its
  `Objetivo` section;
- milestones: up to 8 user messages sampled evenly across the timeline (skip
  `<subagent …>` pastes, truncate long messages);
- final state: the last assistant message (the most informative single excerpt in the dry run);
- facts: commits, PRs, versions, file paths and URLs extracted with regexes and deduplicated,
  frozen before the model sees them so numbers do not drift.

Budget rules:

- per-session cap and a global cap reusing `tokenLimit` (default 50k);
- when the budget overflows, drop the lowest-score sessions and report it
  (`included 9 of 14 sessions`);
- drop near-duplicate paragraphs across sessions (handoffs repeat a lot).

### Phase 4 — generation

A single prompt in the mini overlay. Fixed skeleton:

```markdown
## Objetivo
## Linha do tempo
## Decisões
## Estado atual
## Pendências / questões em aberto
## Próximos passos
## Fontes   (sessions used, with ids and dates)
```

Rules given to the model: do not invent; cite the session and date next to claims; mark
contradictions between sessions explicitly; say "not found" instead of guessing. The
plugin adds a metadata header itself (scope, sessions included, tokens, model) so those
numbers are never model-generated.

### Phase 5 — actions

- **Copy recap** — reuse `copyToClipboardOSC52` from the handoff mode.
- **Save** (P1) — write `recaps/<slug>-<YYYY-MM-DD>.md` next to the project root and toast
  the path.
- **Continue** — existing `continueAction` (queue or clipboard).
- Follow-ups reuse the digest already attached to the mini session.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `recapSessions` | `number` | `15` | Maximum sessions included in the digest. |
| `recapScanLimit` | `number` | `50` | Most recent root sessions scanned for content. |
| `recapMinScore` | `number` | `4` | Minimum relevance score. |
| `recapScope` | `"project" \| "all"` | `"project"` | Restrict to the current directory or search every project. |
| `recapExcludeDirs` | `string[]` | `[]` | Glob patterns of directories to skip. |
| `recapKeybind` | `string \| false` | `false` | Optional keybind. |

## Robustness

- Limited concurrency (3–4 exports at a time), per-session timeout, failures skipped and
  reported in the footer (`2 sessions could not be read`).
- `esc` aborts in-flight fetches via `AbortSignal`.
- No full transcripts kept in memory: extract text and discard.
- In-memory TTL cache of exports for `--refresh` and follow-ups.
- Paging with `limit`/`cursor`, stopping early once the budget is reached.

## Privacy

- The digest can include sessions from **other projects**; `recapScope` defaults to the
  current project and `--all` is opt-in. The footer states how many directories were used.
- `recapExcludeDirs` keeps sensitive trees out.

## Acceptance criteria (P0)

- [ ] On a real database, `/mini-recap mini-session` selects exactly the sessions whose
      title or user messages mention the term (dry run: 2 of 5 candidates; incidental
      mentions dropped by the score threshold).
- [ ] `esc` cancels mid-scan; no unhandled rejections; the overlay stays responsive.
- [ ] The digest never exceeds the token budget; the footer reports sessions, matches and
      tokens.
- [ ] The recap follows the skeleton and cites sources; the metadata header is added by the
      plugin, not the model.
- [ ] Subagent sessions and mini sessions never appear.
- [ ] Unit tests cover normalization, scoring, milestone sampling, fact extraction and
      budgeting; the existing 141 tests stay green.
- [ ] Works with an empty configuration on a fresh install.

## Test plan

- **Unit** (`tests/recap.test.ts`): term normalization (accents/case/aliases), scoring
  weights and threshold, exclusions, milestone sampling, fact extraction, dedupe, budget
  and overflow reporting, digest formatting.
- **Integration**: mocked client — scan with pagination, export failures, abort, empty
  result set.
- **Live**: real server, one recap with ~2 sessions, verify tokens and output skeleton.

## Future (P1/P2)

- Selection picker before generation.
- `--since last` incremental recaps (persist the last recap time per project in plugin
  storage).
- `--handoff` to emit the recap already in handoff format for the next session.
- Use compaction summaries as the primary source for long sessions (denser than sampling
  messages) once their API access is confirmed.
- Server-side search once the `search` parameter is fixed upstream.

## Open questions

- Can compaction summaries be read through the API? `session.context` returns only the
  messages after the last compaction, while `session.export` returns everything.
- Upstream bug to report: `GET /api/session?search=` is accepted but ignored. If fixed, the
  content pass can go away and the feature becomes cheaper and more precise.

## Implementation notes (v1)

Implemented: `/mini-recap [term] [--all] [--exclude <term>]`, the two-pass scan (title pass,
then a bounded content pass with `parentID: null` and cursor paging), the scoring model, the
digest with per-session and global budgets, the recap mode in the mini overlay with `esc`
cancellation (the scan signal is forwarded to the client fetches), unreadable-session
counters, README documentation and unit tests.

Not implemented yet, kept here as future work: the `--since`, `--yes`, `--refresh` and
`--handoff` flags, the selection picker, compaction summaries as the primary source, and
server-side search (still ignored by the server).
