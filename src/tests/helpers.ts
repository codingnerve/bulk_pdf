import { getStorage } from "@/lib/storage";
import type { MemoryStorage } from "@/lib/storage/memory";
import { registerUser } from "@/services/auth.service";
import { completeUpload, initiateUploads, type InitiateResult } from "@/services/upload.service";
import { FileModel } from "@/models/File";
import { Membership } from "@/models/Membership";
import type { Scope } from "@/lib/auth/scope";

export const mem = () => getStorage() as unknown as MemoryStorage;

export function pdfBytes(size = 2048, header = "%PDF-1.7\n"): Uint8Array {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode(header));
  return b;
}

export async function createUser(email = "alice@example.com", name = "Alice") {
  const { user, tokens } = await registerUser({
    name,
    email,
    password: "Passw0rd!x",
    client: "extension",
  });
  const m = await Membership.findOne({ userId: user.id }).lean();
  const scope: Scope = { userId: user.id, workspaceId: String(m!.workspaceId), wsRole: m!.role };
  return { userId: user.id, scope, workspaceId: scope.workspaceId, user, tokens, bearer: { authorization: `Bearer ${tokens.accessToken}` } };
}

export function req(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

export const pdfMeta = (name: string, size = 2048) => ({ name, size, type: "application/pdf" });

type Ready = Extract<InitiateResult, { status: "ready" }>;

/** Simulates the browser PUT-ing bytes to the presigned URL(s). Returns multipart parts if any. */
export async function browserUpload(r: Ready, bytes: Uint8Array) {
  const doc = await FileModel.findById(r.file.id);
  if (!doc?.stagingKey) throw new Error("no staging key");
  if (r.upload.mode === "single") {
    mem().putObject(doc.stagingKey, bytes);
    return undefined;
  }
  const { uploadId, partSize, parts } = r.upload.multipart!;
  return parts.map((p) => ({
    partNumber: p.partNumber,
    etag: mem().putPart(uploadId, p.partNumber, bytes.slice((p.partNumber - 1) * partSize, p.partNumber * partSize)),
  }));
}

/** initiate → upload → complete for one file; returns the completed file DTO. */
export async function uploadOne(scope: Scope, name = "doc.pdf", size = 2048, batchId?: string) {
  const init = await initiateUploads(scope, { files: [pdfMeta(name, size)], allowDuplicates: true, batchId });
  const r = init.results[0];
  if (r.status !== "ready") throw new Error(`rejected: ${r.reason}`);
  const parts = await browserUpload(r, pdfBytes(size));
  const file = await completeUpload(scope, { fileId: r.file.id, parts });
  return { file, batchId: init.batchId };
}
