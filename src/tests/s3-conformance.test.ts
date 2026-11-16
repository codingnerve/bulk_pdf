/**
 * Conformance test for the S3 storage driver against a REAL S3-compatible server
 * (SeaweedFS, Garage, Backblaze B2, AWS S3, Cloudflare R2 ...). It exercises exactly the
 * calls PDFLinker makes: presigned PUT, multipart with presigned parts,
 * HEAD, ranged GET, server-side copy, delete, and presigned GET with a download disposition.
 *
 * Skipped unless S3_TEST_ENDPOINT is set. Usage (PowerShell / bash):
 *
 *   S3_TEST_ENDPOINT=http://127.0.0.1:8333 S3_TEST_BUCKET=pdflinker-test \
 *   S3_TEST_ACCESS_KEY=... S3_TEST_SECRET_KEY=... npm run test:s3
 *
 * The bucket must already exist. Test objects are created under `conformance-<random>/` and
 * removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resetEnvCache } from "@/lib/env";
import { createS3Driver } from "@/lib/storage/s3";
import { buildContentDisposition } from "@/lib/storage/keys";
import type { StorageDriver } from "@/lib/storage/types";

const endpoint = process.env.S3_TEST_ENDPOINT;
const MB = 1024 * 1024;

function pdf(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode("%PDF-1.7\n"));
  for (let i = 9; i < size; i++) b[i] = 32 + (i % 90);
  return b;
}

describe.skipIf(!endpoint)("S3 driver conformance (real server)", () => {
  let s3: StorageDriver;
  const prefix = `conformance-${randomUUID().slice(0, 8)}`;
  const created: string[] = [];
  const headers = {
    contentType: "application/pdf",
    contentDisposition: buildContentDisposition("inline", "résumé test.pdf"),
    cacheControl: "public, max-age=300",
  };

  beforeAll(() => {
    Object.assign(process.env, {
      STORAGE_ENDPOINT: endpoint,
      STORAGE_PUBLIC_ENDPOINT: process.env.S3_TEST_PUBLIC_ENDPOINT ?? "",
      R2_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY,
      R2_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_KEY,
      R2_BUCKET_NAME: process.env.S3_TEST_BUCKET ?? "pdflinker-test",
      R2_PUBLIC_DOMAIN: "files.example.test",
    });
    resetEnvCache();
    s3 = createS3Driver();
  });

  afterAll(async () => {
    for (const k of created) await s3.delete(k).catch(() => {});
    resetEnvCache();
  });

  it("presigned PUT with signed headers → HEAD → ranged read", async () => {
    const key = `${prefix}/single.pdf`;
    created.push(key);
    const body = pdf(50_000);
    const { url, headers: h } = await s3.presignPut(key, headers, 300);
    const res = await fetch(url, { method: "PUT", headers: h, body: Buffer.from(body) });
    expect(res.status, await res.clone().text()).toBeLessThan(300);

    const head = await s3.head(key);
    expect(head).toMatchObject({ size: 50_000 });
    expect(head!.contentType).toBe("application/pdf");

    const first = await s3.readRange(key, 0, 1023);
    expect(first.length).toBe(1024);
    expect(new TextDecoder().decode(first.slice(0, 5))).toBe("%PDF-");
    expect(await s3.head(`${prefix}/missing.pdf`)).toBeNull();
  });

  it("a changed Content-Disposition (signed) is rejected, a missing signature header too", async () => {
    const key = `${prefix}/tampered.pdf`;
    created.push(key);
    const { url, headers: h } = await s3.presignPut(key, headers, 300);
    const changed = await fetch(url, { method: "PUT", headers: { ...h, "Content-Disposition": "attachment; filename=\"x.pdf\"" }, body: Buffer.from(pdf(100)) });
    expect(changed.status).toBeGreaterThanOrEqual(400);
    const missing = await fetch(url, { method: "PUT", body: Buffer.from(pdf(100)) });
    expect(missing.status).toBeGreaterThanOrEqual(400);
  });

  it("Content-Type is NOT signed, so publishing must overwrite it (copy with REPLACE)", async () => {
    const src = `${prefix}/hostile-src.pdf`;
    const dst = `${prefix}/hostile-dst.pdf`;
    created.push(src, dst);
    const { url, headers: h } = await s3.presignPut(src, headers, 300);
    // An uploader is free to label the bytes however they like...
    const res = await fetch(url, { method: "PUT", headers: { ...h, "Content-Type": "text/html", "Cache-Control": "public, max-age=999999" }, body: Buffer.from(pdf(1024)) });
    expect(res.status).toBeLessThan(300);
    expect((await s3.head(src))!.contentType).toBe("text/html");
    // ...so the publish step re-writes the metadata server-side.
    await s3.copy(src, dst, headers);
    expect((await s3.head(dst))!.contentType).toBe("application/pdf");
  });

  it("multipart: create → presigned parts → complete", async () => {
    const key = `${prefix}/multi.pdf`;
    created.push(key);
    const total = 11 * MB;
    const body = pdf(total);
    const partSize = 5 * MB;
    const { uploadId } = await s3.createMultipart(key, headers);
    const parts: { partNumber: number; etag: string }[] = [];
    for (let n = 1; n <= Math.ceil(total / partSize); n++) {
      const url = await s3.presignPart(key, uploadId, n, 300);
      const slice = body.slice((n - 1) * partSize, n * partSize);
      const res = await fetch(url, { method: "PUT", body: Buffer.from(slice) });
      expect(res.status).toBeLessThan(300);
      const etag = res.headers.get("etag");
      expect(etag, "part response must include an ETag").toBeTruthy();
      parts.push({ partNumber: n, etag: etag!.replace(/"/g, "") });
    }
    await s3.completeMultipart(key, uploadId, parts);
    expect((await s3.head(key))!.size).toBe(total);
    expect(new TextDecoder().decode(await s3.readRange(key, 0, 4))).toBe("%PDF-");
  });

  it("multipart abort leaves no object behind", async () => {
    const key = `${prefix}/aborted.pdf`;
    const { uploadId } = await s3.createMultipart(key, headers);
    const url = await s3.presignPart(key, uploadId, 1, 300);
    await fetch(url, { method: "PUT", body: Buffer.from(pdf(5 * MB)) });
    await s3.abortMultipart(key, uploadId);
    await s3.abortMultipart(key, uploadId); // idempotent
    expect(await s3.head(key)).toBeNull();
  });

  it("server-side copy preserves content and metadata; delete removes it", async () => {
    const src = `${prefix}/copy-src.pdf`;
    const dst = `${prefix}/copy-dst.pdf`;
    created.push(src, dst);
    const { url, headers: h } = await s3.presignPut(src, headers, 300);
    await fetch(url, { method: "PUT", headers: h, body: Buffer.from(pdf(4096)) });
    await s3.copy(src, dst);
    const head = await s3.head(dst);
    expect(head).toMatchObject({ size: 4096, contentType: "application/pdf" });
    await s3.delete(src);
    expect(await s3.head(src)).toBeNull();
    await s3.delete(src); // deleting a missing key is not an error
    expect(await s3.head(dst)).not.toBeNull();
  });

  it("presigned GET forces a download with the requested filename", async () => {
    const key = `${prefix}/download.pdf`;
    created.push(key);
    const { url, headers: h } = await s3.presignPut(key, headers, 300);
    await fetch(url, { method: "PUT", headers: h, body: Buffer.from(pdf(2048)) });
    const get = await s3.presignGet(key, { filename: "Quarterly report.pdf", disposition: "attachment", expiresInSec: 300 });
    const res = await fetch(get);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });
});
