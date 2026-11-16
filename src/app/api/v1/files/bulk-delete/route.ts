import { api } from "@/lib/api/handler";
import { bulkDeleteSchema } from "@/lib/validators/schemas";
import { bulkDeleteFiles } from "@/services/file.service";

export const POST = api({ body: bulkDeleteSchema }, async ({ auth, body }) =>
  bulkDeleteFiles(auth, body.ids),
);
