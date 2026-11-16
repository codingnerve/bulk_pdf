import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { revokeLink } from "@/services/link.service";

export const POST = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) => ({
  file: await revokeLink(auth, parseId(params.id)),
}));
