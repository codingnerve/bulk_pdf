import { api, RATE } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { refreshUpload } from "@/services/upload.service";

/** Re-issues presigned URLs for an unfinished upload (expired URL or resume after interruption). */
export const POST = api<undefined, undefined, { id: string }>({ rateLimit: RATE.uploads }, async ({ auth, params }) => ({
  upload: await refreshUpload(auth, parseId(params.id)),
}));
