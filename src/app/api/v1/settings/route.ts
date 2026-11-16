import { api } from "@/lib/api/handler";
import { updateSettingsSchema } from "@/lib/validators/schemas";
import { getSettings, updateSettings } from "@/services/settings.service";

export const GET = api({}, async ({ auth }) => getSettings(auth.userId));

export const PATCH = api({ body: updateSettingsSchema }, async ({ auth, body }) =>
  updateSettings(auth.userId, body),
);
