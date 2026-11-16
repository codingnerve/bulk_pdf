import { api } from "@/lib/api/handler";
import { parseId } from "@/lib/api/route-helpers";
import { patchFileSchema } from "@/lib/validators/schemas";
import { deleteFile, getFile, renameFile } from "@/services/file.service";

type P = { id: string };

export const GET = api<undefined, undefined, P>({}, async ({ auth, params }) => ({
  file: await getFile(auth, parseId(params.id)),
}));

export const PATCH = api<typeof patchFileSchema, undefined, P>({ body: patchFileSchema }, async ({ auth, params, body }) => ({
  file: await renameFile(auth, parseId(params.id), body.displayName),
}));

export const DELETE = api<undefined, undefined, P>({}, async ({ auth, params }) =>
  deleteFile(auth, parseId(params.id)),
);
