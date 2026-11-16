"use client";

/** Low-level helpers for talking to presigned storage URLs from the browser. */

export class UploadHttpError extends Error {
  constructor(
    public kind: "network" | "http" | "aborted",
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "UploadHttpError";
  }
  /** Worth retrying automatically (connection hiccups, throttling, 5xx). */
  get transient() {
    return this.kind === "network" || this.status === 408 || this.status === 429 || this.status >= 500;
  }
  /** Presigned URL expired / signature no longer valid. */
  get expired() {
    return this.kind === "http" && this.status === 403;
  }
}

export interface PutResult {
  etag: string | null;
}

/** PUT a Blob with upload progress (fetch can't report upload progress, XHR can). */
export function putBlob(
  url: string,
  body: Blob,
  opts: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  } = {},
): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new UploadHttpError("aborted", 0, "Upload cancelled"));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(body.size, body.size);
        resolve({ etag: xhr.getResponseHeader("ETag") });
      } else {
        reject(new UploadHttpError("http", xhr.status, `Storage rejected the upload (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new UploadHttpError("network", 0, "Network error during upload"));
    xhr.ontimeout = () => reject(new UploadHttpError("network", 0, "Upload timed out"));
    xhr.onabort = () => reject(new UploadHttpError("aborted", 0, "Upload cancelled"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new UploadHttpError("aborted", 0, "Upload cancelled"));
      },
      { once: true },
    );
  });

/** Retries transient failures with exponential backoff. Never retries aborts or 4xx. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; signal?: AbortSignal; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const api = e as { name?: string; status?: number };
      const transient =
        (e instanceof UploadHttpError && e.transient) ||
        (api?.name === "ApiClientError" && (api.status === 0 || (api.status ?? 0) >= 500));
      if (!transient || attempt >= retries || opts.signal?.aborted) throw e;
      await sleep((opts.baseDelayMs ?? 800) * 2 ** attempt, opts.signal);
    }
  }
}

/** Counting semaphore – caps concurrent file uploads across all queue runs. */
export class Semaphore {
  private waiters: (() => void)[] = [];
  private active = 0;
  constructor(public limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next && this.active <= this.limit) next();
    else this.active--;
  }
}

/** Runs `worker` over `items` with at most `concurrency` in flight. */
export async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    }),
  );
}
