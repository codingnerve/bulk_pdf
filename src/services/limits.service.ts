import "server-only";
import { User } from "@/models/User";
import { getEnv } from "@/lib/env";
import { Errors } from "@/lib/api/errors";

export interface EffectiveLimits {
  maxFileSizeMb: number;
  maxFileSizeBytes: number;
  maxFilesPerBatch: number;
  uploadConcurrency: number;
  multipartThresholdBytes: number;
  partSizeBytes: number;
  defaultPublic: boolean;
  contentDisposition: "inline" | "attachment";
}

/** Server limits from env are hard caps; users may only lower them. */
export async function getEffectiveLimits(userId: string): Promise<EffectiveLimits> {
  const env = getEnv();
  const user = await User.findById(userId).select("settings").lean();
  if (!user) throw Errors.notFound("User not found");
  const s = user.settings ?? ({} as NonNullable<typeof user.settings>);
  const maxFileSizeMb = Math.min(env.MAX_FILE_SIZE_MB, s.maxFileSizeMb ?? env.MAX_FILE_SIZE_MB);
  return {
    maxFileSizeMb,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxFilesPerBatch: Math.min(env.MAX_FILES_PER_BATCH, s.maxFilesPerBatch ?? env.MAX_FILES_PER_BATCH),
    uploadConcurrency: Math.min(16, s.uploadConcurrency ?? env.UPLOAD_CONCURRENCY),
    multipartThresholdBytes: env.MULTIPART_THRESHOLD_MB * 1024 * 1024,
    partSizeBytes: env.MULTIPART_PART_SIZE_MB * 1024 * 1024,
    defaultPublic: s.defaultPublic ?? true,
    contentDisposition: s.contentDisposition ?? "inline",
  };
}
