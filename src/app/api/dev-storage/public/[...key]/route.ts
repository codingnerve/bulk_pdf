import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { DevMemoryStorage } from "@/lib/storage/dev-memory";

/**
 * DEV ONLY: acts as the public custom domain (R2_PUBLIC_DOMAIN) for the in-memory storage.
 * Like a public R2 bucket it serves anything under pdfs/ and nothing from private/ or staging/.
 */
async function serve(req: Request, ctx: { params: Promise<{ key: string[] }> }, head: boolean) {
  if (process.env.NODE_ENV === "production" || getEnv().STORAGE_DRIVER !== "memory") {
    return new NextResponse("Not found", { status: 404 });
  }
  const storage = getStorage();
  if (!(storage instanceof DevMemoryStorage)) return new NextResponse("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const obj = storage.objects.get(key);
  const url = new URL(req.url);
  const allowed = key.startsWith("pdfs/") || url.searchParams.has("d"); // `d` only on owner presigned GETs
  if (!obj || !allowed) return new NextResponse("Not found", { status: 404 });
  const disposition = url.searchParams.get("d") === "attachment" ? "attachment" : "inline";
  const name = (url.searchParams.get("name") ?? "document.pdf").replace(/[^\w.\- ]/g, "_");
  return new NextResponse(head ? null : Buffer.from(obj.data), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(obj.data.length),
      "Content-Disposition": `${disposition}; filename="${name}"`,
      "Cache-Control": "public, max-age=60",
    },
  });
}

export const GET = (req: Request, ctx: { params: Promise<{ key: string[] }> }) => serve(req, ctx, false);
export const HEAD = (req: Request, ctx: { params: Promise<{ key: string[] }> }) => serve(req, ctx, true);
