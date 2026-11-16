import { api, RATE } from "@/lib/api/handler";
import { acceptInviteSchema } from "@/lib/validators/schemas";
import { acceptInvite, switchWorkspace } from "@/services/workspace.service";

/** Joins the workspace the invitation was issued for (signed-in email must match). */
export const POST = api({ body: acceptInviteSchema, rateLimit: RATE.auth }, async ({ auth, body }) => {
  const { workspaceId } = await acceptInvite(auth.userId, body.token);
  await switchWorkspace(auth.userId, auth.sessionId, workspaceId);
  return { workspaceId };
});
