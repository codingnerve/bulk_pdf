import { afterEach, describe, expect, it, vi } from "vitest";
import { createUser, ctx, mem, req, uploadOne } from "./helpers";
import { FileModel } from "@/models/File";
import { UploadBatch } from "@/models/UploadBatch";
import { bulkDeleteFiles, deleteFile, getDownloadUrl, getFile, listFiles, renameFile } from "@/services/file.service";
import { bulkCopyData, listLinks, restoreLink, revokeLink, verifyLink } from "@/services/link.service";
import { getBatch, listBatches } from "@/services/batch.service";
import { getOverview } from "@/services/stats.service";
import { GET as filesGet } from "@/app/api/v1/files/route";
import { GET as fileGet, PATCH as filePatch, DELETE as fileDelete } from "@/app/api/v1/files/[id]/route";
import { POST as bulkDeleteRoute } from "@/app/api/v1/files/bulk-delete/route";
import { POST as revokeRoute } from "@/app/api/v1/links/[id]/revoke/route";
import { initiateUploads } from "@/services/upload.service";

const q = { sort: "newest" as const, page: 1, pageSize: 20 };

afterEach(() => vi.unstubAllGlobals());

describe("file listing", () => {
  it("paginates, sorts and counts", async () => {
    const { scope } = await createUser();
    for (let i = 0; i < 5; i++) await uploadOne(scope, `doc-${i}.pdf`, 100 + i);
    const p1 = await listFiles(scope, { ...q, pageSize: 2 });
    expect(p1.items.map((f) => f.displayName)).toEqual(["doc-4.pdf", "doc-3.pdf"]);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    const last = await listFiles(scope, { ...q, pageSize: 2, page: 3 });
    expect(last.items).toHaveLength(1);
    const oldest = await listFiles(scope, { ...q, sort: "oldest", pageSize: 1 });
    expect(oldest.items[0].displayName).toBe("doc-0.pdf");
  });

  it("searches by filename (case-insensitive) and treats regex characters literally", async () => {
    const { scope } = await createUser();
    await uploadOne(scope, "Invoice (2026).pdf", 101);
    await uploadOne(scope, "notes.pdf", 102);
    expect((await listFiles(scope, { ...q, q: "INVOICE" })).items).toHaveLength(1);
    expect((await listFiles(scope, { ...q, q: "(2026)" })).items).toHaveLength(1);
    expect((await listFiles(scope, { ...q, q: ".*" })).items).toHaveLength(0);
  });

  it("filters by status, visibility and date range", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope, "a.pdf", 101);
    await uploadOne(scope, "b.pdf", 102);
    await initiateUploads(scope, { files: [{ name: "p.pdf", size: 5, type: "application/pdf" }], allowDuplicates: false });
    await revokeLink(scope, file.id);

    expect((await listFiles(scope, { ...q, status: "pending" })).items).toHaveLength(1);
    expect((await listFiles(scope, { ...q, status: "completed" })).items).toHaveLength(2);
    expect((await listFiles(scope, { ...q, visibility: "public" })).items.map((f) => f.displayName)).toEqual(["b.pdf"]);
    expect((await listFiles(scope, { ...q, visibility: "revoked" })).items.map((f) => f.displayName)).toEqual(["a.pdf"]);

    const today = new Date().toISOString().slice(0, 10);
    expect((await listFiles(scope, { ...q, from: today, to: today })).items).toHaveLength(3);
    expect((await listFiles(scope, { ...q, to: "2000-01-01" })).items).toHaveLength(0);
  });

  it("only ever returns the caller's own files", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com", "Bob");
    const { file } = await uploadOne(alice.scope, "secret.pdf");
    expect((await listFiles(bob.scope, q)).items).toHaveLength(0);
    await expect(getFile(bob.scope, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(renameFile(bob.scope, file.id, "pwned")).rejects.toMatchObject({ status: 404 });
    await expect(deleteFile(bob.scope, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(getDownloadUrl(bob.scope, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(revokeLink(bob.scope, file.id)).rejects.toMatchObject({ status: 404 });
    expect((await bulkCopyData(bob.scope, { ids: [file.id] })).count).toBe(0);
    const viaApi = await fileGet(req("GET", `/api/v1/files/${file.id}`, { headers: bob.bearer }), ctx({ id: file.id }));
    expect(viaApi.status).toBe(404);
    // still intact for the owner
    expect((await getFile(alice.scope, file.id)).displayName).toBe("secret.pdf");
  });

  it("serves the API with a consistent envelope and pagination meta", async () => {
    const { scope, bearer } = await createUser();
    await uploadOne(scope, "a.pdf");
    const res = await filesGet(req("GET", "/api/v1/files?pageSize=5&q=a", { headers: bearer }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination.total).toBe(1);
    const invalid = await filesGet(req("GET", "/api/v1/files?pageSize=5000", { headers: bearer }));
    expect(invalid.status).toBe(400);
    const operator = await filesGet(req("GET", "/api/v1/files?status[$ne]=x", { headers: bearer }));
    expect(operator.status).toBe(200); // bracket syntax is just an unknown key and is ignored
  });

  it("does not leak storage keys in responses", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    const json = JSON.stringify(file);
    expect(json).not.toMatch(/staging|private\/|revokedKey|stagingKey/);
  });
});

describe("rename and delete", () => {
  it("renames the display name only", async () => {
    const { scope, bearer } = await createUser();
    const { file } = await uploadOne(scope, "orig.pdf");
    const res = await filePatch(req("PATCH", `/api/v1/files/${file.id}`, { headers: bearer, body: { displayName: "Quarterly report" } }), ctx({ id: file.id }));
    expect((await res.json()).data.file).toMatchObject({ displayName: "Quarterly report", originalName: "orig.pdf" });
    const strict = await filePatch(req("PATCH", `/api/v1/files/${file.id}`, { headers: bearer, body: { displayName: "x", isPublic: true, userId: "y" } }), ctx({ id: file.id }));
    expect(strict.status).toBe(400);
  });

  it("deletes the object from storage and the record from the database", async () => {
    const { scope, bearer } = await createUser();
    const { file, batchId } = await uploadOne(scope);
    const doc = await FileModel.findById(file.id);
    expect(mem().objects.has(doc!.objectKey)).toBe(true);
    const res = await fileDelete(req("DELETE", `/api/v1/files/${file.id}`, { headers: bearer }), ctx({ id: file.id }));
    expect(res.status).toBe(200);
    expect(mem().objects.size).toBe(0);
    expect(await FileModel.countDocuments({})).toBe(0);
    expect((await UploadBatch.findOne({ batchId }))!.totalFiles).toBe(0);
    const again = await fileDelete(req("DELETE", `/api/v1/files/${file.id}`, { headers: bearer }), ctx({ id: file.id }));
    expect(again.status).toBe(404);
  });

  it("keeps the record when storage deletion fails so the user can retry", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    mem().failNext.delete = new Error("R2 down");
    await expect(deleteFile(scope, file.id)).rejects.toMatchObject({ status: 502 });
    expect(await FileModel.countDocuments({})).toBe(1);
    await expect(deleteFile(scope, file.id)).resolves.toBeTruthy();
  });

  it("bulk-deletes only the caller's files and reports the rest", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com", "Bob");
    const a1 = (await uploadOne(alice.scope, "a1.pdf", 101)).file;
    const a2 = (await uploadOne(alice.scope, "a2.pdf", 102)).file;
    const b1 = (await uploadOne(bob.scope, "b1.pdf", 103)).file;
    const res = await bulkDeleteRoute(req("POST", "/api/v1/files/bulk-delete", { headers: alice.bearer, body: { ids: [a1.id, a2.id, b1.id] } }));
    const { data } = await res.json();
    expect(data.deleted.sort()).toEqual([a1.id, a2.id].sort());
    expect(data.notFound).toEqual([b1.id]);
    expect(await FileModel.countDocuments({ userId: bob.userId })).toBe(1);
    expect(mem().objects.size).toBe(1);
  });

  it("reports partial failures in a bulk delete", async () => {
    const { scope } = await createUser();
    const a = (await uploadOne(scope, "a.pdf", 101)).file;
    const b = (await uploadOne(scope, "b.pdf", 102)).file;
    mem().failNext.delete = new Error("flaky");
    const out = await bulkDeleteFiles(scope, [a.id, b.id]);
    expect(out.deleted).toHaveLength(1);
    expect(out.failed).toHaveLength(1);
    expect(await FileModel.countDocuments({})).toBe(1);
  });

  it("creates short-lived download URLs for the owner", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    const dl = await getDownloadUrl(scope, file.id);
    expect(dl.url).toContain("d=attachment");
    expect(dl.expiresInSec).toBeLessThanOrEqual(300);
  });
});

describe("links: revoke, restore, verify, copy", () => {
  it("revoking kills the public object but keeps the file for the owner; restoring brings back the same URL", async () => {
    const { scope, bearer } = await createUser();
    const { file } = await uploadOne(scope);
    const doc0 = await FileModel.findById(file.id);

    const res = await revokeRoute(req("POST", `/api/v1/links/${file.id}/revoke`, { headers: bearer }), ctx({ id: file.id }));
    const { data } = await res.json();
    expect(data.file).toMatchObject({ isPublic: false, publicUrl: "", storageLocation: "private (revoked)" });
    expect(mem().objects.has(doc0!.objectKey)).toBe(false); // public URL now 404s
    expect(mem().objects.size).toBe(1); // content still stored privately
    expect((await listLinks(scope, q)).items).toHaveLength(0);
    expect((await getDownloadUrl(scope, file.id)).url).toBeTruthy(); // owner can still download

    const restored = await restoreLink(scope, file.id);
    expect(restored.publicUrl).toBe(file.publicUrl);
    expect(mem().objects.has(doc0!.objectKey)).toBe(true);
    expect(mem().objects.size).toBe(1);
    expect((await listLinks(scope, q)).items).toHaveLength(1);
  });

  it("revoke is idempotent and failure-safe", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    mem().failNext.delete = new Error("flaky");
    await expect(revokeLink(scope, file.id)).rejects.toMatchObject({ status: 502 });
    expect((await getFile(scope, file.id)).isPublic).toBe(true); // still consistently public
    await revokeLink(scope, file.id);
    await expect(revokeLink(scope, file.id)).resolves.toMatchObject({ isPublic: false });
  });

  it("copies selected or all active links only", async () => {
    const { scope } = await createUser();
    const a = (await uploadOne(scope, "a.pdf", 101)).file;
    const b = (await uploadOne(scope, "b.pdf", 102)).file;
    await revokeLink(scope, b.id);
    const all = await bulkCopyData(scope, { all: true });
    expect(all.links.map((l) => l.url)).toEqual([a.publicUrl]);
    expect(all.text).toBe(a.publicUrl);
    expect((await bulkCopyData(scope, { ids: [b.id] })).count).toBe(0);
  });

  it("verifies that the public URL serves a PDF and records the result", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    const fetchMock = vi.fn<(url: string | URL) => Promise<Response>>(async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await verifyLink(scope, file.id);
    expect(ok).toMatchObject({ ok: true, status: 200 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(file.publicUrl);
    expect((await getFile(scope, file.id)).lastVerifyOk).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await verifyLink(scope, file.id)).toMatchObject({ ok: false, status: 404 });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    expect(await verifyLink(scope, file.id)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("refuses to verify revoked files and files owned by others", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com", "Bob");
    const { file } = await uploadOne(alice.scope);
    await expect(verifyLink(bob.scope, file.id)).rejects.toMatchObject({ status: 404 });
    await revokeLink(alice.scope, file.id);
    await expect(verifyLink(alice.scope, file.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("batches and dashboard stats", () => {
  it("lists upload history and reopens a batch with its files", async () => {
    const { scope } = await createUser();
    const first = await uploadOne(scope, "a.pdf", 101);
    await uploadOne(scope, "b.pdf", 102, first.batchId);
    await uploadOne(scope, "c.pdf", 103);
    const list = await listBatches(scope, { page: 1, pageSize: 10 });
    expect(list.items).toHaveLength(2);
    expect(list.items.find((b) => b.batchId === first.batchId)).toMatchObject({ totalFiles: 2, successfulFiles: 2, status: "completed", totalSize: 203 });
    const detail = await getBatch(scope, first.batchId);
    expect(detail.files.map((f) => f.displayName)).toEqual(["a.pdf", "b.pdf"]);
    const other = await createUser("o@example.com", "O");
    await expect(getBatch(other.scope, first.batchId)).rejects.toMatchObject({ status: 404 });
  });

  it("computes dashboard numbers from the database", async () => {
    const { scope } = await createUser();
    await uploadOne(scope, "a.pdf", 1000);
    const { file } = await uploadOne(scope, "b.pdf", 2000);
    await initiateUploads(scope, { files: [{ name: "pend.pdf", size: 5, type: "application/pdf" }], allowDuplicates: false });
    const bad = await initiateUploads(scope, { files: [{ name: "bad.pdf", size: 9, type: "application/pdf" }], allowDuplicates: false });
    await FileModel.updateOne({ batchId: bad.batchId }, { $set: { uploadStatus: "failed" } });
    await revokeLink(scope, file.id);

    const s = await getOverview(scope, 7);
    expect(s.totals).toMatchObject({ totalPdfs: 2, storageUsedBytes: 3000, activeLinks: 1, successfulUploads: 2, failedUploads: 1, inProgress: 1 });
    expect(s.recentUploads).toHaveLength(2);
    expect(s.storageSeries).toHaveLength(7);
    expect(s.storageSeries.at(-1)!.bytes).toBe(3000);
    expect(s.activitySeries.at(-1)).toMatchObject({ uploads: 2 });

    const other = await createUser("o@example.com", "O");
    expect((await getOverview(other.scope, 7)).totals.totalPdfs).toBe(0);
  });
});
