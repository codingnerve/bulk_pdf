import type { NextResponse } from "next/server";
import { objectId } from "@/lib/validators/schemas";
import { ok } from "./response";
import { clearAuthCookies, setAuthCookies } from "@/lib/auth/cookies";
import type { PublicUser, TokenPair } from "@/services/auth.service";

/** Validates a dynamic path segment as a Mongo ObjectId (400 otherwise). */
export const parseId = (v: string) => objectId.parse(v);

/**
 * Web clients receive HTTP-only cookies (tokens never reach JavaScript);
 * extension / API clients receive the token pair in the JSON body.
 */
export function authResponse(
  user: PublicUser,
  tokens: TokenPair,
  client: "web" | "extension",
  status = 200,
): NextResponse {
  if (client === "web") {
    const res = ok({ user }, undefined, { status });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  }
  const { accessToken, refreshToken, expiresIn, tokenType } = tokens;
  return ok({ user, tokens: { accessToken, refreshToken, expiresIn, tokenType } }, undefined, { status });
}

export function loggedOutResponse(): NextResponse {
  const res = ok({ loggedOut: true });
  clearAuthCookies(res);
  return res;
}
