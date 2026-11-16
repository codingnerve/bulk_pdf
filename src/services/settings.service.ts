import "server-only";
import { User } from "@/models/User";
import { FileModel } from "@/models/File";
import { UploadBatch } from "@/models/UploadBatch";
import { RefreshToken } from "@/models/RefreshToken";
import { PasswordReset } from "@/models/PasswordReset";
import { Membership } from "@/models/Membership";
import { Workspace } from "@/models/Workspace";
import { Invite } from "@/models/Invite";
import { Errors } from "@/lib/api/errors";
import { verifyPassword } from "@/lib/auth/password";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { publicHost } from "@/lib/storage/keys";
import { getEffectiveLimits } from "./limits.service";
import { toPublicUser } from "./auth.service";

export async function getSettings(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw Errors.notFound("User not found");
  const env = getEnv();
  const limits = await getEffectiveLimits(userId);
  return {
    profile: toPublicUser(user),
    settings: {
      maxFileSizeMb: user.settings?.maxFileSizeMb ?? null,
      maxFilesPerBatch: user.settings?.maxFilesPerBatch ?? null,
      uploadConcurrency: user.settings?.uploadConcurrency ?? null,
      defaultPublic: user.settings?.defaultPublic ?? true,
      contentDisposition: user.settings?.contentDisposition ?? "inline",
    },
    effectiveLimits: limits,
    serverLimits: {
      maxFileSizeMb: env.MAX_FILE_SIZE_MB,
      maxFilesPerBatch: env.MAX_FILES_PER_BATCH,
      uploadConcurrency: env.UPLOAD_CONCURRENCY,
    },
    // Storage credentials/domain are server-side configuration, shown read-only.
    publicDomain: env.R2_PUBLIC_DOMAIN ? publicHost() : null,
  };
}

export async function updateSettings(
  userId: string,
  input: {
    name?: string;
    maxFileSizeMb?: number | null;
    maxFilesPerBatch?: number | null;
    uploadConcurrency?: number | null;
    defaultPublic?: boolean;
    contentDisposition?: "inline" | "attachment";
  },
) {
  const env = getEnv();
  if (input.maxFileSizeMb && input.maxFileSizeMb > env.MAX_FILE_SIZE_MB) {
    throw Errors.badRequest(`Maximum file size cannot exceed the server limit (${env.MAX_FILE_SIZE_MB} MB)`);
  }
  if (input.maxFilesPerBatch && input.maxFilesPerBatch > env.MAX_FILES_PER_BATCH) {
    throw Errors.badRequest(`Files per batch cannot exceed the server limit (${env.MAX_FILES_PER_BATCH})`);
  }
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (input.name !== undefined) $set.name = input.name;
  for (const k of ["maxFileSizeMb", "maxFilesPerBatch", "uploadConcurrency"] as const) {
    if (input[k] === null) $unset[`settings.${k}`] = 1;
    else if (input[k] !== undefined) $set[`settings.${k}`] = input[k];
  }
  if (input.defaultPublic !== undefined) $set["settings.defaultPublic"] = input.defaultPublic;
  if (input.contentDisposition !== undefined) $set["settings.contentDisposition"] = input.contentDisposition;
  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (Object.keys(update).length) await User.updateOne({ _id: userId }, update);
  return getSettings(userId);
}

/**
 * Permanently removes the account.
 * - Workspaces the user owns alone are deleted together with all their PDFs.
 * - Workspaces shared with others: owners must transfer ownership first; members just leave
 *   (the PDFs they uploaded stay with the team, attributed to "Former member").
 */
export async function deleteAccount(userId: string, password: string) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw Errors.notFound("User not found");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw Errors.badRequest("Password is incorrect");
  }
  const memberships = await Membership.find({ userId }).lean();
  const owned: string[] = [];
  for (const m of memberships) {
    if (m.role !== "owner") continue;
    const others = await Membership.countDocuments({ workspaceId: m.workspaceId, userId: { $ne: userId } });
    if (others > 0) {
      const ws = await Workspace.findById(m.workspaceId).select("name").lean();
      throw Errors.conflict(
        `You own the shared workspace "${ws?.name}". Transfer ownership to someone else (or remove the other members) before deleting your account.`,
      );
    }
    owned.push(String(m.workspaceId));
  }

  const storage = getStorage();
  for (const workspaceId of owned) {
    const cursor = FileModel.find({ workspaceId }).cursor();
    for await (const f of cursor) {
      try {
        if (f.stagingKey) {
          if (f.uploadId) await storage.abortMultipart(f.stagingKey, f.uploadId).catch(() => {});
          await storage.delete(f.stagingKey);
        }
        if (f.uploadStatus === "completed") {
          await storage.delete(f.objectKey);
          if (f.revokedKey) await storage.delete(f.revokedKey);
        }
      } catch (e) {
        console.error("[account] storage delete failed:", e);
        throw Errors.storage("Could not remove all files from storage. Account was not deleted; try again.");
      }
      await FileModel.deleteOne({ _id: f._id });
    }
    await Promise.all([
      UploadBatch.deleteMany({ workspaceId }),
      Invite.deleteMany({ workspaceId }),
      Membership.deleteMany({ workspaceId }),
      Workspace.deleteOne({ _id: workspaceId }),
    ]);
  }
  await Promise.all([
    Membership.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
    PasswordReset.deleteMany({ userId }),
  ]);
  await User.deleteOne({ _id: userId });
}
