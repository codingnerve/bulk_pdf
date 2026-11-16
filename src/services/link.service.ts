import "server-only";
import { FileModel } from "@/models/File";
import { Errors } from "@/lib/api/errors";
import { canManageFile, type Scope } from "@/lib/auth/scope";
import { getStorage } from "@/lib/storage";
import { newPrivateKey, publicHost, publicUrlFor } from "@/lib/storage/keys";
import { escapeRegex } from "@/lib/utils";
import { fileDto, fileDtos, paginate } from "./dto";

export interface LinkQuery {
  q?: string;
  from?: string;
  to?: string;
  sort: "newest" | "oldest";
  page: number;
  pageSize: number;
}

function activeFilter(workspaceId: string) {
  return { workspaceId, uploadStatus: "completed", isPublic: true } as Record<string, unknown>;
}

export async function listLinks(scope: Scope, q: LinkQuery) {
  const filter = activeFilter(scope.workspaceId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ displayName: rx }, { originalName: rx }];
  }
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = new Date(q.from);
    if (q.to) {
      const to = new Date(q.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setUTCHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.createdAt = range;
  }
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

/** Everything the UI/extension needs to put links on the clipboard. */
export async function bulkCopyData(scope: Scope, input: { ids?: string[]; all?: boolean }) {
  const filter = activeFilter(scope.workspaceId);
  if (!input.all && input.ids) filter._id = { $in: input.ids };
  const files = await FileModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(10000)
    .select("displayName publicUrl")
    .lean();
  const links = files.map((f) => ({ id: String(f._id), name: f.displayName, url: f.publicUrl }));
  return { count: links.length, links, text: links.map((l) => l.url).join("\n") };
}

async function findInWorkspace(scope: Scope, id: string) {
  const f = await FileModel.findOne({ _id: id, workspaceId: scope.workspaceId });
  if (!f) throw Errors.notFound("File not found");
  return f;
}

/** Checks that the public URL really serves a PDF (HEAD, falling back to a 1-byte range GET). */
export async function verifyLink(scope: Scope, id: string) {
  const f = await findInWorkspace(scope, id);
  if (f.uploadStatus !== "completed" || !f.isPublic) {
    throw Errors.conflict("This file has no active public link");
  }
  const url = new URL(f.publicUrl);
  // SSRF guard: only ever probe our own public storage host.
  if (url.host !== publicHost()) throw Errors.badRequest("Refusing to probe an unexpected host");

  let status = 0;
  let contentType = "";
  let error: string | null = null;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
    }
    status = res.status;
    contentType = res.headers.get("content-type") ?? "";
  } catch (e) {
    error = (e as Error).name === "TimeoutError" ? "Timed out" : "Could not reach the public domain";
  }
  const okResult = !error && (status === 200 || status === 206) && /pdf/i.test(contentType);
  f.lastVerifiedAt = new Date();
  f.lastVerifyOk = okResult;
  await f.save();
  return {
    id: String(f._id),
    ok: okResult,
    status,
    contentType,
    checkedAt: f.lastVerifiedAt,
    error: error ?? (okResult ? null : `Unexpected response (${status || "no status"})`),
  };
}

function requireManage(scope: Scope, uploaderId: unknown) {
  if (!canManageFile(scope, uploaderId)) {
    throw Errors.forbidden("You can only change files you uploaded. Ask a workspace admin.");
  }
}

/**
 * Revoking = moving the object to a secret, never-published key. The public URL then returns
 * 404. Restoring moves it back to the *same* key, so the original URL works again.
 * (Object-store public domains expose a whole bucket/prefix, so there is no per-object flag.)
 */
export async function revokeLink(scope: Scope, id: string) {
  const f = await findInWorkspace(scope, id);
  requireManage(scope, f.userId);
  if (f.uploadStatus !== "completed") throw Errors.conflict("File is not available");
  if (!f.isPublic) return fileDto(f, scope);
  const storage = getStorage();
  const privateKey = f.revokedKey ?? newPrivateKey();
  try {
    await storage.copy(f.objectKey, privateKey);
    f.revokedKey = privateKey;
    await f.save(); // persist the private location before removing the public copy
    await storage.delete(f.objectKey);
  } catch (e) {
    console.error("[links] revoke failed:", e);
    throw Errors.storage("Could not revoke access. Please try again.");
  }
  f.isPublic = false;
  f.publicUrl = "";
  await f.save();
  return fileDto(f, scope);
}

export async function restoreLink(scope: Scope, id: string) {
  const f = await findInWorkspace(scope, id);
  requireManage(scope, f.userId);
  if (f.uploadStatus !== "completed") throw Errors.conflict("File is not available");
  if (f.isPublic) return fileDto(f, scope);
  if (!f.revokedKey) throw Errors.conflict("File content is missing");
  const storage = getStorage();
  try {
    await storage.copy(f.revokedKey, f.objectKey);
    await storage.delete(f.revokedKey);
  } catch (e) {
    console.error("[links] restore failed:", e);
    throw Errors.storage("Could not restore access. Please try again.");
  }
  f.isPublic = true;
  f.publicUrl = publicUrlFor(f.objectKey);
  f.revokedKey = undefined;
  await f.save();
  return fileDto(f, scope);
}
