import { z } from "zod";
import { passwordSchema } from "@/lib/validators/password-rule";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const idList = (max: number) => z.array(objectId).min(1).max(max);

// ---- auth --------------------------------------------------------------------
const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email,
  password: passwordSchema,
  client: z.enum(["web", "extension"]).default("web"),
  deviceLabel: z.string().trim().max(100).optional(),
  inviteToken: z.string().min(20).max(200).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
  client: z.enum(["web", "extension"]).default("web"),
  deviceLabel: z.string().trim().max(100).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  allDevices: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ---- uploads -----------------------------------------------------------------
export const initiateUploadSchema = z.object({
  batchId: z.string().regex(/^bch_[a-z0-9]{10,}$/).optional(),
  allowDuplicates: z.boolean().optional().default(false),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        size: z.number().int().positive(),
        type: z.string().max(100),
      }),
    )
    .min(1)
    .max(1000),
});

export const completeUploadSchema = z.object({
  fileId: objectId,
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(200),
      }),
    )
    .max(10000)
    .optional(),
});

export const cancelUploadSchema = z.object({ fileId: objectId });

// ---- files / links -----------------------------------------------------------
const pageNum = z.coerce.number().int().min(1).max(100000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);
const dateStr = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
  .optional();

export const listFilesQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z
    .enum(["pending", "uploading", "processing", "completed", "failed", "cancelled"])
    .optional(),
  visibility: z.enum(["all", "public", "revoked"]).default("all"),
  batchId: z.string().max(60).optional(),
  uploadedBy: objectId.optional(),
  from: dateStr,
  to: dateStr,
  sort: z.enum(["newest", "oldest"]).default("newest"),
  page: pageNum,
  pageSize,
});

export const listLinksQuery = z.object({
  q: z.string().trim().max(200).optional(),
  from: dateStr,
  to: dateStr,
  sort: z.enum(["newest", "oldest"]).default("newest"),
  page: pageNum,
  pageSize,
});

export const patchFileSchema = z
  .object({ displayName: z.string().trim().min(1).max(255) })
  .strict();

export const bulkDeleteSchema = z.object({ ids: idList(500) });

export const bulkCopySchema = z
  .object({ ids: idList(5000).optional(), all: z.boolean().optional() })
  .refine((v) => v.ids || v.all, "Provide ids or all=true");

// ---- batches / exports -----------------------------------------------------------
export const listBatchesQuery = z.object({
  page: pageNum,
  pageSize,
  status: z.enum(["pending", "uploading", "completed", "partial", "failed"]).optional(),
});

export const exportSchema = z.object({
  ids: idList(10000).optional(),
  batchId: z.string().max(60).optional(),
  includeAll: z.boolean().optional().default(false),
});

// ---- settings --------------------------------------------------------------------
export const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    maxFileSizeMb: z.number().int().min(1).max(5000).nullable().optional(),
    maxFilesPerBatch: z.number().int().min(1).max(1000).nullable().optional(),
    uploadConcurrency: z.number().int().min(1).max(16).nullable().optional(),
    defaultPublic: z.boolean().optional(),
    contentDisposition: z.enum(["inline", "attachment"]).optional(),
  })
  .strict();

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(200) });

// ---- workspaces ------------------------------------------------------------------
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(100) });
export const switchWorkspaceSchema = z.object({ workspaceId: objectId });
export const inviteSchema = z.object({
  email,
  role: z.enum(["admin", "member"]).default("member"),
});
export const memberRoleSchema = z.object({ role: z.enum(["owner", "admin", "member"]) });
export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200) });
