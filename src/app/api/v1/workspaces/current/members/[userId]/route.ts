import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { memberRoleSchema } from "@/lib/validators/schemas";
import { changeMemberRole, removeMember } from "@/services/workspace.service";

type P = { userId: string };

export const PATCH = api<typeof memberRoleSchema, undefined, P>({ body: memberRoleSchema }, async ({ auth, params, body }) =>
  changeMemberRole(auth, parseId(params.userId), body.role),
);

/** Removes a member (admins) or leaves the workspace (your own id). */
export const DELETE = api<undefined, undefined, P>({}, async ({ auth, params }) =>
  removeMember(auth, parseId(params.userId)),
);
