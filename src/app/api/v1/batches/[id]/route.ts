import { api } from "@/lib/api/handler";
import { getBatch } from "@/services/batch.service";

/** `id` may be the Mongo id or the public batch id (bch_...). */
export const GET = api<undefined, undefined, { id: string }>({}, async ({ auth, params }) => ({
  batch: await getBatch(auth, params.id),
}));
