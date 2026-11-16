import { api } from "@/lib/api/handler";
import { workspaceNameSchema } from "@/lib/validators/schemas";
import { getCurrentWorkspace, renameWorkspace } from "@/services/workspace.service";

export const GET = api({}, async ({ auth }) => ({ workspace: await getCurrentWorkspace(auth) }));

export const PATCH = api({ body: workspaceNameSchema }, async ({ auth, body }) => ({
  workspace: await renameWorkspace(auth, body.name),
}));
