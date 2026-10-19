import type { SessionInfo } from "@opencode/client";
import { MINI_SESSION_METADATA_KEY } from "./constants";

export function isMiniSession(session: Pick<SessionInfo, "metadata">) {
  return session.metadata?.[MINI_SESSION_METADATA_KEY] === true;
}
