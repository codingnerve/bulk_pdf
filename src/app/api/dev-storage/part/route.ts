import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { DevMemoryStorage } from "@/lib/storage/dev-memory";

/** DEV ONLY: stands in for a presigned multipart UploadPart when STORAGE_DRIVER=memory. */
export async function PUT(req: Request) {
  if (process.env.NODE_ENV === "production" || getEnv().STORAGE_DRIVER !== "memory") {
    return new NextResponse("Not found", { status: 404 });
  }
  const storage = getStorage();
  if (!(storage instanceof DevMemoryStorage)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  const n = Number(url.searchParams.get("n"));
  if (!uploadId || !Number.isInteger(n) || n < 1) return new NextResponse("Bad request", { status: 400 });
  try {
    const etag = storage.putPart(uploadId, n, new Uint8Array(await req.arrayBuffer()));
    return new NextResponse(null, { status: 200, headers: { ETag: `"${etag}"` } });
  } catch {
    return new NextResponse("NoSuchUpload", { status: 404 });
  }
}
