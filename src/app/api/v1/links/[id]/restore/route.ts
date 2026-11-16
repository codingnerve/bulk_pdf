import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { restoreLink } from "@/services/link.service";

/** Re-enables public access for a revoked file; the original URL works again. */
export const POST = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) => ({
  file: await restoreLink(auth, parseId(params.id)),
}));
