import { api } from "@/lib/api/handler";
import { getEffectiveLimits } from "@/services/limits.service";
import { getEnv } from "@/lib/env";
import { publicHost } from "@/lib/storage/keys";

/** Effective upload limits for the signed-in user (clients validate before uploading). */
export const GET = api({}, async ({ auth }) => {
  const limits = await getEffectiveLimits(auth.userId);
  return { limits, publicDomain: getEnv().R2_PUBLIC_DOMAIN ? publicHost() : null };
});
