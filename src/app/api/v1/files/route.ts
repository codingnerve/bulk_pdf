import { api } from "@/lib/api/handler";
import { listFilesQuery } from "@/lib/validators/schemas";
import { listFiles } from "@/services/file.service";
import { ok } from "@/lib/api/response";

export const GET = api({ query: listFilesQuery }, async ({ auth, query }) => {
  const { items, pagination } = await listFiles(auth, query);
  return ok(items, { pagination });
});
