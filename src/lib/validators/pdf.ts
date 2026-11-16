// Isomorphic: used by the browser queue *and* by the server after upload.

export const PDF_MIME = "application/pdf";
const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** The PDF spec allows the header within the first 1024 bytes. */
export const SIGNATURE_WINDOW = 1024;

/** True if the bytes contain a `%PDF-` header in the first 1024 bytes. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SIGNATURE_WINDOW) - MAGIC.length;
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < MAGIC.length; j++) {
      if (bytes[i + j] !== MAGIC[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Strips path components, control characters and characters that are unsafe in headers
 * or file systems. The result is only ever used as metadata – never as a storage key.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  const limited = cleaned.length > 200 ? cleaned.slice(0, 196) + cleaned.slice(-4) : cleaned;
  return limited || "document.pdf";
}

export interface PdfFileInfo {
  name: string;
  size: number;
  type: string;
}

export interface PdfLimits {
  maxFileSizeBytes: number;
}

/** Returns an error message, or null when the file is acceptable. */
export function validatePdfInfo(file: PdfFileInfo, limits: PdfLimits): string | null {
  if (!/\.pdf$/i.test(file.name)) return "Only .pdf files are allowed";
  if (file.type !== PDF_MIME) return "File type must be application/pdf";
  if (!Number.isFinite(file.size) || file.size <= 0) return "File is empty";
  if (file.size > limits.maxFileSizeBytes) {
    return `File exceeds the maximum size of ${Math.floor(limits.maxFileSizeBytes / (1024 * 1024))} MB`;
  }
  return null;
}
