import { api, RATE } from "@/lib/api/handler";
import { completeUploadSchema } from "@/lib/validators/schemas";
import { completeUpload } from "@/services/upload.service";

export const POST = api({ body: completeUploadSchema, rateLimit: RATE.uploads }, async ({ auth, body }) => {
  return { file: await completeUpload(auth, body) };
});
