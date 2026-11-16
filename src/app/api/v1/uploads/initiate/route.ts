import { api, RATE } from "@/lib/api/handler";
import { initiateUploadSchema } from "@/lib/validators/schemas";
import { initiateUploads } from "@/services/upload.service";
import { created } from "@/lib/api/response";

/** Validates files and returns short-lived presigned URLs. File bytes never touch this server. */
export const POST = api({ body: initiateUploadSchema, rateLimit: RATE.uploads }, async ({ auth, body }) => {
  return created(await initiateUploads(auth, body));
});
