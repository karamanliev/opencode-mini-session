import type { SessionInfo } from "@opencode/client";
import {
  MINI_SESSION_METADATA_KEY,
  STALE_MINI_SESSION_MAX_AGE_MS,
} from "./constants";
import type { TuiContext } from "./opencode";

export type MiniSessionLike = Pick<SessionInfo, "id" | "metadata" | "time">;

export function isMiniSession(session: Pick<SessionInfo, "metadata">) {
  return session.metadata?.[MINI_SESSION_METADATA_KEY] === true;
}

export function selectStaleMiniSessions(
  sessions: readonly MiniSessionLike[],
  now = Date.now(),
  maxAgeMs = STALE_MINI_SESSION_MAX_AGE_MS,
) {
  return sessions.filter((session) => {
    if (!isMiniSession(session)) return false;
    const lastActivity = Math.max(
      session.time.created,
      session.time.updated ?? 0,
    );
    return now - lastActivity > maxAgeMs;
  });
}

/**
 * Removes ephemeral mini sessions left behind by a crashed or force-closed
 * client. Only sessions created by this plugin (metadata marker) and untouched
 * for `STALE_MINI_SESSION_MAX_AGE_MS` are removed, so a mini session that is
 * still being used — even in another TUI instance — is never touched.
 */
export async function cleanupStaleMiniSessions(
  ctx: Pick<TuiContext, "client">,
  now = Date.now(),
): Promise<number> {
  let sessions: readonly MiniSessionLike[] = [];
  try {
    const result = await ctx.client.session.list();
    if (Array.isArray(result.data)) sessions = result.data;
  } catch {
    return 0;
  }

  let removed = 0;
  for (const session of selectStaleMiniSessions(sessions, now)) {
    try {
      await ctx.client.session.remove({ sessionID: session.id });
      removed += 1;
    } catch {}
  }
  return removed;
}
