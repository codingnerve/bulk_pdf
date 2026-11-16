import "server-only";
import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = globalThis as unknown as { __pdflinkerMongoose?: Cache };
const cache: Cache = (g.__pdflinkerMongoose ??= { conn: null, promise: null });

/** Cached connection – safe across hot reloads and serverless invocations. */
export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!cache.promise) {
    // NoSQL-injection defence: every request value is parsed by Zod into primitives
    // (never objects) before it reaches a query, and strictQuery drops unknown paths.
    mongoose.set("strictQuery", true);
    cache.promise = mongoose
      .connect(getEnv().MONGODB_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 8000,
        // autoIndex stays on so unique/TTL indexes exist on first deploy (builds are idempotent).
      })
      .catch((e) => {
        cache.promise = null;
        throw e;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectDb() {
  if (cache.conn) await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}
