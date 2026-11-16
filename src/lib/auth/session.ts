import "server-only";
import { connectDb } from "@/lib/db/connect";
import { RefreshToken } from "@/models/RefreshToken";
import { Errors } from "@/lib/api/errors";
import { resolveSessionWorkspace } from "@/services/workspace.service";
import { ACCESS_COOKIE } from "./cookies";
import type { Scope } from "./scope";
import { verifyAccessToken } from "./tokens";

export interface AuthContext extends Scope {
  /** System-level role (not the workspace role). */
  role: "user" | "admin";
  sessionId: string;
  via: "cookie" | "bearer";
}

export function readCookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Resolves the caller from a Bearer token (extension / API clients) or the HTTP-only
 * access cookie (website), verifies the login session is still alive (so logout / revoke
 * is immediate) and resolves the workspace the session is working in, re-checking that
 * the user is still a member of it.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  const authz = req.headers.get("authorization");
  let token: string | undefined;
  let via: AuthContext["via"] = "cookie";
  if (authz?.toLowerCase().startsWith("bearer ")) {
    token = authz.slice(7).trim();
    via = "bearer";
  } else {
    token = readCookieValue(req, ACCESS_COOKIE);
  }
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  await connectDb();
  const session = await RefreshToken.findOne({ familyId: claims.sid, revokedAt: { $exists: false } })
    .select("workspaceId")
    .lean();
  if (!session) return null;

  const ws = await resolveSessionWorkspace(claims.sub, claims.sid, session.workspaceId);
  return {
    userId: claims.sub,
    role: claims.role,
    sessionId: claims.sid,
    via,
    workspaceId: ws.workspaceId,
    wsRole: ws.role,
  };
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const auth = await authenticate(req);
  if (!auth) throw Errors.unauthorized();
  return auth;
}
