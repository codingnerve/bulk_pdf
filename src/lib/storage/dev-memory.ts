import { MemoryStorage } from "./memory";
import { getEnv } from "@/lib/env";
import type { ObjectHeaders } from "./types";

/**
 * Local-development storage: bytes live in server memory and the "presigned URLs" point at
 * /api/dev-storage/* routes of this app. Lets you try the whole upload flow without R2.
 * Never available in production (see getStorage + the dev-storage routes).
 */
export class DevMemoryStorage extends MemoryStorage {
  private base() {
    return getEnv().APP_URL.replace(/\/$/, "");
  }

  async presignPut(key: string, headers: ObjectHeaders) {
    return {
      url: `${this.base()}/api/dev-storage/put?key=${encodeURIComponent(key)}`,
      headers: {
        "Content-Type": headers.contentType,
        "Content-Disposition": headers.contentDisposition,
        "Cache-Control": headers.cacheControl,
      },
    };
  }

  async presignPart(_key: string, uploadId: string, partNumber: number) {
    return `${this.base()}/api/dev-storage/part?uploadId=${encodeURIComponent(uploadId)}&n=${partNumber}`;
  }

  async presignGet(key: string, opts: { filename: string; disposition: string }) {
    return `${this.base()}/api/dev-storage/public/${key.split("/").map(encodeURIComponent).join("/")}?d=${opts.disposition}&name=${encodeURIComponent(opts.filename)}`;
  }
}
