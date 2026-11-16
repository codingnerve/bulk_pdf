import { api, RATE } from "@/lib/api/handler";
import { cancelUploadSchema } from "@/lib/validators/schemas";
import { cancelUpload } from "@/services/upload.service";

export const POST = api({ body: cancelUploadSchema, rateLimit: RATE.uploads }, async ({ auth, body }) => {
  return { file: await cancelUpload(auth, body.fileId) };
});
