import { api } from "@/lib/api/handler";
import { getUserById, toPublicUser } from "@/services/auth.service";
import { getCurrentWorkspace } from "@/services/workspace.service";

export const GET = api({}, async ({ auth }) => {
  const [user, workspace] = await Promise.all([getUserById(auth.userId), getCurrentWorkspace(auth)]);
  return { user: toPublicUser(user), workspace };
});
