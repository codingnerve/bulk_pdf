import { publicApi, RATE } from "@/lib/api/handler";
import { Errors } from "@/lib/api/errors";
import { refreshSchema } from "@/lib/validators/schemas";
import { refreshSession } from "@/services/auth.service";
import { authResponse } from "@/lib/api/route-helpers";
import { REFRESH_COOKIE } from "@/lib/auth/cookies";
import { readCookieValue } from "@/lib/auth/session";

/** Rotates the refresh token. Cookie clients send nothing; extensions send { refreshToken }. */
export const POST = publicApi({ body: refreshSchema, ipRateLimit: RATE.authLoose }, async ({ req, body }) => {
  const fromBody = body.refreshToken;
  const token = fromBody ?? readCookieValue(req, REFRESH_COOKIE);
  if (!token) throw Errors.unauthorized("No refresh token provided");
  const { user, tokens } = await refreshSession(token);
  return authResponse(user, tokens, fromBody ? "extension" : "web");
});
