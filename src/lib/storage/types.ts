export interface ObjectHead {
  size: number;
  etag: string;
  contentType?: string;
}

export interface ObjectHeaders {
  contentType: string;
  contentDisposition: string;
  cacheControl: string;
}

export interface PresignedPut {
  url: string;
  /**
   * Headers the browser should send with the PUT. Only some are covered by the signature
   * (the AWS presigner signs Content-Disposition but NOT Content-Type / Cache-Control), so
   * never rely on them: published objects are re-written with server-chosen headers.
   */
  headers: Record<string, string>;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/**
 * Storage abstraction. Business logic only talks to this interface, so the R2
 * implementation, the in-memory test double – or another S3 provider – are swappable.
 */
export interface StorageDriver {
  presignPut(key: string, headers: ObjectHeaders, expiresInSec: number): Promise<PresignedPut>;
  createMultipart(key: string, headers: ObjectHeaders): Promise<{ uploadId: string }>;
  presignPart(key: string, uploadId: string, partNumber: number, expiresInSec: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
  /** Reads bytes [start, end] inclusive. Never loads the whole object. */
  readRange(key: string, start: number, end: number): Promise<Uint8Array>;
  /**
   * Server-side copy. When `headers` is given the destination gets exactly those headers
   * (metadata REPLACE) instead of inheriting whatever the uploader sent.
   */
  copy(sourceKey: string, destKey: string, headers?: ObjectHeaders): Promise<void>;
  delete(key: string): Promise<void>;
  presignGet(key: string, opts: { filename: string; disposition: "inline" | "attachment"; expiresInSec: number }): Promise<string>;
}
