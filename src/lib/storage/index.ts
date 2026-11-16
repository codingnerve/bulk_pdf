import "server-only";
import { getEnv } from "@/lib/env";
import { DevMemoryStorage } from "./dev-memory";
import { createS3Driver } from "./s3";
import type { StorageDriver } from "./types";

const g = globalThis as unknown as { __plStorage?: StorageDriver };

/** Returns the configured storage driver (Cloudflare R2 by default, or any S3-compatible store such as MinIO). */
export function getStorage(): StorageDriver {
  if (g.__plStorage) return g.__plStorage;
  if (getEnv().STORAGE_DRIVER === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STORAGE_DRIVER=memory is for local development only");
    }
    return (g.__plStorage = new DevMemoryStorage());
  }
  return (g.__plStorage = createS3Driver());
}

/** Test hook – inject a different driver. Pass null to reset. */
export function setStorage(driver: StorageDriver | null) {
  if (driver) g.__plStorage = driver;
  else delete g.__plStorage;
}

export * from "./keys";
export type * from "./types";
