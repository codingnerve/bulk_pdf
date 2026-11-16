import { describe, expect, it } from "vitest";
import { hasPdfSignature, sanitizeFilename, validatePdfInfo } from "@/lib/validators/pdf";
import { buildContentDisposition, newObjectKey, newPrivateKey, publicUrlFor } from "@/lib/storage/keys";
import { csvCell } from "@/services/export.service";
import { initiateUploadSchema, registerSchema } from "@/lib/validators/schemas";

const enc = (s: string) => new TextEncoder().encode(s);
const limits = { maxFileSizeBytes: 10 * 1024 * 1024 };

describe("PDF validation", () => {
  it("accepts the %PDF- signature, also after a short preamble", () => {
    expect(hasPdfSignature(enc("%PDF-1.7\nrest"))).toBe(true);
    expect(hasPdfSignature(enc("junk\n%PDF-1.4"))).toBe(true);
  });

  it("rejects non-PDF content and signatures beyond the first 1024 bytes", () => {
    expect(hasPdfSignature(enc("PK\u0003\u0004 zip"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array(0))).toBe(false);
    const late = new Uint8Array(2000);
    late.set(enc("%PDF-"), 1500);
    expect(hasPdfSignature(late)).toBe(false);
  });

  it("validates extension, MIME type, emptiness and size", () => {
    expect(validatePdfInfo({ name: "a.pdf", size: 10, type: "application/pdf" }, limits)).toBeNull();
    expect(validatePdfInfo({ name: "a.PDF", size: 10, type: "application/pdf" }, limits)).toBeNull();
    expect(validatePdfInfo({ name: "a.exe", size: 10, type: "application/pdf" }, limits)).toMatch(/pdf/i);
    expect(validatePdfInfo({ name: "a.pdf", size: 10, type: "text/html" }, limits)).toMatch(/application\/pdf/);
    expect(validatePdfInfo({ name: "a.pdf", size: 0, type: "application/pdf" }, limits)).toMatch(/empty/i);
    expect(validatePdfInfo({ name: "a.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }, limits)).toMatch(/10 MB/);
  });
});

describe("filename + key safety", () => {
  it("strips paths, control and bidi characters", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("C:\\Users\\x\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("a\u0000b\u202ec.pdf")).toBe("abc.pdf");
    expect(sanitizeFilename("   ")).toBe("document.pdf");
    expect(sanitizeFilename("...hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFilename("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(200);
  });

  it("generates unique object keys that never contain the filename", () => {
    const a = newObjectKey(new Date("2026-03-01T00:00:00Z"));
    const b = newObjectKey(new Date("2026-03-01T00:00:00Z"));
    expect(a).toMatch(/^pdfs\/2026\/[0-9a-f-]{36}\.pdf$/);
    expect(a).not.toBe(b);
    expect(newPrivateKey()).toMatch(/^private\//);
  });

  it("builds public URLs on the configured custom domain", () => {
    expect(publicUrlFor("pdfs/2026/abc.pdf")).toBe("https://files.example.test/pdfs/2026/abc.pdf");
  });

  it("builds an injection-safe Content-Disposition header", () => {
    const h = buildContentDisposition("inline", 'evil"\r\nSet-Cookie: x=y.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.startsWith("inline; filename=")).toBe(true);
    expect(buildContentDisposition("attachment", "résumé.pdf")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });
});

describe("CSV safety", () => {
  it("quotes special characters and neutralises formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("plain.pdf")).toBe("plain.pdf");
  });
});

describe("request schemas", () => {
  it("rejects weak passwords and bad emails", () => {
    expect(registerSchema.safeParse({ name: "A", email: "nope", password: "Passw0rd1" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "A", email: "a@b.co", password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "A", email: "a@b.co", password: "allletters" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "A", email: "A@B.co", password: "Passw0rd1" }).data?.email).toBe("a@b.co");
  });

  it("only accepts primitives (no operator objects) in upload payloads", () => {
    const bad = initiateUploadSchema.safeParse({
      files: [{ name: { $ne: "" }, size: 1, type: "application/pdf" }],
    });
    expect(bad.success).toBe(false);
  });
});
