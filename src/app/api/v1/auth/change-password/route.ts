import { api, RATE } from "@/lib/api/handler";
import { changePasswordSchema } from "@/lib/validators/schemas";
import { changePassword } from "@/services/auth.service";

export const POST = api({ body: changePasswordSchema, rateLimit: RATE.auth }, async ({ auth, body }) => {
  await changePassword(auth.userId, body.currentPassword, body.newPassword, auth.sessionId);
  return { message: "Password changed. Other devices were signed out." };
});
