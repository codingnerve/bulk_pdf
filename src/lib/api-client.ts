"use client";

import type { Pagination } from "@/types/api";

/** Browser-side client for /api/v1. Cookies carry the session; 401s trigger one silent refresh. */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "same-origin",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function rawFetch(path: string, init: RequestInit & { json?: unknown }, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, body, headers, credentials: "same-origin" });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network error. Check your connection and try again.");
  }
  if (res.status === 401 && retry && !path.startsWith("/api/v1/auth/")) {
    if (await refreshSession()) return rawFetch(path, init, false);
  }
  return res;
}

async function parseError(res: Response): Promise<ApiClientError> {
  try {
    const body = await res.json();
    return new ApiClientError(res.status, body.error?.code ?? "ERROR", body.error?.message ?? res.statusText, body.error?.details);
  } catch {
    return new ApiClientError(res.status, "ERROR", res.statusText || "Request failed");
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await rawFetch(path, init);
  if (!res.ok) throw await parseError(res);
  const body = await res.json();
  return body.data as T;
}

export async function apiList<T>(path: string): Promise<{ items: T[]; pagination: Pagination }> {
  const res = await rawFetch(path, {});
  if (!res.ok) throw await parseError(res);
  const body = await res.json();
  return { items: body.data as T[], pagination: body.meta.pagination as Pagination };
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: "DELETE", ...(json ? { json } : {}) });

export type ExportFormat = "csv" | "xlsx" | "txt";

/** POSTs to /exports/{format} and triggers a browser download of the result. */
export async function downloadExport(
  format: ExportFormat,
  body: { ids?: string[]; batchId?: string; includeAll?: boolean },
): Promise<number> {
  const res = await rawFetch(`/api/v1/exports/${format}`, { method: "POST", json: body });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `pdflinker-links.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return Number(res.headers.get("x-export-count") ?? 0);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
