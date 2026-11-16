import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Env } from "@/lib/env";
import { buildContentDisposition } from "./keys";
import type { StorageDriver } from "./types";

/**
 * S3 API driver. Works with Cloudflare R2 (default) and any S3-compatible store such as
 * MinIO – set STORAGE_ENDPOINT (+ STORAGE_PUBLIC_ENDPOINT when browsers reach it under a
 * different hostname than the server does, e.g. inside Docker).
 */
export function createS3Driver(): StorageDriver {
  const env = getR2Env();
  const Bucket = env.R2_BUCKET_NAME;
  const custom = !!env.STORAGE_ENDPOINT;
  const endpoint = custom
    ? env.STORAGE_ENDPOINT
    : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const publicEndpoint = env.STORAGE_PUBLIC_ENDPOINT || endpoint;
  const base = {
    region: env.STORAGE_REGION || (custom ? "us-east-1" : "auto"),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE
      ? env.STORAGE_FORCE_PATH_STYLE === "true"
      : custom,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // Presigned requests must not carry the SDK's default CRC32 flexible checksums.
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
    responseChecksumValidation: "WHEN_REQUIRED" as const,
  };
  // Server-side calls (HEAD, copy, delete ...) use the internal endpoint...
  const client = new S3Client({ ...base, endpoint });
  // ...while presigned URLs are signed for the host the BROWSER will call.
  const signer = publicEndpoint === endpoint ? client : new S3Client({ ...base, endpoint: publicEndpoint });

  const isNotFound = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err?.name === "NotFound" || err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
  };

  return {
    async presignPut(key, h, expiresIn) {
      const cmd = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: h.contentType,
        ContentDisposition: h.contentDisposition,
        CacheControl: h.cacheControl,
      });
      const url = await getSignedUrl(signer, cmd, { expiresIn });
      return {
        url,
        headers: {
          "Content-Type": h.contentType,
          "Content-Disposition": h.contentDisposition,
          "Cache-Control": h.cacheControl,
        },
      };
    },

    async createMultipart(key, h) {
      const out = await client.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key: key,
          ContentType: h.contentType,
          ContentDisposition: h.contentDisposition,
          CacheControl: h.cacheControl,
        }),
      );
      if (!out.UploadId) throw new Error("Storage did not return an upload id");
      return { uploadId: out.UploadId };
    },

    presignPart(key, uploadId, partNumber, expiresIn) {
      return getSignedUrl(
        signer,
        new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn },
      );
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },

    async abortMultipart(key, uploadId) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      } catch (e) {
        if (!isNotFound(e) && (e as { name?: string })?.name !== "NoSuchUpload") throw e;
      }
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: Number(out.ContentLength ?? 0),
          etag: (out.ETag ?? "").replace(/"/g, ""),
          contentType: out.ContentType,
        };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async readRange(key, start, end) {
      const out = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      if (!out.Body) return new Uint8Array();
      return out.Body.transformToByteArray();
    },

    async copy(sourceKey, destKey, headers) {
      await client.send(
        new CopyObjectCommand({
          Bucket,
          Key: destKey,
          CopySource: `${Bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
          ...(headers
            ? {
                MetadataDirective: "REPLACE" as const,
                ContentType: headers.contentType,
                ContentDisposition: headers.contentDisposition,
                CacheControl: headers.cacheControl,
              }
            : { MetadataDirective: "COPY" as const }),
        }),
      );
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    presignGet(key, { filename, disposition, expiresInSec }) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: "application/pdf",
          ResponseContentDisposition: buildContentDisposition(disposition, filename),
        }),
        { expiresIn: expiresInSec },
      );
    },
  };
}
