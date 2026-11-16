import { z } from "zod";

const intFrom = (def: number, min = 1, max = 100000) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? def : v),
    z.coerce.number().int().min(min).max(max),
  );

const schema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ALLOWED_EXTENSION_ORIGINS: z.string().optional().default(""),
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET_NAME: z.string().optional().default(""),
  R2_PUBLIC_DOMAIN: z.string().optional().default(""),
  MAX_FILE_SIZE_MB: intFrom(100, 1, 5000),
  MAX_FILES_PER_BATCH: intFrom(100, 1, 1000),
  UPLOAD_CONCURRENCY: intFrom(4, 1, 16),
  MULTIPART_THRESHOLD_MB: intFrom(20, 5, 5000),
  MULTIPART_PART_SIZE_MB: intFrom(10, 5, 500),
  CRON_SECRET: z.string().optional().default(""),
  /** S3-compatible endpoint (MinIO, Backblaze B2, AWS ...). Empty = Cloudflare R2 from R2_ACCOUNT_ID. */
  STORAGE_ENDPOINT: z.string().optional().default(""),
  /** Endpoint browsers use for presigned URLs when it differs from STORAGE_ENDPOINT (e.g. inside Docker). */
  STORAGE_PUBLIC_ENDPOINT: z.string().optional().default(""),
  STORAGE_REGION: z.string().optional().default(""),
  /** "true" for MinIO. Defaults to true whenever STORAGE_ENDPOINT is set. */
  STORAGE_FORCE_PATH_STYLE: z.string().optional().default(""),
  /** "memory" = dev-only in-process storage (no R2 needed). Refused in production. */
  STORAGE_DRIVER: z.enum(["r2", "memory"]).optional().default("r2"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parsed + validated environment. Throws a readable error on misconfiguration. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}

export function getR2Env() {
  const env = getEnv();
  const required = [
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_DOMAIN",
    ...(env.STORAGE_ENDPOINT ? [] : ["R2_ACCOUNT_ID"]),
  ] as const;
  const missing = required.filter((k) => !env[k as keyof typeof env]);
  if (missing.length) {
    throw new Error(`Cloud storage is not configured. Missing: ${missing.join(", ")}`);
  }
  return env;
}

export function appOrigin(): string {
  return new URL(getEnv().APP_URL).origin;
}

export function extensionOrigins(): string[] {
  return getEnv()
    .ALLOWED_EXTENSION_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const isProd = () => process.env.NODE_ENV === "production";
