import { randomUUID, createHash } from "node:crypto";
import type { CompletedPart, ObjectHeaders, StorageDriver } from "./types";

interface StoredObject {
  data: Uint8Array;
  etag: string;
  contentType?: string;
}

/**
 * In-memory StorageDriver used by the test-suite (and handy for local experiments).
 * `putObject` / `putPart` simulate the browser PUT-ing to a presigned URL.
 */
export class MemoryStorage implements StorageDriver {
  objects = new Map<string, StoredObject>();
  uploads = new Map<string, { key: string; headers: ObjectHeaders; parts: Map<number, Uint8Array> }>();
  failNext: Partial<Record<keyof StorageDriver, Error>> = {};

  private maybeFail(op: keyof StorageDriver) {
    const err = this.failNext[op];
    if (err) {
      delete this.failNext[op];
      throw err;
    }
  }

  // --- helpers that simulate the browser side -------------------------------
  putObject(key: string, data: Uint8Array, contentType = "application/pdf") {
    this.objects.set(key, { data, etag: md5(data), contentType });
  }

  putPart(uploadId: string, partNumber: number, data: Uint8Array): string {
    const u = this.uploads.get(uploadId);
    if (!u) throw new Error("NoSuchUpload");
    u.parts.set(partNumber, data);
    return md5(data);
  }

  // --- StorageDriver ----------------------------------------------------------
  async presignPut(key: string, headers: ObjectHeaders, expiresInSec: number) {
    this.maybeFail("presignPut");
    return {
      url: `https://mem.test/put/${encodeURIComponent(key)}?exp=${expiresInSec}`,
      headers: {
        "Content-Type": headers.contentType,
        "Content-Disposition": headers.contentDisposition,
        "Cache-Control": headers.cacheControl,
      },
    };
  }

  async createMultipart(key: string, headers: ObjectHeaders) {
    this.maybeFail("createMultipart");
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { key, headers, parts: new Map() });
    return { uploadId };
  }

  async presignPart(key: string, uploadId: string, partNumber: number) {
    return `https://mem.test/part/${uploadId}/${partNumber}`;
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]) {
    this.maybeFail("completeMultipart");
    const u = this.uploads.get(uploadId);
    if (!u) throw new Error("NoSuchUpload");
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const chunks: Uint8Array[] = [];
    for (const p of ordered) {
      const data = u.parts.get(p.partNumber);
      if (!data || md5(data) !== p.etag) throw new Error(`InvalidPart ${p.partNumber}`);
      chunks.push(data);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.objects.set(key, {
      data: out,
      etag: `${md5(out)}-${ordered.length}`,
      contentType: u.headers.contentType,
    });
    this.uploads.delete(uploadId);
  }

  async abortMultipart(_key: string, uploadId: string) {
    this.maybeFail("abortMultipart");
    this.uploads.delete(uploadId);
  }

  async head(key: string) {
    this.maybeFail("head");
    const o = this.objects.get(key);
    return o ? { size: o.data.length, etag: o.etag, contentType: o.contentType } : null;
  }

  async readRange(key: string, start: number, end: number) {
    const o = this.objects.get(key);
    if (!o) throw new Error("NoSuchKey");
    return o.data.slice(start, end + 1);
  }

  async copy(sourceKey: string, destKey: string, headers?: ObjectHeaders) {
    this.maybeFail("copy");
    const o = this.objects.get(sourceKey);
    if (!o) throw new Error("NoSuchKey");
    this.objects.set(destKey, { ...o, ...(headers ? { contentType: headers.contentType } : {}) });
  }

  async delete(key: string) {
    this.maybeFail("delete");
    this.objects.delete(key);
  }

  async presignGet(key: string, opts: { filename: string; disposition: string }) {
    return `https://mem.test/get/${encodeURIComponent(key)}?d=${opts.disposition}`;
  }
}

function md5(data: Uint8Array) {
  return createHash("md5").update(data).digest("hex");
}
