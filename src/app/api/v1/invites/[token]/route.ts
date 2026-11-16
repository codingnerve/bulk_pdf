import { publicApi, RATE } from "@/lib/api/handler";
import { getInviteInfo } from "@/services/workspace.service";

/** Public: describes an invitation so the invite page can greet the visitor. */
export const GET = publicApi<undefined, undefined, { token: string }>(
  { ipRateLimit: RATE.authLoose },
  async ({ params }) => getInviteInfo(params.token),
);
