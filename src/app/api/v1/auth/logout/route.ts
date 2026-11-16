import { publicApi, RATE } from "@/lib/api/handler";
import { logoutSchema } from "@/lib/validators/schemas";
import { logout } from "@/services/auth.service";
import { loggedOutResponse } from "@/lib/api/route-helpers";
import { authenticate, readCookieValue } from "@/lib/auth/session";
import { REFRESH_COOKIE } from "@/lib/auth/cookies";

/** Works even when the access token has already expired (the refresh token identifies the session). */
export const POST = publicApi({ body: logoutSchema, ipRateLimit: RATE.authLoose }, async ({ req, body }) => {
  const auth = await authenticate(req);
  await logout({
    sessionId: auth?.sessionId,
    userId: auth?.userId,
    allDevices: body.allDevices && !!auth,
    refreshToken: body.refreshToken ?? readCookieValue(req, REFRESH_COOKIE),
  });
  return loggedOutResponse();
});
