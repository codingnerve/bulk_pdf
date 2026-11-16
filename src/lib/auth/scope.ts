import type { WorkspaceRole } from "@/models/Membership";
import { Errors } from "@/lib/api/errors";

/**
 * Every service call carries a Scope: WHO is acting (userId) and in WHICH workspace
 * (workspaceId, wsRole). The workspace id is the ownership boundary for all data queries.
 */
export interface Scope {
  userId: string;
  workspaceId: string;
  wsRole: WorkspaceRole;
}

export const isAdmin = (s: Pick<Scope, "wsRole">) => s.wsRole === "owner" || s.wsRole === "admin";

/** Members manage their own uploads; owners/admins manage everything in the workspace. */
export const canManageFile = (s: Scope, uploaderId: unknown) =>
  isAdmin(s) || String(uploaderId) === s.userId;

export function requireAdmin(s: Scope) {
  if (!isAdmin(s)) throw Errors.forbidden("Only workspace owners and admins can do this");
}
