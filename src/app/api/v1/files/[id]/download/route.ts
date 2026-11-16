import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { getDownloadUrl } from "@/services/file.service";

/** Returns a 5-minute presigned download URL (Content-Disposition: attachment). */
export const GET = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) =>
  getDownloadUrl(auth, parseId(params.id)),
);
