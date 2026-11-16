import { api } from "@/lib/api/handler";
import { bulkCopySchema } from "@/lib/validators/schemas";
import { bulkCopyData } from "@/services/link.service";

export const POST = api({ body: bulkCopySchema }, async ({ auth, body }) => bulkCopyData(auth, body));
