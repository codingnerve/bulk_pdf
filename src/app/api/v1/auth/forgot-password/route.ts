import { publicApi, RATE } from "@/lib/api/handler";
import { forgotPasswordSchema } from "@/lib/validators/schemas";
import { requestPasswordReset } from "@/services/auth.service";

export const POST = publicApi({ body: forgotPasswordSchema, ipRateLimit: RATE.auth }, async ({ body }) => {
  const { devLink } = await requestPasswordReset(body.email);
  // Same response whether or not the account exists (no enumeration).
  return {
    message: "If an account exists for that email, a reset link has been sent.",
    ...(devLink ? { devLink } : {}),
  };
});
