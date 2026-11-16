import { api } from "@/lib/api/handler";
import { revokeSession } from "@/services/auth.service";

/** Revoke one device/session (e.g. a lost laptop or an extension install). */
export const DELETE = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) => {
  await revokeSession(auth.userId, params.id);
  return { revoked: true };
});
