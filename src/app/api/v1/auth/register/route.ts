import { publicApi, RATE } from "@/lib/api/handler";
import { registerSchema } from "@/lib/validators/schemas";
import { registerUser } from "@/services/auth.service";
import { authResponse } from "@/lib/api/route-helpers";

export const POST = publicApi({ body: registerSchema, ipRateLimit: RATE.auth }, async ({ body }) => {
  const { user, tokens } = await registerUser(body);
  return authResponse(user, tokens, body.client, 201);
});
