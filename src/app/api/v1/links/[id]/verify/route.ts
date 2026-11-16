import { api, RATE } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { verifyLink } from "@/services/link.service";

export const POST = api<undefined, undefined, { id: string }>({ rateLimit: RATE.verify }, async ({ auth, params }) =>
  verifyLink(auth, parseId(params.id)),
);
