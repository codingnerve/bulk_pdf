import { api } from "@/lib/api/handler";
import { listSessions } from "@/services/auth.service";

/** Signed-in devices (web browsers and extensions). */
export const GET = api({}, async ({ auth }) => ({
  sessions: await listSessions(auth.userId, auth.sessionId),
}));
