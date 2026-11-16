import { publicApi, RATE } from "@/lib/api/handler";
import { resetPasswordSchema } from "@/lib/validators/schemas";
import { resetPassword } from "@/services/auth.service";

export const POST = publicApi({ body: resetPasswordSchema, ipRateLimit: RATE.auth }, async ({ body }) => {
  await resetPassword(body.token, body.password);
  return { message: "Password updated. You can now sign in." };
});
