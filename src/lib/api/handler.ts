import "server-only";
import type { ZodType, z } from "zod";
import { connectDb } from "@/lib/db/connect";
import { authenticate, type AuthContext } from "@/lib/auth/session";
import { appOrigin, extensionOrigins } from "@/lib/env";
import { Errors } from "./errors";
import { checkRateLimit, clientIp, type RateLimitRule } from "./rate-limit";
import { errorToResponse, ok } from "./response";

const MAX_JSON_BYTES = 1024 * 1024; // 1 MB – JSON bodies only carry metadata, never PDFs

export const RATE = {
  auth: { name: "auth", limit: 10, windowMs: 60_000 } as RateLimitRule,
  authLoose: { name: "auth-loose", limit: 60, windowMs: 60_000 } as RateLimitRule,
  uploads: { name: "uploads", limit: 60, windowMs: 60_000 } as RateLimitRule,
  mutate: { name: "mutate", limit: 120, windowMs: 60_000 } as RateLimitRule,
  read: { name: "read", limit: 600, windowMs: 60_000 } as RateLimitRule,
  export: { name: "export", limit: 20, windowMs: 60_000 } as RateLimitRule,
  verify: { name: "verify", limit: 60, windowMs: 60_000 } as RateLimitRule,
};

export interface HandlerContext<B, Q, P extends Record<string, string>> {
  req: Request;
  auth: AuthContext;
  body: B;
  query: Q;
  params: P;
  ip: string;
}

interface Options<B extends ZodType | undefined, Q extends ZodType | undefined> {
  body?: B;
  query?: Q;
  /** Override the default per-user limit (null disables). */
  rateLimit?: RateLimitRule | null;
  /** Per-IP limit (used by public endpoints such as login). */
  ipRateLimit?: RateLimitRule;
}

type Infer<T extends ZodType | undefined> = T extends ZodType ? z.output<T> : undefined;
type RouteCtx<P> = { params: Promise<P> } | undefined;

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the browser-supplied
 * Origin must be this app. Bearer-token calls are exempt because browsers never attach
 * those automatically.
 */
export function assertSameOrigin(req: Request) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) throw Errors.forbidden("Missing Origin header");
  if (origin === appOrigin()) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    /* fall through */
  }
  throw Errors.forbidden("Cross-origin request blocked");
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_JSON_BYTES) throw Errors.tooLarge("Request body too large");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw Errors.tooLarge("Request body too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Errors.badRequest("Request body is not valid JSON");
  }
}

async function run<P extends Record<string, string>>(
  req: Request,
  routeCtx: RouteCtx<P>,
  opts: Options<ZodType | undefined, ZodType | undefined> & { authRequired: boolean },
  fn: (ctx: HandlerContext<unknown, unknown, P>) => Promise<unknown>,
): Promise<Response> {
  try {
    const ip = clientIp(req);
    if (opts.ipRateLimit) checkRateLimit(opts.ipRateLimit, ip);

    let auth: AuthContext | null = null;
    if (opts.authRequired) {
      auth = await authenticate(req);
      if (!auth) throw Errors.unauthorized();
      if (auth.via === "cookie") assertSameOrigin(req);
      const rule =
        opts.rateLimit === undefined
          ? req.method === "GET"
            ? RATE.read
            : RATE.mutate
          : opts.rateLimit;
      if (rule) checkRateLimit(rule, auth.userId);
    } else {
      // Public endpoint: a present Origin must be this app or an allowed extension origin.
      const origin = req.headers.get("origin");
      if (origin && req.method !== "GET" && !extensionOrigins().includes(origin)) {
        assertSameOrigin(req);
      }
    }

    await connectDb();

    let query: unknown = undefined;
    if (opts.query) {
      query = opts.query.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    }
    let body: unknown = undefined;
    if (opts.body) body = opts.body.parse(await readJson(req));
    const params = (routeCtx?.params ? await routeCtx.params : {}) as P;

    const result = await fn({ req, auth: auth as AuthContext, body, query, params, ip });
    if (result instanceof Response) return result;
    return ok(result ?? null);
  } catch (err) {
    // Next.js control-flow signals (prerender bail-out, redirects, ...) carry a `digest`
    // and must propagate untouched.
    if (typeof (err as { digest?: unknown })?.digest === "string") throw err;
    return errorToResponse(err);
  }
}

/** Authenticated route (cookie or Bearer). Validates body/query with Zod. */
export function api<
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends Record<string, string> = Record<string, string>,
>(opts: Options<B, Q>, fn: (ctx: HandlerContext<Infer<B>, Infer<Q>, P>) => Promise<unknown>) {
  return (req: Request, routeCtx?: RouteCtx<P>) =>
    run<P>(req, routeCtx, { ...opts, authRequired: true }, fn as never);
}

/** Public route (login, register, ...). ctx.auth is null at runtime. */
export function publicApi<
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends Record<string, string> = Record<string, string>,
>(
  opts: Options<B, Q>,
  fn: (ctx: Omit<HandlerContext<Infer<B>, Infer<Q>, P>, "auth">) => Promise<unknown>,
) {
  return (req: Request, routeCtx?: RouteCtx<P>) =>
    run<P>(req, routeCtx, { ...opts, authRequired: false }, fn as never);
}
