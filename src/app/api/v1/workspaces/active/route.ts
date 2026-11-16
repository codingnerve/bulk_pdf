import { api } from "@/lib/api/handler";
import { switchWorkspaceSchema } from "@/lib/validators/schemas";
import { switchWorkspace } from "@/services/workspace.service";

/** Makes another workspace the active one for this login session / device. */
export const POST = api({ body: switchWorkspaceSchema }, async ({ auth, body }) =>
  switchWorkspace(auth.userId, auth.sessionId, body.workspaceId),
);
