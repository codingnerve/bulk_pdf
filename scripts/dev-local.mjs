// Runs the whole app locally with NO external services:
//   - MongoDB: in-memory server (data is lost when you stop it)
//   - Storage: in-process memory driver; "public URLs" are served by /api/dev-storage/public
// For real development against your own MongoDB + Cloudflare R2, use `npm run dev` with .env.local.
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
const mongod = await MongoMemoryServer.create();
const env = {
  ...process.env,
  PORT: port,
  MONGODB_URI: mongod.getUri("pdflinker_dev"),
  AUTH_SECRET: process.env.AUTH_SECRET ?? "local-dev-secret-local-dev-secret-0123456789",
  APP_URL: `http://localhost:${port}`,
  STORAGE_DRIVER: "memory",
  R2_PUBLIC_DOMAIN: `http://localhost:${port}/api/dev-storage/public`,
  MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB ?? "100",
  MAX_FILES_PER_BATCH: process.env.MAX_FILES_PER_BATCH ?? "100",
  MULTIPART_THRESHOLD_MB: process.env.MULTIPART_THRESHOLD_MB ?? "20",
};

console.log(`\n  PDFLinker local mode: http://localhost:${port}`);
console.log("  In-memory MongoDB + in-memory storage (everything resets on restart)\n");

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], {
  env,
  stdio: "inherit",
});
const stop = async () => {
  child.kill();
  await mongod.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", stop);
