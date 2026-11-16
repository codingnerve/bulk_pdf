// Shared API types. Type-only re-exports are erased at build time (no server code reaches the browser).
export type { FileDto, BatchDto } from "@/services/dto";
export type { PublicUser, TokenPair } from "@/services/auth.service";
export type { UploadInstruction, InitiateResult } from "@/services/upload.service";
export type { EffectiveLimits } from "@/services/limits.service";

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OverviewStats {
  totals: {
    totalPdfs: number;
    storageUsedBytes: number;
    activeLinks: number;
    successfulUploads: number;
    failedUploads: number;
    inProgress: number;
  };
  recentUploads: import("@/services/dto").FileDto[];
  storageSeries: { date: string; bytes: number }[];
  activitySeries: { date: string; uploads: number; failed: number }[];
}

export interface SettingsPayload {
  profile: import("@/services/auth.service").PublicUser;
  settings: {
    maxFileSizeMb: number | null;
    maxFilesPerBatch: number | null;
    uploadConcurrency: number | null;
    defaultPublic: boolean;
    contentDisposition: "inline" | "attachment";
  };
  effectiveLimits: import("@/services/limits.service").EffectiveLimits;
  serverLimits: { maxFileSizeMb: number; maxFilesPerBatch: number; uploadConcurrency: number };
  publicDomain: string | null;
}

export interface SessionInfo {
  id: string;
  client: "web" | "extension";
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
}

export interface WorkspaceSummary extends WorkspaceInfo {
  current: boolean;
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
  you: boolean;
}

export interface InviteDto {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
}
