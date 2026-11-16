import { Schema, model, models, type Model, type Types } from "mongoose";

export const UPLOAD_STATUSES = [
  "pending",
  "uploading",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export interface IFile {
  _id: Types.ObjectId;
  /** The workspace that owns the file (the ownership boundary for every query). */
  workspaceId: Types.ObjectId;
  /** The member who uploaded it. */
  userId: Types.ObjectId;
  originalName: string;
  displayName: string;
  /** Public location of the object (served through the custom domain). */
  objectKey: string;
  /** Secret location while public access is revoked. Never exposed via the API. */
  revokedKey?: string;
  /** Where the browser uploads to. Only after verification is the object copied to objectKey. */
  stagingKey?: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  uploadStatus: UploadStatus;
  isPublic: boolean;
  checksum?: string;
  batchId: string;
  uploadMode: "single" | "multipart";
  uploadId?: string;
  partSize?: number;
  contentDisposition: "inline" | "attachment";
  errorMessage?: string;
  lastVerifiedAt?: Date;
  lastVerifyOk?: boolean;
  uploadedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<IFile>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    originalName: { type: String, required: true, maxlength: 255 },
    displayName: { type: String, required: true, maxlength: 255 },
    objectKey: { type: String, required: true, unique: true },
    revokedKey: { type: String },
    stagingKey: { type: String },
    publicUrl: { type: String, default: "" },
    mimeType: { type: String, required: true, default: "application/pdf" },
    size: { type: Number, required: true, min: 0 },
    uploadStatus: { type: String, enum: UPLOAD_STATUSES, default: "pending" },
    isPublic: { type: Boolean, default: false },
    checksum: { type: String },
    batchId: { type: String, required: true },
    uploadMode: { type: String, enum: ["single", "multipart"], default: "single" },
    uploadId: { type: String },
    partSize: { type: Number },
    contentDisposition: { type: String, enum: ["inline", "attachment"], default: "inline" },
    errorMessage: { type: String, maxlength: 500 },
    lastVerifiedAt: { type: Date },
    lastVerifyOk: { type: Boolean },
    uploadedAt: { type: Date },
  },
  { timestamps: true },
);

FileSchema.index({ workspaceId: 1, uploadStatus: 1, uploadedAt: -1 });
FileSchema.index({ workspaceId: 1, batchId: 1 });
FileSchema.index({ workspaceId: 1, createdAt: -1 });
FileSchema.index({ workspaceId: 1, isPublic: 1, uploadStatus: 1, uploadedAt: -1 });
FileSchema.index({ workspaceId: 1, originalName: 1, size: 1 });
FileSchema.index({ uploadStatus: 1, updatedAt: 1 }); // abandoned-upload cleanup

export const FileModel: Model<IFile> =
  (models.File as Model<IFile>) || model<IFile>("File", FileSchema);
