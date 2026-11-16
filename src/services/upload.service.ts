import "server-only";
import { FileModel, type IFile } from "@/models/File";
import { Errors } from "@/lib/api/errors";
import { getStorage } from "@/lib/storage";
import {
  buildContentDisposition,
  newObjectKey,
  newPrivateKey,
  newStagingKey,
  publicUrlFor,
} from "@/lib/storage/keys";
import type { CompletedPart, StorageDriver } from "@/lib/storage/types";
import { hasPdfSignature, sanitizeFilename, validatePdfInfo, SIGNATURE_WINDOW } from "@/lib/validators/pdf";
import { ensureBatch, refreshBatch } from "./batch.service";
import type { Scope } from "@/lib/auth/scope";
import { fileDto, type FileDto } from "./dto";
import { getEffectiveLimits } from "./limits.service";

const SINGLE_URL_TTL = 60 * 60; // 1 h – covers queued files in large batches
const PART_URL_TTL = 6 * 60 * 60; // 6 h – large multipart uploads on slow links
const MAX_PARTS = 9000;
// Deliberately short: revoking a link must take effect quickly even for browser/CDN-cached copies.
const CACHE_CONTROL = "public, max-age=300";
const MIB = 1024 * 1024;

export interface UploadInstruction {
  fileId: string;
  mode: "single" | "multipart";
  expiresAt: string;
  single?: { url: string; headers: Record<string, string> };
  multipart?: {
    uploadId: string;
    partSize: number;
    parts: { partNumber: number; url: string }[];
  };
}

export type InitiateResult =
  | { index: number; name: string; status: "ready"; file: FileDto; upload: UploadInstruction }
  | {
      index: number;
      name: string;
      status: "rejected";
      code: "INVALID" | "DUPLICATE" | "STORAGE_ERROR";
      reason: string;
    };

function partSizeFor(size: number, configured: number): number {
  const minForCount = Math.ceil(size / MAX_PARTS);
  return Math.max(configured, Math.ceil(minForCount / MIB) * MIB);
}

async function buildInstruction(
  storage: StorageDriver,
  file: Pick<IFile, "_id" | "stagingKey" | "uploadMode" | "uploadId" | "size" | "partSize">,
  headers: { contentType: string; contentDisposition: string; cacheControl: string },
): Promise<UploadInstruction> {
  const key = file.stagingKey as string;
  if (file.uploadMode === "multipart") {
    const partSize = file.partSize as number;
    const count = Math.ceil(file.size / partSize);
    const parts = await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        partNumber: i + 1,
        url: await storage.presignPart(key, file.uploadId as string, i + 1, PART_URL_TTL),
      })),
    );
    return {
      fileId: String(file._id),
      mode: "multipart",
      expiresAt: new Date(Date.now() + PART_URL_TTL * 1000).toISOString(),
      multipart: { uploadId: file.uploadId as string, partSize, parts },
    };
  }
  const put = await storage.presignPut(key, headers, SINGLE_URL_TTL);
  return {
    fileId: String(file._id),
    mode: "single",
    expiresAt: new Date(Date.now() + SINGLE_URL_TTL * 1000).toISOString(),
    single: put,
  };
}

const headersFor = (f: Pick<IFile, "contentDisposition" | "originalName">) => ({
  contentType: "application/pdf",
  contentDisposition: buildContentDisposition(f.contentDisposition, f.originalName),
  cacheControl: CACHE_CONTROL,
});

/**
 * Validates every file, creates a File record per accepted file and returns presigned
 * upload instructions. One rejected file never blocks the others.
 */
export async function initiateUploads(
  scope: Scope,
  input: {
    batchId?: string;
    allowDuplicates: boolean;
    files: { name: string; size: number; type: string }[];
  },
) {
  const limits = await getEffectiveLimits(scope.userId);
  const batch = await ensureBatch(scope, input.batchId);

  const existingCount = await FileModel.countDocuments({ workspaceId: scope.workspaceId, batchId: batch.batchId });
  if (existingCount + input.files.length > limits.maxFilesPerBatch) {
    throw Errors.badRequest(
      `A batch can contain at most ${limits.maxFilesPerBatch} files (${existingCount} already in this batch)`,
    );
  }

  const candidates = input.files.map((f, index) => ({
    index,
    raw: f,
    name: sanitizeFilename(f.name),
    error: validatePdfInfo({ ...f, name: sanitizeFilename(f.name) }, limits),
  }));

  // Duplicate detection (same name + size already uploaded, or repeated in this request).
  const duplicateKeys = new Set<string>();
  if (!input.allowDuplicates) {
    const pairs = candidates.filter((c) => !c.error).map((c) => ({ originalName: c.name, size: c.raw.size }));
    if (pairs.length) {
      const dupes = await FileModel.find({ workspaceId: scope.workspaceId, uploadStatus: "completed", $or: pairs })
        .select("originalName size")
        .lean();
      for (const d of dupes) duplicateKeys.add(`${d.originalName}\u0000${d.size}`);
    }
  }

  const storage = getStorage();
  const seen = new Set<string>();
  const results: InitiateResult[] = [];

  for (const c of candidates) {
    if (c.error) {
      results.push({ index: c.index, name: c.raw.name, status: "rejected", code: "INVALID", reason: c.error });
      continue;
    }
    const dupKey = `${c.name}\u0000${c.raw.size}`;
    if (!input.allowDuplicates && (duplicateKeys.has(dupKey) || seen.has(dupKey))) {
      results.push({
        index: c.index,
        name: c.raw.name,
        status: "rejected",
        code: "DUPLICATE",
        reason: "A file with the same name and size was already uploaded",
      });
      continue;
    }
    seen.add(dupKey);

    const multipart = c.raw.size > limits.multipartThresholdBytes;
    const stagingKey = newStagingKey();
    const headers = {
      contentType: "application/pdf",
      contentDisposition: buildContentDisposition(limits.contentDisposition, c.name),
      cacheControl: CACHE_CONTROL,
    };
    let uploadId: string | undefined;
    try {
      if (multipart) uploadId = (await storage.createMultipart(stagingKey, headers)).uploadId;
      const doc = await FileModel.create({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        originalName: c.name,
        displayName: c.name,
        objectKey: newObjectKey(),
        stagingKey,
        mimeType: "application/pdf",
        size: c.raw.size,
        uploadStatus: "pending",
        isPublic: false,
        batchId: batch.batchId,
        uploadMode: multipart ? "multipart" : "single",
        uploadId,
        partSize: multipart ? partSizeFor(c.raw.size, limits.partSizeBytes) : undefined,
        contentDisposition: limits.contentDisposition,
      }).catch(async (e) => {
        if (uploadId) await storage.abortMultipart(stagingKey, uploadId).catch(() => {});
        throw e;
      });
      const upload = await buildInstruction(storage, doc, headers);
      results.push({ index: c.index, name: c.raw.name, status: "ready", file: await fileDto(doc, scope), upload });
    } catch (e) {
      console.error("[upload] initiate failed for a file:", e);
      results.push({
        index: c.index,
        name: c.raw.name,
        status: "rejected",
        code: "STORAGE_ERROR",
        reason: "Could not prepare cloud storage for this file. Please retry.",
      });
    }
  }

  await refreshBatch(scope.workspaceId, batch.batchId);
  return { batchId: batch.batchId, results };
}

/** Re-issues presigned URLs for a not-yet-completed upload (expired URL / resume after reload). */
export async function refreshUpload(scope: Scope, fileId: string) {
  const file = await getOwnedFile(scope, fileId);
  if (!["pending", "uploading"].includes(file.uploadStatus)) {
    throw Errors.conflict(`Upload is ${file.uploadStatus}; it cannot be resumed`);
  }
  if (!file.stagingKey) throw Errors.conflict("Upload cannot be resumed");
  return buildInstruction(getStorage(), file, headersFor(file));
}

/** Upload operations are limited to the member who started the upload. */
export async function getOwnedFile(scope: Scope, fileId: string) {
  const file = await FileModel.findOne({ _id: fileId, workspaceId: scope.workspaceId, userId: scope.userId });
  if (!file) throw Errors.notFound("File not found");
  return file;
}

async function failFile(file: InstanceType<typeof FileModel>, message: string, workspaceId: string) {
  const storage = getStorage();
  if (file.stagingKey) await storage.delete(file.stagingKey).catch(() => {});
  file.uploadStatus = "failed";
  file.errorMessage = message;
  await file.save();
  await refreshBatch(workspaceId, file.batchId);
}

/**
 * Verifies the uploaded object (existence, size, PDF signature) and only then publishes it:
 * the staging object is copied to its public key. Public URLs never exist before this succeeds.
 */
export async function completeUpload(
  scope: Scope,
  input: { fileId: string; parts?: { partNumber: number; etag: string }[] },
): Promise<FileDto> {
  const storage = getStorage();
  const file = await getOwnedFile(scope, input.fileId);

  if (file.uploadStatus === "completed") return fileDto(file, scope); // idempotent
  if (file.uploadStatus === "cancelled") throw Errors.conflict("This upload was cancelled");
  if (file.uploadStatus === "failed") throw Errors.conflict(file.errorMessage || "This upload failed");
  if (!file.stagingKey) throw Errors.conflict("Upload cannot be completed");

  // Claim the file for processing; a concurrent complete call gets a conflict.
  const claimed = await FileModel.findOneAndUpdate(
    { _id: file._id, uploadStatus: { $in: ["pending", "uploading", "processing"] } },
    { $set: { uploadStatus: "processing" }, $unset: { errorMessage: 1 } },
    { returnDocument: "after" },
  );
  if (!claimed) throw Errors.conflict("Upload is no longer pending");

  try {
    if (claimed.uploadMode === "multipart" && claimed.uploadId) {
      const expected = Math.ceil(claimed.size / (claimed.partSize as number));
      const parts = input.parts ?? [];
      const unique = new Set(parts.map((p) => p.partNumber));
      if (parts.length !== expected || unique.size !== expected) {
        await FileModel.updateOne({ _id: claimed._id }, { $set: { uploadStatus: "uploading" } });
        throw Errors.badRequest(`Expected ${expected} uploaded parts, received ${parts.length}`);
      }
      const clean: CompletedPart[] = parts.map((p) => ({
        partNumber: p.partNumber,
        etag: p.etag.replace(/"/g, ""),
      }));
      try {
        await storage.completeMultipart(claimed.stagingKey as string, claimed.uploadId, clean);
      } catch (e) {
        await FileModel.updateOne({ _id: claimed._id }, { $set: { uploadStatus: "uploading" } });
        console.error("[upload] completeMultipart failed:", e);
        throw Errors.storage("Could not assemble the uploaded parts. Retry the upload.");
      }
    }

    let head;
    try {
      head = await storage.head(claimed.stagingKey as string);
    } catch (e) {
      await FileModel.updateOne({ _id: claimed._id }, { $set: { uploadStatus: "uploading" } });
      console.error("[upload] head failed:", e);
      throw Errors.storage();
    }
    if (!head) {
      await FileModel.updateOne({ _id: claimed._id }, { $set: { uploadStatus: "uploading" } });
      throw Errors.badRequest("The file was not found in storage. Upload it again.");
    }
    if (head.size !== claimed.size) {
      await failFile(claimed, `Uploaded size (${head.size} B) does not match the declared size (${claimed.size} B)`, scope.workspaceId);
      throw Errors.badRequest("Uploaded file size does not match the declared size");
    }
    const first = await storage.readRange(
      claimed.stagingKey as string,
      0,
      Math.min(claimed.size, SIGNATURE_WINDOW) - 1,
    );
    if (!hasPdfSignature(first)) {
      await failFile(claimed, "The file is not a valid PDF (missing %PDF- signature)", scope.workspaceId);
      throw Errors.badRequest("The uploaded file is not a valid PDF");
    }

    // Publish: staging → public (or private when the user's default link behaviour is private).
    const limits = await getEffectiveLimits(scope.userId);
    const stagingKey = claimed.stagingKey as string;
    try {
      // Never trust the headers the browser sent: the signature does not cover Content-Type
      // or Cache-Control, so the published object is written with server-chosen headers.
      const enforced = headersFor(claimed);
      if (limits.defaultPublic) {
        await storage.copy(stagingKey, claimed.objectKey, enforced);
        claimed.isPublic = true;
        claimed.publicUrl = publicUrlFor(claimed.objectKey);
      } else {
        const privateKey = newPrivateKey();
        await storage.copy(stagingKey, privateKey, enforced);
        claimed.revokedKey = privateKey;
        claimed.isPublic = false;
        claimed.publicUrl = "";
      }
      await storage.delete(stagingKey).catch((e) => console.warn("[upload] staging cleanup failed:", e));
    } catch (e) {
      await FileModel.updateOne({ _id: claimed._id }, { $set: { uploadStatus: "uploading" } });
      console.error("[upload] publish failed:", e);
      throw Errors.storage("Could not publish the file. Retry the upload completion.");
    }

    claimed.uploadStatus = "completed";
    claimed.checksum = head.etag;
    claimed.uploadedAt = new Date();
    claimed.stagingKey = undefined;
    claimed.uploadId = undefined;
    claimed.errorMessage = undefined;
    await claimed.save();
    await refreshBatch(scope.workspaceId, claimed.batchId);
    return fileDto(claimed, scope);
  } catch (e) {
    // refresh counters even on failure paths so the batch stays accurate
    await refreshBatch(scope.workspaceId, claimed.batchId).catch(() => {});
    throw e;
  }
}

export async function cancelUpload(scope: Scope, fileId: string) {
  const file = await getOwnedFile(scope, fileId);
  if (file.uploadStatus === "completed") throw Errors.conflict("The upload already completed");
  if (file.uploadStatus === "cancelled") return fileDto(file, scope);
  await releaseStaging(file);
  file.uploadStatus = "cancelled";
  file.errorMessage = "Cancelled by user";
  file.stagingKey = undefined;
  file.uploadId = undefined;
  await file.save();
  await refreshBatch(scope.workspaceId, file.batchId);
  return fileDto(file, scope);
}

async function releaseStaging(file: Pick<IFile, "stagingKey" | "uploadId">) {
  const storage = getStorage();
  if (file.stagingKey) {
    if (file.uploadId) await storage.abortMultipart(file.stagingKey, file.uploadId).catch(() => {});
    await storage.delete(file.stagingKey).catch(() => {});
  }
}

export async function getUploadStatus(scope: Scope, fileId: string) {
  const file = await getOwnedFile(scope, fileId);
  return {
    fileId: String(file._id),
    status: file.uploadStatus,
    size: file.size,
    mode: file.uploadMode,
    batchId: file.batchId,
    publicUrl: file.isPublic && file.uploadStatus === "completed" ? file.publicUrl : "",
    error: file.errorMessage ?? null,
  };
}

/**
 * Housekeeping for abandoned uploads (browser closed, network lost for good).
 * Aborts the multipart upload, removes staged bytes and marks the file failed.
 * Run from a cron job; also set an R2 lifecycle rule as a second safety net (see README).
 */
export async function cleanupAbandonedUploads(maxAgeHours = 24, limit = 500) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);
  const stale = await FileModel.find({
    uploadStatus: { $in: ["pending", "uploading", "processing"] },
    updatedAt: { $lt: cutoff },
  })
    .limit(limit)
    .exec();
  const touched = new Set<string>();
  for (const f of stale) {
    await releaseStaging(f);
    f.uploadStatus = "failed";
    f.errorMessage = "Upload was abandoned and cleaned up";
    f.stagingKey = undefined;
    f.uploadId = undefined;
    await f.save();
    touched.add(`${f.workspaceId}:${f.batchId}`);
  }
  for (const key of touched) {
    const [uid, bid] = key.split(":");
    await refreshBatch(uid, bid).catch(() => {});
  }
  return { cleaned: stale.length };
}

export { MIB };
