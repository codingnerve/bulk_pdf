import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Public object key, e.g. pdfs/2026/3f1c…-uuid.pdf. Never derived from the user's filename. */
export function newObjectKey(now = new Date()): string {
  return `pdfs/${now.getUTCFullYear()}/${randomUUID()}.pdf`;
}

/** Where the browser uploads first; the object only becomes public after verification. */
export function newStagingKey(): string {
  return `staging/${randomUUID()}${randomUUID().replace(/-/g, "")}.pdf`;
}

/** Secret key used while a file's public access is revoked. Never returned by the API. */
export function newPrivateKey(): string {
  return `private/${randomUUID()}${randomUUID().replace(/-/g, "")}.pdf`;
}

export function publicBase(): string {
  let d = getEnv().R2_PUBLIC_DOMAIN.trim();
  if (!/^https?:\/\//i.test(d)) d = `https://${d}`;
  return d.replace(/\/+$/, "");
}

export function publicUrlFor(objectKey: string): string {
  const encoded = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${publicBase()}/${encoded}`;
}

export function publicHost(): string {
  try {
    return new URL(publicBase()).host;
  } catch {
    return "";
  }
}

/** Builds a safe Content-Disposition value (ASCII fallback + RFC 5987 encoded name). */
export function buildContentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const ascii =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\;]/g, "_")
      .slice(0, 150) || "document.pdf";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
