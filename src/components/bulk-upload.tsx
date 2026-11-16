"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Ban, CheckCircle2, ExternalLink, FolderUp, Info, Loader2, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CopyButton, ExportMenu, PageHeader, PdfIcon } from "@/components/shared";
import { useUploadQueue, isActive, isTerminal, type QueueItem } from "@/hooks/use-upload-queue";
import { useAsync } from "@/hooks/use-api";
import { api } from "@/lib/api-client";
import { cn, formatBytes } from "@/lib/utils";
import type { EffectiveLimits } from "@/types/api";

// ------------------------------------------------------------------ drag & drop helpers
async function readDirectory(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = dir.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const files: File[] = [];
  for (const e of entries) {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (/\.pdf$/i.test(f.name)) files.push(f);
    } else if (e.isDirectory) files.push(...(await readDirectory(e as FileSystemDirectoryEntry)));
  }
  return files;
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = [...dt.items].map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null));
  if (entries.some((e) => e?.isDirectory)) {
    for (const [i, e] of entries.entries()) {
      if (e?.isDirectory) out.push(...(await readDirectory(e as FileSystemDirectoryEntry)));
      else {
        const f = dt.items[i].getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }
  return [...dt.files];
}

// ------------------------------------------------------------------ row
const STATUS_TEXT: Record<QueueItem["status"], string> = {
  pending: "Ready to upload",
  validating: "Validating…",
  uploading: "Uploading",
  processing: "Verifying & publishing…",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const Row = React.memo(function Row({
  item,
  onRemove,
  onCancel,
  onRetry,
}: {
  item: QueueItem;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string, o?: { allowDuplicate?: boolean }) => void;
}) {
  const { status } = item;
  const tone = status === "completed" ? "success" : status === "failed" ? "danger" : status === "processing" ? "warn" : "accent";
  return (
    <li className="flex items-center gap-3 px-4 py-3 [contain-intrinsic-size:auto_64px] [content-visibility:auto]">
      <PdfIcon />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink" title={item.name}>
            {item.name}
          </p>
          <span className="shrink-0 text-xs text-faint tabular-nums">{formatBytes(item.size)}</span>
        </div>
        {(status === "uploading" || status === "processing") && (
          <div className="mt-2 flex items-center gap-3">
            <Progress value={item.progress} tone={tone} active label={`${item.name} upload progress`} />
            <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{Math.round(item.progress)}%</span>
          </div>
        )}
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-xs",
            status === "failed" ? "text-danger" : status === "completed" ? "text-success" : "text-muted",
          )}
        >
          {status === "completed" && <CheckCircle2 className="size-3.5" />}
          {status === "failed" && <AlertCircle className="size-3.5" />}
          {(status === "validating" || status === "processing") && <Loader2 className="size-3.5 animate-spin" />}
          {status === "cancelled" && <Ban className="size-3.5" />}
          <span className="truncate">
            {status === "failed" || status === "cancelled" ? (item.error ?? STATUS_TEXT[status]) : STATUS_TEXT[status]}
          </span>
        </p>
        {status === "completed" && item.publicUrl && (
          <a href={item.publicUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-xs text-accent hover:underline">
            {item.publicUrl}
          </a>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {status === "completed" && item.publicUrl && (
          <>
            <CopyButton text={item.publicUrl} />
            <a
              href={item.publicUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open PDF"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ExternalLink className="size-4" />
            </a>
          </>
        )}
        {status === "failed" && item.duplicate && (
          <Button size="sm" variant="soft" onClick={() => onRetry(item.id, { allowDuplicate: true })}>
            Upload anyway
          </Button>
        )}
        {(status === "failed" || status === "cancelled") && !item.duplicate && !item.invalid && (
          <Button size="sm" variant="secondary" onClick={() => onRetry(item.id)}>
            <RotateCcw /> Retry
          </Button>
        )}
        {(status === "uploading" || status === "processing" || status === "validating") && (
          <Button size="sm" variant="ghost" onClick={() => onCancel(item.id)}>
            Cancel
          </Button>
        )}
        {status !== "uploading" && status !== "processing" && (
          <Button size="icon-sm" variant="ghost" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name}`}>
            <X />
          </Button>
        )}
      </div>
    </li>
  );
});

// ------------------------------------------------------------------ page
export function BulkUpload() {
  const cfg = useAsync(() => api<{ limits: EffectiveLimits; publicDomain: string | null }>("/api/v1/config"), []);
  const limits = React.useMemo(
    () =>
      cfg.data
        ? {
            maxFileSizeBytes: cfg.data.limits.maxFileSizeBytes,
            maxFilesPerBatch: cfg.data.limits.maxFilesPerBatch,
            concurrency: cfg.data.limits.uploadConcurrency,
          }
        : null,
    [cfg.data],
  );
  const q = useUploadQueue(limits);
  const { summary, items } = q;
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const dirInput = React.useRef<HTMLInputElement>(null);

  const ingest = React.useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const { added, skipped } = q.addFiles(files);
      if (skipped.length) {
        const dup = skipped.filter((s) => s.reason === "Already in the queue").length;
        const full = skipped.length - dup;
        if (dup) toast.info(`${dup} file${dup === 1 ? " was" : "s were"} already in the queue`);
        if (full) toast.warning(`${full} file${full === 1 ? "" : "s"} skipped: batch limit of ${limits?.maxFilesPerBatch} reached`);
      }
      if (added) toast.success(`${added} file${added === 1 ? "" : "s"} added`);
    },
    [q, limits],
  );

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    ingest(await filesFromDrop(e.dataTransfer));
  };

  // Announce when a run finishes.
  const prevActive = React.useRef(0);
  React.useEffect(() => {
    if (prevActive.current > 0 && summary.active === 0 && summary.startable === 0) {
      const { completed, failed } = summary.counts;
      if (failed > 0) toast.warning(`${completed} uploaded, ${failed} failed. You can retry the failed files.`);
      else if (completed > 0) toast.success(`All ${completed} file${completed === 1 ? "" : "s"} uploaded`);
    }
    prevActive.current = summary.active;
  }, [summary]);

  const completed = items.filter((i) => i.status === "completed" && i.publicUrl);
  const finishedCount = items.filter((i) => isTerminal(i.status)).length;
  const failedCount = summary.counts.failed;
  const running = summary.active > 0;
  const hasWork = summary.startable > 0;

  return (
    <>
      <PageHeader
        title="Bulk Upload"
        description="Drop your PDFs and get a public link for every file."
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-[13px] text-[#7a4a00]">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <b>Public by design.</b> Anyone who has a file&apos;s URL can open it without signing in. You can revoke or delete any link later from Link Manager.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          if (--dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "group relative overflow-hidden rounded-2xl border-2 border-dashed bg-surface transition-all duration-200",
          dragging ? "scale-[1.01] border-accent bg-accent-soft shadow-pop" : "border-line-strong hover:border-accent/60",
          items.length > 0 ? "px-6 py-6" : "px-6 py-14",
        )}
      >
        <div className={cn("flex items-center gap-5", items.length === 0 && "flex-col text-center")}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform duration-200",
              items.length > 0 ? "size-12" : "size-16",
              dragging && "-translate-y-1 scale-110",
            )}
          >
            <UploadCloud className={items.length > 0 ? "size-6" : "size-8"} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold tracking-tight text-ink">
              {dragging ? "Drop to add your PDFs" : "Drag & drop PDFs here"}
            </p>
            <p className="mt-1 text-sm text-muted">or choose files from your computer. You can also drop a whole folder.</p>
            {cfg.loading && !limits ? (
              <Skeleton className="mx-auto mt-3 h-5 w-72" />
            ) : limits ? (
              <p className="mt-3 text-xs text-faint">
                PDF only · up to {formatBytes(limits.maxFileSizeBytes, 0)} each · {limits.maxFilesPerBatch} files per batch · {limits.concurrency} uploads at a time
              </p>
            ) : (
              <p className="mt-3 text-xs text-danger">Couldn&apos;t load upload limits. Reload the page.</p>
            )}
          </div>
          <div className={cn("flex shrink-0 gap-2", items.length === 0 && "mt-1")}>
            <Button size="lg" onClick={() => fileInput.current?.click()} disabled={!limits}>
              <UploadCloud /> Select PDFs
            </Button>
            <Button size="lg" variant="secondary" onClick={() => dirInput.current?.click()} disabled={!limits}>
              <FolderUp /> Folder
            </Button>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            ingest([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <input
          ref={dirInput}
          type="file"
          // @ts-expect-error non-standard but widely supported directory picker
          webkitdirectory=""
          multiple
          hidden
          onChange={(e) => {
            ingest([...(e.target.files ?? [])].filter((f) => /\.pdf$/i.test(f.name)));
            e.target.value = "";
          }}
        />
      </div>

      {/* Queue */}
      {items.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <div className="border-b border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink tabular-nums">
                  {summary.counts.completed} of {summary.total} uploaded
                  {running && <span className="ml-2 font-normal text-muted">· {summary.counts.uploading} in progress</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {[
                    summary.counts.pending && `${summary.counts.pending} waiting`,
                    failedCount && `${failedCount} failed`,
                    summary.counts.cancelled && `${summary.counts.cancelled} cancelled`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || (running ? "Working…" : "Done")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasWork && (
                  <Button onClick={() => void q.start()} disabled={!limits}>
                    <UploadCloud /> Upload {summary.startable} file{summary.startable === 1 ? "" : "s"}
                  </Button>
                )}
                {items.some((i) => i.status === "failed" && !i.invalid && !i.duplicate) && !running && (
                  <Button variant="secondary" onClick={q.retryAllFailed}>
                    <RotateCcw /> Retry failed
                  </Button>
                )}
                {(running || hasWork) && (
                  <Button variant="secondary" onClick={q.cancelPending}>
                    <Ban /> Cancel {running ? "all" : "pending"}
                  </Button>
                )}
                {finishedCount > 0 && !running && (
                  <Button variant="ghost" onClick={q.clearFinished}>
                    <Trash2 /> Clear finished
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={summary.overall} tone={failedCount && !running ? "warn" : "accent"} active={running} label="Overall batch progress" />
              <span className="w-11 shrink-0 text-right text-xs font-medium text-ink tabular-nums">{Math.round(summary.overall)}%</span>
            </div>
          </div>

          {completed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-success-soft/60 px-4 py-3 animate-fade-in">
              <CheckCircle2 className="size-4 text-success" />
              <p className="mr-auto text-[13px] font-medium text-success">
                {completed.length} link{completed.length === 1 ? "" : "s"} ready
              </p>
              <CopyButton
                variant="secondary"
                size="sm"
                label="Copy all links"
                text={() => completed.map((c) => c.publicUrl).join("\n")}
              />
              {q.batchId && (
                <>
                  <ExportMenu getBody={() => ({ batchId: q.batchId })} variant="secondary" />
                  <Link href={`/dashboard/history/${q.batchId}`} className="text-[13px] font-medium text-accent hover:underline">
                    Open batch
                  </Link>
                </>
              )}
            </div>
          )}

          <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
            {items.map((it) => (
              <Row key={it.id} item={it} onRemove={q.remove} onCancel={q.cancelItem} onRetry={q.retry} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export { isActive };
