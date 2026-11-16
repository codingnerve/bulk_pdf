import { api, RATE } from "@/lib/api/handler";
import { deleteAccountSchema } from "@/lib/validators/schemas";
import { deleteAccount } from "@/services/settings.service";
import { loggedOutResponse } from "@/lib/api/route-helpers";

/** Permanently deletes the account and every stored PDF. Requires the password. */
export const DELETE = api({ body: deleteAccountSchema, rateLimit: RATE.auth }, async ({ auth, body }) => {
  await deleteAccount(auth.userId, body.password);
  return loggedOutResponse();
});
