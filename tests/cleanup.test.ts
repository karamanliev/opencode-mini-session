import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@opencode/client";
import {
  cleanupStaleMiniSessions,
  isMiniSession,
  selectStaleMiniSessions,
  type MiniSessionLike,
} from "../src/cleanup";
import {
  MINI_SESSION_METADATA_KEY,
  STALE_MINI_SESSION_MAX_AGE_MS,
} from "../src/constants";

function session(
  id: string,
  overrides: {
    metadata?: Record<string, unknown>;
    created?: number;
    updated?: number;
  } = {},
) {
  const created = overrides.created ?? 0;
  return {
    id,
    metadata:
      overrides.metadata ?? ({ [MINI_SESSION_METADATA_KEY]: true } as const),
    time: { created, updated: overrides.updated ?? created },
  } as unknown as MiniSessionLike & Pick<SessionInfo, "metadata">;
}

function fakeCtx(sessions: unknown[]) {
  return {
    client: {
      session: {
        list: vi.fn(async () => ({ data: sessions, cursor: {} })),
        remove: vi.fn(async () => {}),
      },
    },
  } as any;
}

describe("isMiniSession", () => {
  it("detects the metadata marker", () => {
    expect(isMiniSession(session("a"))).toBe(true);
    expect(isMiniSession(session("b", { metadata: {} }))).toBe(false);
    expect(
      isMiniSession(session("c", { metadata: { opencodeMiniSession: "yes" } })),
    ).toBe(false);
  });
});

describe("selectStaleMiniSessions", () => {
  const now = 1_000_000_000;

  it("selects only marked sessions older than the limit", () => {
    const fresh = session("fresh", { created: now - 1_000 });
    const stale = session("stale", {
      created: now - STALE_MINI_SESSION_MAX_AGE_MS - 1,
    });
    const unmarked = session("unmarked", { metadata: {}, created: 0 });

    expect(selectStaleMiniSessions([fresh, stale, unmarked], now).map((s) => s.id)).toEqual([
      "stale",
    ]);
  });

  it("keeps old sessions that were used recently", () => {
    const now = 1_000_000_000;
    const oldButActive = session("active", {
      created: 0,
      updated: now - 1_000,
    });
    const stale = session("stale", {
      created: now - STALE_MINI_SESSION_MAX_AGE_MS - 1,
      updated: now - STALE_MINI_SESSION_MAX_AGE_MS - 1,
    });

    expect(
      selectStaleMiniSessions([oldButActive, stale], now).map((s) => s.id),
    ).toEqual(["stale"]);
  });
});

describe("cleanupStaleMiniSessions", () => {
  it("removes stale marked sessions and returns the count", async () => {
    const now = 1_000_000_000;
    const ctx = fakeCtx([
      session("fresh", { created: now - 1_000 }),
      session("stale", { created: now - STALE_MINI_SESSION_MAX_AGE_MS - 1 }),
      session("other", { metadata: {}, created: 0 }),
    ]);

    await expect(cleanupStaleMiniSessions(ctx, now)).resolves.toBe(1);
    expect(ctx.client.session.remove).toHaveBeenCalledWith({
      sessionID: "stale",
    });
  });

  it("returns 0 when listing fails", async () => {
    const ctx = {
      client: {
        session: {
          list: vi.fn(async () => {
            throw new Error("offline");
          }),
          remove: vi.fn(),
        },
      },
    } as any;

    await expect(cleanupStaleMiniSessions(ctx)).resolves.toBe(0);
    expect(ctx.client.session.remove).not.toHaveBeenCalled();
  });

  it("ignores removal failures", async () => {
    const now = 1_000_000_000;
    const ctx = fakeCtx([
      session("stale-a", { created: now - STALE_MINI_SESSION_MAX_AGE_MS - 1 }),
      session("stale-b", { created: now - STALE_MINI_SESSION_MAX_AGE_MS - 1 }),
    ]);
    ctx.client.session.remove.mockRejectedValueOnce(new Error("locked"));

    await expect(cleanupStaleMiniSessions(ctx, now)).resolves.toBe(1);
    expect(ctx.client.session.remove).toHaveBeenCalledTimes(2);
  });
});
