import { api } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { workspaceNameSchema } from "@/lib/validators/schemas";
import { createWorkspace, listMyWorkspaces, switchWorkspace } from "@/services/workspace.service";

/** Workspaces the current user belongs to. */
export const GET = api({}, async ({ auth }) => ({ workspaces: await listMyWorkspaces(auth) }));

/** Creates a new workspace (the caller becomes its owner) and switches this session to it. */
export const POST = api({ body: workspaceNameSchema }, async ({ auth, body }) => {
  const ws = await createWorkspace(auth.userId, body.name);
  await switchWorkspace(auth.userId, auth.sessionId, String(ws._id));
  return created({ workspace: { id: String(ws._id), name: ws.name, role: "owner" } });
});
