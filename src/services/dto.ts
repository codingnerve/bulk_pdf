import type { IFile } from "@/models/File";
import type { IUploadBatch } from "@/models/UploadBatch";
import { User } from "@/models/User";
import { canManageFile, type Scope } from "@/lib/auth/scope";

export interface FileDto {
  id: string;
  originalName: string;
  displayName: string;
  size: number;
  mimeType: string;
  uploadStatus: IFile["uploadStatus"];
  isPublic: boolean;
  publicUrl: string;
  batchId: string;
  storageLocation: string;
  uploadMode: IFile["uploadMode"];
  errorMessage: string | null;
  lastVerifiedAt: Date | null;
  lastVerifyOk: boolean | null;
  uploadedAt: Date | null;
  createdAt: Date;
  uploadedBy: { id: string; name: string };
  /** Can the current user rename / revoke / delete this file? */
  canManage: boolean;
}

export const FORMER_MEMBER = "Former member";

/** userId → display name for the given ids (one query). */
export async function loadNames(ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select("name")
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

/** Never leaks staging/private storage keys – only the public location. */
export function toFileDto(f: IFile, scope: Scope, names: Map<string, string>): FileDto {
  const live = f.uploadStatus === "completed";
  return {
    id: String(f._id),
    originalName: f.originalName,
    displayName: f.displayName,
    size: f.size,
    mimeType: f.mimeType,
    uploadStatus: f.uploadStatus,
    isPublic: f.isPublic,
    publicUrl: f.isPublic && live ? f.publicUrl : "",
    batchId: f.batchId,
    storageLocation: live ? (f.isPublic ? f.objectKey : "private (revoked)") : "pending",
    uploadMode: f.uploadMode,
    errorMessage: f.errorMessage ?? null,
    lastVerifiedAt: f.lastVerifiedAt ?? null,
    lastVerifyOk: f.lastVerifyOk ?? null,
    uploadedAt: f.uploadedAt ?? null,
    createdAt: f.createdAt,
    uploadedBy: { id: String(f.userId), name: names.get(String(f.userId)) ?? FORMER_MEMBER },
    canManage: canManageFile(scope, f.userId),
  };
}

export async function fileDtos(files: IFile[], scope: Scope): Promise<FileDto[]> {
  const names = await loadNames(files.map((f) => f.userId));
  return files.map((f) => toFileDto(f, scope, names));
}

export async function fileDto(file: IFile, scope: Scope): Promise<FileDto> {
  return (await fileDtos([file], scope))[0];
}

export interface BatchDto {
  id: string;
  batchId: string;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  totalSize: number;
  status: IUploadBatch["status"];
  createdAt: Date;
  completedAt: Date | null;
  createdBy: { id: string; name: string };
}

export function toBatchDto(b: IUploadBatch, names: Map<string, string> = new Map()): BatchDto {
  return {
    id: String(b._id),
    batchId: b.batchId,
    totalFiles: b.totalFiles,
    successfulFiles: b.successfulFiles,
    failedFiles: b.failedFiles,
    totalSize: b.totalSize,
    status: b.status,
    createdAt: b.createdAt,
    completedAt: b.completedAt ?? null,
    createdBy: { id: String(b.userId), name: names.get(String(b.userId)) ?? FORMER_MEMBER },
  };
}

export function paginate(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
