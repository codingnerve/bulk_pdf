import "server-only";
import { FileModel, type IFile } from "@/models/File";
import { Errors } from "@/lib/api/errors";
import { canManageFile, type Scope } from "@/lib/auth/scope";
import { getStorage } from "@/lib/storage";
import { escapeRegex } from "@/lib/utils";
import { fileDto, fileDtos, paginate } from "./dto";
import { refreshBatch } from "./batch.service";

export interface FileQuery {
  q?: string;
  status?: IFile["uploadStatus"];
  visibility?: "all" | "public" | "revoked";
  batchId?: string;
  /** Only files uploaded by this member ("mine" filter). */
  uploadedBy?: string;
  from?: string;
  to?: string;
  sort: "newest" | "oldest";
  page: number;
  pageSize: number;
}

export function buildFileFilter(workspaceId: string, q: Omit<FileQuery, "sort" | "page" | "pageSize">) {
  // workspaceId is always part of the filter: this is the ownership boundary.
  const filter: Record<string, unknown> = { workspaceId };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ displayName: rx }, { originalName: rx }];
  }
  if (q.status) filter.uploadStatus = q.status;
  if (q.visibility === "public") Object.assign(filter, { isPublic: true, uploadStatus: "completed" });
  if (q.visibility === "revoked") Object.assign(filter, { isPublic: false, uploadStatus: "completed" });
  if (q.batchId) filter.batchId = q.batchId;
  if (q.uploadedBy) filter.userId = q.uploadedBy;
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = new Date(q.from);
    if (q.to) {
      const to = new Date(q.to);
      // A bare date (YYYY-MM-DD) should include the whole day.
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setUTCHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.createdAt = range;
  }
  return filter;
}

export async function listFiles(scope: Scope, q: FileQuery) {
  const filter = buildFileFilter(scope.workspaceId, q);
  const [items, total] = await Promise.all([
    FileModel.find(filter)
      .sort({ createdAt: q.sort === "newest" ? -1 : 1, _id: q.sort === "newest" ? -1 : 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    FileModel.countDocuments(filter),
  ]);
  return { items: await fileDtos(items, scope), pagination: paginate(q.page, q.pageSize, total) };
}

async function findInWorkspace(scope: Scope, id: string) {
  const f = await FileModel.findOne({ _id: id, workspaceId: scope.workspaceId });
  if (!f) throw Errors.notFound("File not found");
  return f;
}

function requireManage(scope: Scope, f: IFile) {
  if (!canManageFile(scope, f.userId)) {
    throw Errors.forbidden("You can only change files you uploaded. Ask a workspace admin.");
  }
}

export async function getFile(scope: Scope, id: string) {
  return fileDto(await findInWorkspace(scope, id), scope);
}

export async function renameFile(scope: Scope, id: string, displayName: string) {
  const f = await findInWorkspace(scope, id);
  requireManage(scope, f);
  f.displayName = displayName;
  await f.save();
  return fileDto(f, scope);
}

/** Presigned, short-lived download URL (attachment). Any workspace member may download. */
export async function getDownloadUrl(scope: Scope, id: string) {
  const f = await findInWorkspace(scope, id);
  if (f.uploadStatus !== "completed") throw Errors.conflict("File is not available yet");
  const key = f.isPublic ? f.objectKey : f.revokedKey;
  if (!key) throw Errors.notFound("File content is missing");
  const url = await getStorage().presignGet(key, {
    filename: f.displayName.toLowerCase().endsWith(".pdf") ? f.displayName : `${f.displayName}.pdf`,
    disposition: "attachment",
    expiresInSec: 300,
  });
  return { url, expiresInSec: 300 };
}

/** Removes every storage object the record may own, then the record itself. */
export async function destroyFile(f: IFile) {
  const storage = getStorage();
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
    console.error("[files] storage delete failed:", e);
    throw Errors.storage("Could not delete the file from cloud storage. Nothing was removed; try again.");
  }
  await FileModel.deleteOne({ _id: f._id });
}

export async function deleteFile(scope: Scope, id: string) {
  const f = await findInWorkspace(scope, id);
  requireManage(scope, f);
  await destroyFile(f);
  await refreshBatch(scope.workspaceId, f.batchId);
  return { id };
}

export async function bulkDeleteFiles(scope: Scope, ids: string[]) {
  const files = await FileModel.find({ _id: { $in: ids }, workspaceId: scope.workspaceId });
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const batches = new Set<string>();
  const queue: IFile[] = [];
  for (const f of files) {
    if (canManageFile(scope, f.userId)) queue.push(f);
    else failed.push({ id: String(f._id), error: "You can only delete files you uploaded" });
  }
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        await destroyFile(f);
        deleted.push(String(f._id));
        batches.add(f.batchId);
      } catch (e) {
        failed.push({ id: String(f._id), error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  for (const b of batches) await refreshBatch(scope.workspaceId, b).catch(() => {});
  const found = new Set(files.map((f) => String(f._id)));
  const notFound = ids.filter((id) => !found.has(id));
  return { deleted, failed, notFound };
}
