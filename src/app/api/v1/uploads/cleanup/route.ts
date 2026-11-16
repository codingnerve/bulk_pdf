import { timingSafeEqual } from "node:crypto";
import { connectDb } from "@/lib/db/connect";
import { getEnv } from "@/lib/env";
import { Errors } from "@/lib/api/errors";
import { errorToResponse, ok } from "@/lib/api/response";
import { cleanupAbandonedUploads } from "@/services/upload.service";

/**
 * Cron endpoint: aborts abandoned multipart uploads and removes staged bytes.
 * Call with `Authorization: Bearer $CRON_SECRET` (e.g. Vercel Cron, GitHub Actions, crontab).
 */
export async function POST(req: Request) {
  try {
    const secret = getEnv().CRON_SECRET;
    const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw Errors.unauthorized();
    await connectDb();
    return ok(await cleanupAbandonedUploads());
  } catch (e) {
    return errorToResponse(e);
  }
}

export const GET = POST; // Vercel Cron issues GET requests
