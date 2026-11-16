import { afterAll, beforeAll, beforeEach } from "vitest";
import mongoose from "mongoose";

process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.APP_URL = "http://localhost:3000";
process.env.R2_ACCOUNT_ID = "acct";
process.env.R2_ACCESS_KEY_ID = "key";
process.env.R2_SECRET_ACCESS_KEY = "secret";
process.env.R2_BUCKET_NAME = "bucket";
process.env.R2_PUBLIC_DOMAIN = "files.example.test";
process.env.MAX_FILE_SIZE_MB = "50";
process.env.MAX_FILES_PER_BATCH = "10";
process.env.MULTIPART_THRESHOLD_MB = "5";
process.env.MULTIPART_PART_SIZE_MB = "5";
process.env.CRON_SECRET = "cron-secret-value";

beforeAll(async () => {
  const [{ connectDb }, { setStorage }, { MemoryStorage }] = await Promise.all([
    import("@/lib/db/connect"),
    import("@/lib/storage"),
    import("@/lib/storage/memory"),
  ]);
  await connectDb();
  setStorage(new MemoryStorage());
});

beforeEach(async () => {
  const [{ setStorage }, { MemoryStorage }, { resetRateLimits }] = await Promise.all([
    import("@/lib/storage"),
    import("@/lib/storage/memory"),
    import("@/lib/api/rate-limit"),
  ]);
  setStorage(new MemoryStorage());
  resetRateLimits();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
