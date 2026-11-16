import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { revokeInvite } from "@/services/workspace.service";

export const DELETE = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) =>
  revokeInvite(auth, parseId(params.id)),
);
