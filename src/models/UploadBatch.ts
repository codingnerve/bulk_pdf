import { Schema, model, models, type Model, type Types } from "mongoose";

export const BATCH_STATUSES = ["pending", "uploading", "completed", "partial", "failed"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface IUploadBatch {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  /** Uploader who created the batch. */
  userId: Types.ObjectId;
  batchId: string;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  totalSize: number;
  status: BatchStatus;
  createdAt: Date;
  completedAt?: Date;
}

const UploadBatchSchema = new Schema<IUploadBatch>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    batchId: { type: String, required: true, unique: true },
    totalFiles: { type: Number, default: 0 },
    successfulFiles: { type: Number, default: 0 },
    failedFiles: { type: Number, default: 0 },
    totalSize: { type: Number, default: 0 },
    status: { type: String, enum: BATCH_STATUSES, default: "pending" },
    completedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

UploadBatchSchema.index({ workspaceId: 1, createdAt: -1 });

export const UploadBatch: Model<IUploadBatch> =
  (models.UploadBatch as Model<IUploadBatch>) ||
  model<IUploadBatch>("UploadBatch", UploadBatchSchema);
