import { NextResponse } from "next/server";
import { buildOpenApi } from "@/lib/openapi";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.json(buildOpenApi(url.origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
