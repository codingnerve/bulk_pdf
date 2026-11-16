"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError, post } from "@/lib/api-client";
import { Semaphore, UploadHttpError, pool, putBlob, withRetry } from "@/lib/upload-client";
import { hasPdfSignature, validatePdfInfo } from "@/lib/validators/pdf";
import type { FileDto, InitiateResult, UploadInstruction } from "@/types/api";

export type ItemStatus =
  | "pending"
  | "validating"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: ItemStatus;
  /** 0–100 */
  progress: number;
  error?: string;
  duplicate?: boolean;
  /** Failed local validation (type/size/signature) – retrying cannot help. */
  invalid?: boolean;
  serverFileId?: string;
  publicUrl?: string;
  server?: FileDto;
  attempts: number;
}

export interface QueueLimits {
  maxFileSizeBytes: number;
  maxFilesPerBatch: number;
  concurrency: number;
}

const INITIATE_CHUNK = 50;
const PART_CONCURRENCY = 3;
const TERMINAL: ItemStatus[] = ["completed", "failed", "cancelled"];
export const isTerminal = (s: ItemStatus) => TERMINAL.includes(s);
export const isActive = (s: ItemStatus) => s === "validating" || s === "uploading" || s === "processing";

const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Upload failed");

interface Runtime {
  instruction?: UploadInstruction;
  controller?: AbortController;
  allowDuplicate?: boolean;
}

export function useUploadQueue(limits: QueueLimits | null) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const runtime = useRef(new Map<string, Runtime>());
  const batchIdRef = useRef<string | undefined>(undefined);
  const prepareLock = useRef<Promise<void>>(Promise.resolve());
  const semaphore = useRef(new Semaphore(4));
  const limitsRef = useRef(limits);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [batchId, setBatchId] = useState<string | undefined>();

  useEffect(() => {
    limitsRef.current = limits;
    if (limits) semaphore.current.limit = Math.max(1, limits.concurrency);
  }, [limits]);

  // ---- state plumbing: ref is the source of truth, React state is flushed (throttled) ----
  const flush = useCallback((immediate = false) => {
    if (immediate) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setItems(itemsRef.current);
      return;
    }
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setItems(itemsRef.current);
    }, 90);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<QueueItem>, immediate = true) => {
      itemsRef.current = itemsRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it));
      flush(immediate);
    },
    [flush],
  );

  const get = (id: string) => itemsRef.current.find((i) => i.id === id);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Warn before leaving mid-upload.
  const busy = items.some((i) => isActive(i.status));
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  // ---- adding / removing -----------------------------------------------------------------
  const addFiles = useCallback((files: File[]) => {
    const lim = limitsRef.current;
    const skipped: { name: string; reason: string }[] = [];
    const next: QueueItem[] = [];
    const known = new Set(itemsRef.current.map((i) => fingerprint(i.file)));
    let room = lim ? lim.maxFilesPerBatch - itemsRef.current.length : Infinity;

    for (const file of files) {
      if (known.has(fingerprint(file))) {
        skipped.push({ name: file.name, reason: "Already in the queue" });
        continue;
      }
      if (room <= 0) {
        skipped.push({ name: file.name, reason: `Batch limit reached (${lim?.maxFilesPerBatch} files)` });
        continue;
      }
      known.add(fingerprint(file));
      room--;
      const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
      const error = lim ? validatePdfInfo({ name: file.name, size: file.size, type }, lim) : null;
      next.push({
        id: uid(),
        file,
        name: file.name,
        size: file.size,
        status: error ? "failed" : "pending",
        progress: 0,
        error: error ?? undefined,
        invalid: !!error,
        attempts: 0,
      });
    }
    if (next.length) {
      itemsRef.current = [...itemsRef.current, ...next];
      flush(true);
    }
    return { added: next.length, skipped };
  }, [flush]);

  const cancelItem = useCallback(
    async (id: string) => {
      const it = get(id);
      if (!it || isTerminal(it.status)) return;
      const rt = runtime.current.get(id);
      rt?.controller?.abort();
      update(id, { status: "cancelled", error: "Cancelled" });
      if (it.serverFileId) {
        try {
          await post("/api/v1/uploads/cancel", { fileId: it.serverFileId });
        } catch {
          /* server cleanup job will handle leftovers */
        }
      }
    },
    [update],
  );

  const remove = useCallback(
    (id: string) => {
      const it = get(id);
      if (it && isActive(it.status)) void cancelItem(id);
      runtime.current.delete(id);
      itemsRef.current = itemsRef.current.filter((i) => i.id !== id);
      if (itemsRef.current.length === 0) {
        batchIdRef.current = undefined;
        setBatchId(undefined);
      }
      flush(true);
    },
    [cancelItem, flush],
  );

  const cancelPending = useCallback(() => {
    for (const it of itemsRef.current) if (!isTerminal(it.status)) void cancelItem(it.id);
  }, [cancelItem]);

  const clearFinished = useCallback(() => {
    itemsRef.current = itemsRef.current.filter((i) => !isTerminal(i.status));
    for (const id of [...runtime.current.keys()]) if (!get(id)) runtime.current.delete(id);
    if (itemsRef.current.length === 0) {
      batchIdRef.current = undefined;
      setBatchId(undefined);
    }
    flush(true);
  }, [flush]);

  // ---- engine ---------------------------------------------------------------------------------
  /** Client-side validation incl. real file signature. */
  const validate = useCallback(
    async (it: QueueItem): Promise<boolean> => {
      update(it.id, { status: "validating", error: undefined });
      try {
        const head = new Uint8Array(await it.file.slice(0, 1024).arrayBuffer());
        if (!hasPdfSignature(head)) {
          update(it.id, { status: "failed", invalid: true, error: "Not a valid PDF (missing %PDF- signature)" });
          return false;
        }
        return true;
      } catch {
        update(it.id, { status: "failed", error: "Could not read the file. It may have been moved or deleted." });
        return false;
      }
    },
    [update],
  );

  /** Initiates uploads on the server for items without a server record. */
  const initiate = useCallback(
    async (batch: QueueItem[]) => {
      const run = async () => {
        for (const allowDuplicates of [false, true]) {
          const group = batch.filter((i) => !!runtime.current.get(i.id)?.allowDuplicate === allowDuplicates);
          for (let off = 0; off < group.length; off += INITIATE_CHUNK) {
            const chunk = group.slice(off, off + INITIATE_CHUNK);
            try {
              const res = await post<{ batchId: string; results: InitiateResult[] }>("/api/v1/uploads/initiate", {
                batchId: batchIdRef.current,
                allowDuplicates,
                files: chunk.map((c) => ({
                  name: c.name,
                  size: c.size,
                  type: c.file.type || "application/pdf",
                })),
              });
              batchIdRef.current = res.batchId;
              setBatchId(res.batchId);
              for (const r of res.results) {
                const it = chunk[r.index];
                if (!it) continue;
                if (r.status === "ready") {
                  runtime.current.set(it.id, { ...runtime.current.get(it.id), instruction: r.upload });
                  update(it.id, { serverFileId: r.file.id, server: r.file }, false);
                } else {
                  update(it.id, { status: "failed", error: r.reason, duplicate: r.code === "DUPLICATE" });
                }
              }
            } catch (e) {
              for (const it of chunk) update(it.id, { status: "failed", error: errMsg(e) });
            }
          }
        }
      };
      // serialise so concurrent start() calls share one batch
      const p = prepareLock.current.then(run, run);
      prepareLock.current = p.catch(() => undefined);
      await p;
    },
    [update],
  );

  const refreshInstruction = async (it: QueueItem): Promise<UploadInstruction> => {
    const { upload } = await post<{ upload: UploadInstruction }>(`/api/v1/uploads/${it.serverFileId}/refresh`);
    runtime.current.set(it.id, { ...runtime.current.get(it.id), instruction: upload });
    return upload;
  };

  const uploadBytes = async (it: QueueItem, signal: AbortSignal) => {
    const rt = runtime.current.get(it.id)!;
    let instruction = rt.instruction!;
    const total = it.size;
    const partsDone = new Map<number, string>();
    const partLoaded = new Map<number, number>();
    const report = (loaded: number) =>
      update(it.id, { progress: Math.min(99, (loaded / total) * 100) }, false);
    let refreshedOnce = false;

    for (;;) {
      try {
        if (instruction.mode === "single") {
          const { url, headers } = instruction.single!;
          await withRetry(
            () => putBlob(url, it.file, { headers, signal, onProgress: (l) => report(l) }),
            { signal },
          );
          return undefined;
        }
        const { parts, partSize } = instruction.multipart!;
        const todo = parts.filter((p) => !partsDone.has(p.partNumber));
        await pool(todo, PART_CONCURRENCY, async (p) => {
          const start = (p.partNumber - 1) * partSize;
          const blob = it.file.slice(start, Math.min(start + partSize, total));
          const res = await withRetry(
            () =>
              putBlob(p.url, blob, {
                signal,
                onProgress: (l) => {
                  partLoaded.set(p.partNumber, l);
                  report([...partLoaded.values()].reduce((a, b) => a + b, 0));
                },
              }),
            { signal },
          );
          if (!res.etag) {
            throw new UploadHttpError("http", 0, "Storage did not return an ETag. Allow the ETag header in the R2 CORS policy.");
          }
          partLoaded.set(p.partNumber, blob.size);
          partsDone.set(p.partNumber, res.etag);
        });
        return [...partsDone.entries()].map(([partNumber, etag]) => ({ partNumber, etag }));
      } catch (e) {
        // Expired / invalid presigned URL → ask the API for fresh ones once, then continue.
        if (e instanceof UploadHttpError && e.expired && !refreshedOnce && !signal.aborted) {
          refreshedOnce = true;
          instruction = await refreshInstruction(it);
          continue;
        }
        throw e;
      }
    }
  };

  const processItem = useCallback(
    async (id: string) => {
      const rt = runtime.current.get(id) ?? {};
      runtime.current.set(id, rt);
      const controller = new AbortController();
      rt.controller = controller;
      let it = get(id);
      if (!it || it.status === "cancelled") return;
      try {
        update(id, { status: "uploading", progress: 0, error: undefined, attempts: it.attempts + 1 });
        it = get(id)!;
        const parts = await uploadBytes(it, controller.signal);
        if (get(id)?.status === "cancelled") return;
        update(id, { status: "processing", progress: 100 });
        const { file } = await withRetry(
          () => api<{ file: FileDto }>("/api/v1/uploads/complete", { method: "POST", json: { fileId: it!.serverFileId, parts } }),
          { signal: controller.signal, retries: 2 },
        );
        update(id, { status: "completed", progress: 100, publicUrl: file.publicUrl, server: file, error: undefined });
      } catch (e) {
        if (get(id)?.status === "cancelled" || (e instanceof UploadHttpError && e.kind === "aborted")) return;
        const message =
          e instanceof ApiClientError || e instanceof UploadHttpError ? e.message : errMsg(e);
        update(id, { status: "failed", error: message });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update],
  );

  /** Validates, registers with the API, then uploads everything with bounded concurrency. */
  const start = useCallback(
    async (onlyIds?: string[]) => {
      const targets = itemsRef.current.filter(
        (i) => i.status === "pending" && (!onlyIds || onlyIds.includes(i.id)),
      );
      if (!targets.length) return;
      // 1) validate (cheap, local)
      const valid: QueueItem[] = [];
      await pool(targets, 6, async (t) => {
        if (await validate(t)) valid.push(get(t.id)!);
      });
      // 2) register those without a live server record
      const needInitiate = valid.filter((v) => !v.serverFileId);
      if (needInitiate.length) await initiate(needInitiate);
      // 3) upload with a global concurrency cap
      await Promise.all(
        valid.map(async (v) => {
          const cur = get(v.id);
          if (!cur || cur.status !== "validating") return; // rejected by server / cancelled
          update(v.id, { status: "pending" }, false);
          await semaphore.current.run(async () => {
            const c = get(v.id);
            if (!c || c.status === "cancelled") return;
            if (c.serverFileId && !runtime.current.get(v.id)?.instruction) {
              // retry of an interrupted upload: resume on the same server record
              try {
                await refreshInstruction(c);
              } catch {
                // server record is gone/terminal → register again
                update(v.id, { serverFileId: undefined, server: undefined }, false);
                await initiate([get(v.id)!]);
                if (get(v.id)?.status === "failed") return;
              }
            }
            if (get(v.id)?.status === "failed") return;
            await processItem(v.id);
          });
        }),
      );
    },
    [initiate, processItem, update, validate],
  );

  const retry = useCallback(
    (id: string, opts: { allowDuplicate?: boolean } = {}) => {
      const it = get(id);
      if (!it || it.invalid || (it.status !== "failed" && it.status !== "cancelled")) return;
      const rt = runtime.current.get(id) ?? {};
      if (opts.allowDuplicate) rt.allowDuplicate = true;
      // A failed/cancelled server record can't be resumed – start a fresh one.
      const resumable = it.status === "failed" && !!it.serverFileId && !it.duplicate && it.attempts > 0;
      if (!resumable) {
        rt.instruction = undefined;
      }
      runtime.current.set(id, { ...rt, controller: undefined, instruction: undefined });
      update(id, {
        status: "pending",
        progress: 0,
        error: undefined,
        duplicate: false,
        serverFileId: resumable ? it.serverFileId : undefined,
        server: resumable ? it.server : undefined,
      });
      void start([id]);
    },
    [start, update],
  );

  const retryAllFailed = useCallback(() => {
    const failed = itemsRef.current.filter((i) => i.status === "failed" && !i.duplicate && !i.invalid);
    failed.forEach((f) => retry(f.id));
  }, [retry]);

  const reset = useCallback(() => {
    for (const rt of runtime.current.values()) rt.controller?.abort();
    runtime.current.clear();
    itemsRef.current = [];
    batchIdRef.current = undefined;
    setBatchId(undefined);
    flush(true);
  }, [flush]);

  // ---- derived -------------------------------------------------------------------------------
  const summary = useMemo(() => {
    const counts: Record<ItemStatus, number> = {
      pending: 0, validating: 0, uploading: 0, processing: 0, completed: 0, failed: 0, cancelled: 0,
    };
    let bytes = 0;
    let done = 0;
    for (const i of items) {
      counts[i.status]++;
      if (i.status === "cancelled") continue;
      bytes += i.size;
      done += (i.status === "completed" ? 100 : i.progress) * i.size / 100;
    }
    return {
      counts,
      total: items.length,
      overall: bytes ? (done / bytes) * 100 : 0,
      active: counts.validating + counts.uploading + counts.processing,
      startable: counts.pending,
    };
  }, [items]);

  return {
    items,
    batchId,
    summary,
    addFiles,
    remove,
    cancelItem,
    cancelPending,
    clearFinished,
    start,
    retry,
    retryAllFailed,
    reset,
  };
}
