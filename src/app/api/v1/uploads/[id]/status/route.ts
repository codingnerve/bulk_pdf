import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { getUploadStatus } from "@/services/upload.service";

export const GET = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) =>
  getUploadStatus(auth, parseId(params.id)),
);
