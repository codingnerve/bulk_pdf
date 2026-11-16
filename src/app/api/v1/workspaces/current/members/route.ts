import { api } from "@/lib/api/handler";
import { listMembers } from "@/services/workspace.service";

export const GET = api({}, async ({ auth }) => ({ members: await listMembers(auth) }));
