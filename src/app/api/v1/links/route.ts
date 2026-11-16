import { api } from "@/lib/api/handler";
import { listLinksQuery } from "@/lib/validators/schemas";
import { listLinks } from "@/services/link.service";
import { ok } from "@/lib/api/response";

export const GET = api({ query: listLinksQuery }, async ({ auth, query }) => {
  const { items, pagination } = await listLinks(auth, query);
  return ok(items, { pagination });
});
