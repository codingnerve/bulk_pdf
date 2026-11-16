import { api } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { inviteSchema } from "@/lib/validators/schemas";
import { createInvite, listInvites } from "@/services/workspace.service";

export const GET = api({}, async ({ auth }) => ({ invites: await listInvites(auth) }));

/** Returns a one-time invite link to share with the teammate (no email provider required). */
export const POST = api({ body: inviteSchema }, async ({ auth, body }) =>
  created({ invite: await createInvite(auth, body) }),
);
