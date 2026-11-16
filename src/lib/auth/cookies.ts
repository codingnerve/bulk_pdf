import type { NextResponse } from "next/server";
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from "./tokens";
import { isProd } from "@/lib/env";

export const ACCESS_COOKIE = "pl_at";
export const REFRESH_COOKIE = "pl_rt";

const base = () => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: "lax" as const,
});

export function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string) {
  res.cookies.set(ACCESS_COOKIE, accessToken, { ...base(), path: "/", maxAge: ACCESS_TTL_SEC });
  // The refresh cookie is only ever sent to the auth endpoints.
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...base(),
    path: "/api/v1/auth",
    maxAge: REFRESH_TTL_SEC,
  });
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { ...base(), path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...base(), path: "/api/v1/auth", maxAge: 0 });
}
