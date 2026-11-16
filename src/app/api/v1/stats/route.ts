import { api } from "@/lib/api/handler";
import { getOverview } from "@/services/stats.service";

export const GET = api({}, async ({ auth }) => getOverview(auth));
