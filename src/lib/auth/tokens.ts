import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

export const ACCESS_TTL_SEC = 10 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const ISSUER = "pdflinker";
const AUDIENCE = "pdflinker-api";

export interface AccessClaims {
  sub: string;
  role: "user" | "admin";
  sid: string;
}

const key = () => new TextEncoder().encode(getEnv().AUTH_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return {
      sub: payload.sub,
      sid: payload.sid,
      role: payload.role === "admin" ? "admin" : "user",
    };
  } catch {
    return null;
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Opaque, high-entropy refresh/reset token. Only its hash is stored. */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
