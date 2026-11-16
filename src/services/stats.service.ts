import "server-only";
import { Types } from "mongoose";
import { FileModel } from "@/models/File";
import type { Scope } from "@/lib/auth/scope";
import { fileDtos } from "./dto";

const DAY = 24 * 3600 * 1000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** All dashboard numbers are aggregated live from MongoDB. */
export async function getOverview(scope: Scope, days = 30) {
  const wid = new Types.ObjectId(scope.workspaceId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * DAY);

  const [byStatus, activeLinks, recent, completedPerDay, createdPerDay, baseline] = await Promise.all([
    FileModel.aggregate<{ _id: string; count: number; size: number }>([
      { $match: { workspaceId: wid } },
      { $group: { _id: "$uploadStatus", count: { $sum: 1 }, size: { $sum: "$size" } } },
    ]),
    FileModel.countDocuments({ workspaceId: wid, uploadStatus: "completed", isPublic: true }),
    FileModel.find({ workspaceId: wid, uploadStatus: "completed" })
      .sort({ uploadedAt: -1 })
      .limit(8)
      .lean(),
    FileModel.aggregate<{ _id: string; count: number; size: number }>([
      { $match: { workspaceId: wid, uploadStatus: "completed", uploadedAt: { $gte: start } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$uploadedAt" } },
          count: { $sum: 1 },
          size: { $sum: "$size" },
        },
      },
    ]),
    FileModel.aggregate<{ _id: { d: string; s: string }; count: number }>([
      { $match: { workspaceId: wid, uploadStatus: { $in: ["failed", "cancelled"] }, createdAt: { $gte: start } } },
      {
        $group: {
          _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, s: "$uploadStatus" },
          count: { $sum: 1 },
        },
      },
    ]),
    FileModel.aggregate<{ _id: null; size: number }>([
      { $match: { workspaceId: wid, uploadStatus: "completed", uploadedAt: { $lt: start } } },
      { $group: { _id: null, size: { $sum: "$size" } } },
    ]),
  ]);

  const by = Object.fromEntries(byStatus.map((r) => [r._id, r]));
  const completed = by.completed?.count ?? 0;
  const storageUsed = by.completed?.size ?? 0;

  const doneMap = new Map(completedPerDay.map((r) => [r._id, r]));
  const failMap = new Map<string, number>();
  for (const r of createdPerDay) failMap.set(r._id.d, (failMap.get(r._id.d) ?? 0) + r.count);

  let running = baseline[0]?.size ?? 0;
  const storageSeries: { date: string; bytes: number }[] = [];
  const activitySeries: { date: string; uploads: number; failed: number }[] = [];
  for (let i = 0; i < days; i++) {
    const key = dayKey(new Date(start.getTime() + i * DAY));
    running += doneMap.get(key)?.size ?? 0;
    storageSeries.push({ date: key, bytes: running });
    activitySeries.push({
      date: key,
      uploads: doneMap.get(key)?.count ?? 0,
      failed: failMap.get(key) ?? 0,
    });
  }

  return {
    totals: {
      totalPdfs: completed,
      storageUsedBytes: storageUsed,
      activeLinks,
      successfulUploads: completed,
      failedUploads: by.failed?.count ?? 0,
      inProgress: (by.pending?.count ?? 0) + (by.uploading?.count ?? 0) + (by.processing?.count ?? 0),
    },
    recentUploads: await fileDtos(recent, scope),
    storageSeries,
    activitySeries,
  };
}
