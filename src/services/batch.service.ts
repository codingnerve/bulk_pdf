import "server-only";
import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { UploadBatch } from "@/models/UploadBatch";
import { FileModel } from "@/models/File";
import { Errors } from "@/lib/api/errors";
import type { Scope } from "@/lib/auth/scope";
import { fileDtos, loadNames, paginate, toBatchDto } from "./dto";

export const newBatchId = () => `bch_${randomBytes(8).toString("hex")}`;

export async function createBatch(scope: Scope) {
  const batch = await UploadBatch.create({
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    batchId: newBatchId(),
  });
  return toBatchDto(batch, await loadNames([batch.userId]));
}

/** Returns the caller's own batch in this workspace, or creates one when no id is supplied. */
export async function ensureBatch(scope: Scope, batchId?: string) {
  if (!batchId) {
    return UploadBatch.create({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      batchId: newBatchId(),
    });
  }
  // Teammates can read each other's batches but only add files to their own.
  const batch = await UploadBatch.findOne({ workspaceId: scope.workspaceId, userId: scope.userId, batchId });
  if (!batch) throw Errors.notFound("Batch not found");
  return batch;
}

/** Recomputes batch counters from the source of truth (the file records). */
export async function refreshBatch(workspaceId: string, batchId: string) {
  const rows = await FileModel.aggregate<{ _id: string; count: number; size: number }>([
    { $match: { workspaceId: new Types.ObjectId(workspaceId), batchId } },
    { $group: { _id: "$uploadStatus", count: { $sum: 1 }, size: { $sum: "$size" } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r]));
  const get = (s: string) => by[s]?.count ?? 0;
  const total = rows.reduce((n, r) => n + r.count, 0);
  const totalSize = rows.reduce((n, r) => n + r.size, 0);
  const completed = get("completed");
  const failed = get("failed") + get("cancelled");
  const inFlight = get("pending") + get("uploading") + get("processing");

  let status: "pending" | "uploading" | "completed" | "partial" | "failed";
  if (inFlight > 0) status = inFlight === total ? "pending" : "uploading";
  else if (total === 0) status = "pending";
  else if (completed === total) status = "completed";
  else if (completed === 0) status = "failed";
  else status = "partial";

  const finished = inFlight === 0 && total > 0;
  const update: Record<string, unknown> = {
    totalFiles: total,
    successfulFiles: completed,
    failedFiles: failed,
    totalSize,
    status,
  };
  const res = await UploadBatch.findOneAndUpdate(
    { workspaceId, batchId },
    finished ? { $set: { ...update, completedAt: new Date() } } : { $set: update, $unset: { completedAt: 1 } },
    { returnDocument: "after" },
  );
  return res ? toBatchDto(res) : null;
}

export async function listBatches(scope: Scope, q: { page: number; pageSize: number; status?: string }) {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    UploadBatch.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    UploadBatch.countDocuments(filter),
  ]);
  const names = await loadNames(items.map((b) => b.userId));
  return { items: items.map((b) => toBatchDto(b, names)), pagination: paginate(q.page, q.pageSize, total) };
}

/** A batch (looked up by Mongo id *or* public batchId) with its files. */
export async function getBatch(scope: Scope, idOrBatchId: string) {
  const isOid = /^[a-f\d]{24}$/i.test(idOrBatchId);
  const where = isOid ? { _id: idOrBatchId } : { batchId: idOrBatchId };
  const batch = await UploadBatch.findOne({ workspaceId: scope.workspaceId, ...where }).lean();
  if (!batch) throw Errors.notFound("Batch not found");
  const files = await FileModel.find({ workspaceId: scope.workspaceId, batchId: batch.batchId })
    .sort({ createdAt: 1 })
    .limit(1000)
    .lean();
  const names = await loadNames([batch.userId]);
  return { ...toBatchDto(batch, names), files: await fileDtos(files, scope) };
}
