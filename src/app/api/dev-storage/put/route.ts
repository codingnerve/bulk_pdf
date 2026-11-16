import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { DevMemoryStorage } from "@/lib/storage/dev-memory";

/** DEV ONLY: stands in for the presigned PUT to R2 when STORAGE_DRIVER=memory. */
export async function PUT(req: Request) {
  if (process.env.NODE_ENV === "production" || getEnv().STORAGE_DRIVER !== "memory") {
    return new NextResponse("Not found", { status: 404 });
  }
  const storage = getStorage();
  if (!(storage instanceof DevMemoryStorage)) return new NextResponse("Not found", { status: 404 });
  const key = new URL(req.url).searchParams.get("key");
  if (!key || !key.startsWith("staging/")) return new NextResponse("Bad key", { status: 400 });
  const data = new Uint8Array(await req.arrayBuffer());
  storage.putObject(key, data, req.headers.get("content-type") ?? "application/pdf");
  return new NextResponse(null, { status: 200 });
}
