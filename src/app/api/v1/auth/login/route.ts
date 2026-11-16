import { publicApi, RATE } from "@/lib/api/handler";
import { loginSchema } from "@/lib/validators/schemas";
import { loginUser } from "@/services/auth.service";
import { authResponse } from "@/lib/api/route-helpers";

export const POST = publicApi({ body: loginSchema, ipRateLimit: RATE.auth }, async ({ body }) => {
  const { user, tokens } = await loginUser(body);
  return authResponse(user, tokens, body.client);
});
