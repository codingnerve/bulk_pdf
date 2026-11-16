import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "pl_at";
const REFRESH_COOKIE = "pl_rt";

function extensionOrigins(): string[] {
  return (process.env.ALLOWED_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originOf(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).origin;
  } catch {
    return "";
  }
}

/**
 * Content-Security-Policy, built per request from the runtime environment: browsers upload
 * straight to the storage endpoint and preview PDFs from the public storage domain.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  const publicOrigin = originOf(process.env.R2_PUBLIC_DOMAIN);
  const storageOrigin = originOf(process.env.STORAGE_PUBLIC_ENDPOINT || process.env.STORAGE_ENDPOINT);
  const connect = [
    "'self'",
    ...(storageOrigin ? [storageOrigin] : ["https://*.r2.cloudflarestorage.com"]),
    ...(publicOrigin ? [publicOrigin] : []),
    ...(dev ? ["ws:", "wss:"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${publicOrigin || "'none'"}${dev ? " 'self'" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * 1. /api/v1/*  → CORS for allow-listed extension origins (Bearer auth, no credentials).
 * 2. /dashboard/* → coarse gate: no session cookie at all means go to /login.
 *    (Real authorization happens in the API; this only avoids flashing the app shell.)
 * 3. Pages → runtime Content-Security-Policy.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/v1/")) {
    const origin = request.headers.get("origin");
    const allowed = origin && extensionOrigins().includes(origin) ? origin : null;
    if (request.method === "OPTIONS" && allowed) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowed,
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    const res = NextResponse.next();
    if (allowed) {
      res.headers.set("Access-Control-Allow-Origin", allowed);
      res.headers.set("Access-Control-Expose-Headers", "Content-Disposition, X-Export-Count, Retry-After");
      res.headers.append("Vary", "Origin");
    }
    return res;
  }

  if (pathname.startsWith("/dashboard")) {
    const hasSession = request.cookies.has(ACCESS_COOKIE) || request.cookies.has(REFRESH_COOKIE);
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return res;
}

export const config = {
  matcher: ["/api/v1/:path*", "/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
