import { describe, expect, it } from "vitest";
import { browserUpload, createUser, ctx, mem, pdfBytes, pdfMeta, req, uploadOne } from "./helpers";
import { cancelUpload, cleanupAbandonedUploads, completeUpload, getUploadStatus, initiateUploads, refreshUpload } from "@/services/upload.service";
import { FileModel } from "@/models/File";
import { UploadBatch } from "@/models/UploadBatch";
import { POST as initiateRoute } from "@/app/api/v1/uploads/initiate/route";
import { POST as completeRoute } from "@/app/api/v1/uploads/complete/route";
import { GET as statusRoute } from "@/app/api/v1/uploads/[id]/status/route";
import { POST as cleanupRoute } from "@/app/api/v1/uploads/cleanup/route";
import { User } from "@/models/User";

const MB = 1024 * 1024;

describe("upload initiation", () => {
  it("issues a single presigned PUT for small files, with signed headers and a pending record", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("a.pdf", 1000)], allowDuplicates: false });
    expect(out.batchId).toMatch(/^bch_/);
    const r = out.results[0];
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.upload.mode).toBe("single");
    expect(r.upload.single!.headers["Content-Type"]).toBe("application/pdf");
    expect(r.upload.single!.headers["Content-Disposition"]).toMatch(/^inline; filename="a.pdf"/);
    expect(new Date(r.upload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const doc = await FileModel.findById(r.file.id);
    expect(doc?.uploadStatus).toBe("pending");
    expect(doc?.publicUrl).toBe(""); // no public URL before verification
    expect(doc?.objectKey).toMatch(/^pdfs\/\d{4}\/[0-9a-f-]{36}\.pdf$/);
    expect(doc?.stagingKey).toMatch(/^staging\//);
    expect(r.file.publicUrl).toBe("");
  });

  it("uses multipart for large files with one URL per part", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("big.pdf", 12 * MB)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error("expected ready");
    expect(r.upload.mode).toBe("multipart");
    expect(r.upload.multipart!.partSize).toBe(5 * MB);
    expect(r.upload.multipart!.parts).toHaveLength(3);
    expect(mem().uploads.size).toBe(1);
  });

  it("rejects invalid files individually without blocking valid ones", async () => {
    const { userId, scope } = await createUser();
    const out = await initiateUploads(scope, {
      files: [
        pdfMeta("good.pdf"),
        { name: "evil.exe", size: 100, type: "application/pdf" },
        { name: "wrong-mime.pdf", size: 100, type: "text/plain" },
        pdfMeta("huge.pdf", 51 * MB),
        pdfMeta("also-good.pdf"),
      ],
      allowDuplicates: false,
    });
    expect(out.results.map((r) => r.status)).toEqual(["ready", "rejected", "rejected", "rejected", "ready"]);
    expect(await FileModel.countDocuments({ userId })).toBe(2);
  });

  it("flags duplicates (already uploaded or repeated in the request) unless allowed", async () => {
    const { scope } = await createUser();
    await uploadOne(scope, "same.pdf", 1500);
    const out = await initiateUploads(scope, {
      files: [pdfMeta("same.pdf", 1500), pdfMeta("new.pdf", 10), pdfMeta("new.pdf", 10)],
      allowDuplicates: false,
    });
    expect(out.results.map((r) => (r.status === "rejected" ? r.code : "ok"))).toEqual(["DUPLICATE", "ok", "DUPLICATE"]);
    const forced = await initiateUploads(scope, { files: [pdfMeta("same.pdf", 1500)], allowDuplicates: true });
    expect(forced.results[0].status).toBe("ready");
  });

  it("enforces the files-per-batch limit across calls", async () => {
    const { scope } = await createUser();
    const first = await initiateUploads(scope, {
      files: Array.from({ length: 8 }, (_, i) => pdfMeta(`f${i}.pdf`, 10 + i)),
      allowDuplicates: false,
    });
    await expect(
      initiateUploads(scope, { batchId: first.batchId, files: [pdfMeta("x1.pdf", 1), pdfMeta("x2.pdf", 2), pdfMeta("x3.pdf", 3)], allowDuplicates: false }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("honours user-level limits that are lower than the server limits, never higher", async () => {
    const { userId, scope } = await createUser();
    await User.updateOne({ _id: userId }, { $set: { "settings.maxFileSizeMb": 1 } });
    const out = await initiateUploads(scope, { files: [pdfMeta("2mb.pdf", 2 * MB)], allowDuplicates: false });
    expect(out.results[0]).toMatchObject({ status: "rejected", code: "INVALID" });
  });

  it("reports a storage failure for one file without failing the request", async () => {
    const { scope } = await createUser();
    mem().failNext.presignPut = new Error("R2 down");
    const out = await initiateUploads(scope, { files: [pdfMeta("a.pdf", 11), pdfMeta("b.pdf", 22)], allowDuplicates: false });
    expect(out.results[0]).toMatchObject({ status: "rejected", code: "STORAGE_ERROR" });
    expect(out.results[1].status).toBe("ready");
  });

  it("is reachable over the versioned API and validates the body with Zod", async () => {
    const { bearer } = await createUser();
    const ok = await initiateRoute(req("POST", "/api/v1/uploads/initiate", { headers: bearer, body: { files: [pdfMeta("a.pdf")] } }));
    expect(ok.status).toBe(201);
    const bad = await initiateRoute(req("POST", "/api/v1/uploads/initiate", { headers: bearer, body: { files: [] } }));
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });
});

describe("upload completion", () => {
  it("verifies, publishes to the public key on the custom domain, and updates the batch", async () => {
    const { scope } = await createUser();
    const { file, batchId } = await uploadOne(scope, "report.pdf", 3000);
    expect(file.uploadStatus).toBe("completed");
    expect(file.isPublic).toBe(true);
    expect(file.publicUrl).toMatch(/^https:\/\/files\.example\.test\/pdfs\/\d{4}\/[0-9a-f-]{36}\.pdf$/);
    expect(file.publicUrl).not.toContain("report"); // never derived from the filename
    expect(file.displayName).toBe("report.pdf");

    const doc = await FileModel.findById(file.id);
    expect(mem().objects.has(doc!.objectKey)).toBe(true); // published
    expect(mem().objects.size).toBe(1); // staging object removed
    expect(doc!.checksum).toBeTruthy();
    expect(doc!.uploadedAt).toBeInstanceOf(Date);

    const batch = await UploadBatch.findOne({ batchId });
    expect(batch).toMatchObject({ totalFiles: 1, successfulFiles: 1, failedFiles: 0, status: "completed", totalSize: 3000 });
    expect(batch!.completedAt).toBeInstanceOf(Date);
  });

  it("is idempotent", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    const again = await completeUpload(scope, { fileId: file.id });
    expect(again.publicUrl).toBe(file.publicUrl);
  });

  it("fails when the object was never uploaded, but allows retrying", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("a.pdf", 500)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await expect(completeUpload(scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 400 });
    expect((await getUploadStatus(scope, r.file.id)).status).toBe("uploading");
    await browserUpload(r, pdfBytes(500));
    await expect(completeUpload(scope, { fileId: r.file.id })).resolves.toMatchObject({ uploadStatus: "completed" });
  });

  it("rejects and deletes uploads whose size differs from the declared size", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("a.pdf", 500)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await browserUpload(r, pdfBytes(900));
    await expect(completeUpload(scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 400 });
    const doc = await FileModel.findById(r.file.id);
    expect(doc?.uploadStatus).toBe("failed");
    expect(mem().objects.size).toBe(0);
  });

  it("never trusts upload headers: a hostile Content-Type does not survive publishing", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("evil.pdf", 600)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    const doc = await FileModel.findById(r.file.id);
    // the browser (or an attacker with the presigned URL) uploads valid PDF bytes labelled text/html
    mem().putObject(doc!.stagingKey!, pdfBytes(600), "text/html");
    const done = await completeUpload(scope, { fileId: r.file.id });
    expect(done.uploadStatus).toBe("completed");
    expect(mem().objects.get(doc!.objectKey)!.contentType).toBe("application/pdf");
  });

  it("rejects files that are not PDFs by signature even with a .pdf name and PDF MIME", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("fake.pdf", 400)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await browserUpload(r, pdfBytes(400, "MZ\x90\x00 not a pdf"));
    await expect(completeUpload(scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/valid PDF/) });
    const doc = await FileModel.findById(r.file.id);
    expect(doc?.uploadStatus).toBe("failed");
    expect(doc?.publicUrl).toBe("");
    expect(mem().objects.size).toBe(0);
  });

  it("assembles large multipart uploads and verifies the result", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope, "large.pdf", 13 * MB);
    expect(file.uploadStatus).toBe("completed");
    const doc = await FileModel.findById(file.id);
    expect(mem().objects.get(doc!.objectKey)!.data.length).toBe(13 * MB);
    expect(mem().uploads.size).toBe(0);
  });

  it("requires every part for multipart completion and lets the client retry", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("large.pdf", 11 * MB)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    const parts = (await browserUpload(r, pdfBytes(11 * MB)))!;
    await expect(completeUpload(scope, { fileId: r.file.id, parts: parts.slice(0, 1) })).rejects.toMatchObject({ status: 400 });
    await expect(completeUpload(scope, { fileId: r.file.id, parts })).resolves.toMatchObject({ uploadStatus: "completed" });
  });

  it("surfaces storage errors as retryable 502s without losing the upload", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("a.pdf", 500)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await browserUpload(r, pdfBytes(500));
    mem().failNext.copy = new Error("R2 unavailable");
    await expect(completeUpload(scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 502 });
    await expect(completeUpload(scope, { fileId: r.file.id })).resolves.toMatchObject({ uploadStatus: "completed" });
  });

  it("publishes privately when the user's default link behaviour is private", async () => {
    const { userId, scope } = await createUser();
    await User.updateOne({ _id: userId }, { $set: { "settings.defaultPublic": false } });
    const { file } = await uploadOne(scope);
    expect(file).toMatchObject({ isPublic: false, publicUrl: "" });
    const doc = await FileModel.findById(file.id);
    expect(mem().objects.has(doc!.objectKey)).toBe(false); // nothing on the public key
    expect(mem().objects.has(doc!.revokedKey!)).toBe(true);
  });

  it("handles a partially failed batch: good files complete, the bad one is reported", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, {
      files: [pdfMeta("one.pdf", 100), pdfMeta("two.pdf", 200), pdfMeta("three.pdf", 300)],
      allowDuplicates: false,
    });
    const ready = out.results.filter((r) => r.status === "ready");
    await browserUpload(ready[0] as never, pdfBytes(100));
    await browserUpload(ready[1] as never, pdfBytes(200, "not a pdf at all"));
    // third file never finishes uploading
    await completeUpload(scope, { fileId: (ready[0] as never as { file: { id: string } }).file.id });
    await expect(completeUpload(scope, { fileId: (ready[1] as never as { file: { id: string } }).file.id })).rejects.toBeTruthy();
    const mid = await UploadBatch.findOne({ batchId: out.batchId });
    expect(mid).toMatchObject({ totalFiles: 3, successfulFiles: 1, failedFiles: 1, status: "uploading" });

    await cancelUpload(scope, (ready[2] as never as { file: { id: string } }).file.id);
    const done = await UploadBatch.findOne({ batchId: out.batchId });
    expect(done).toMatchObject({ successfulFiles: 1, failedFiles: 2, status: "partial" });
    expect(done!.completedAt).toBeInstanceOf(Date);
  });
});

describe("cancel, resume and cleanup", () => {
  it("cancelling aborts the multipart upload and removes staged data", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("big.pdf", 12 * MB)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await browserUpload(r, pdfBytes(12 * MB));
    const res = await cancelUpload(scope, r.file.id);
    expect(res.uploadStatus).toBe("cancelled");
    expect(mem().uploads.size).toBe(0);
    await expect(completeUpload(scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 409 });
  });

  it("cannot cancel a completed upload", async () => {
    const { scope } = await createUser();
    const { file } = await uploadOne(scope);
    await expect(cancelUpload(scope, file.id)).rejects.toMatchObject({ status: 409 });
  });

  it("re-issues presigned URLs for an unfinished upload (expired URL / resume)", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("big.pdf", 12 * MB)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    const fresh = await refreshUpload(scope, r.file.id);
    expect(fresh.multipart!.uploadId).toBe(r.upload.multipart!.uploadId);
    expect(fresh.multipart!.parts).toHaveLength(3);
  });

  it("cleanup aborts abandoned multipart uploads and marks them failed", async () => {
    const { scope } = await createUser();
    const out = await initiateUploads(scope, { files: [pdfMeta("big.pdf", 12 * MB), pdfMeta("s.pdf", 10)], allowDuplicates: false });
    await FileModel.updateMany({}, { $set: { updatedAt: new Date(Date.now() - 48 * 3600 * 1000) } }, { timestamps: false });
    const res = await cleanupAbandonedUploads(24);
    expect(res.cleaned).toBe(2);
    expect(mem().uploads.size).toBe(0);
    expect(await FileModel.countDocuments({ uploadStatus: "failed" })).toBe(2);
    expect((await UploadBatch.findOne({ batchId: out.batchId }))!.status).toBe("failed");
  });

  it("cleanup endpoint requires the cron secret", async () => {
    expect((await cleanupRoute(req("POST", "/api/v1/uploads/cleanup"))).status).toBe(401);
    expect((await cleanupRoute(req("POST", "/api/v1/uploads/cleanup", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const ok = await cleanupRoute(req("POST", "/api/v1/uploads/cleanup", { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(ok.status).toBe(200);
  });
});

describe("ownership isolation", () => {
  it("never lets another user complete, cancel, refresh or inspect an upload", async () => {
    const alice = await createUser("alice@example.com");
    const mallory = await createUser("mallory@example.com", "Mallory");
    const out = await initiateUploads(alice.scope, { files: [pdfMeta("a.pdf", 100)], allowDuplicates: false });
    const r = out.results[0];
    if (r.status !== "ready") throw new Error();
    await browserUpload(r, pdfBytes(100));

    await expect(completeUpload(mallory.scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 404 });
    await expect(cancelUpload(mallory.scope, r.file.id)).rejects.toMatchObject({ status: 404 });
    await expect(refreshUpload(mallory.scope, r.file.id)).rejects.toMatchObject({ status: 404 });
    const viaApi = await statusRoute(req("GET", `/api/v1/uploads/${r.file.id}/status`, { headers: mallory.bearer }), ctx({ id: r.file.id }));
    expect(viaApi.status).toBe(404);
    const completeApi = await completeRoute(req("POST", "/api/v1/uploads/complete", { headers: mallory.bearer, body: { fileId: r.file.id } }));
    expect(completeApi.status).toBe(404);
    // and Mallory cannot add files to Alice's batch
    await expect(
      initiateUploads(mallory.scope, { batchId: out.batchId, files: [pdfMeta("m.pdf", 10)], allowDuplicates: false }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
