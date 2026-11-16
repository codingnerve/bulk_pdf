import { api } from "@/lib/api/handler";
import { listBatchesQuery } from "@/lib/validators/schemas";
import { createBatch, listBatches } from "@/services/batch.service";
import { created, ok } from "@/lib/api/response";

export const GET = api({ query: listBatchesQuery }, async ({ auth, query }) => {
  const { items, pagination } = await listBatches(auth, query);
  return ok(items, { pagination });
});

export const POST = api({}, async ({ auth }) => created({ batch: await createBatch(auth) }));
