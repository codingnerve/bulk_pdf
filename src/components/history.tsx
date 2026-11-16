"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Copy, History as HistoryIcon, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, Skeleton } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { CopyButton, ExportMenu, PageHeader, Pagination, PdfIcon, td, th } from "@/components/shared";
import { useAsync } from "@/hooks/use-api";
import { api, apiList, errorMessage, post } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { formatBytes, formatDate } from "@/lib/utils";
import type { BatchDto, FileDto } from "@/types/api";

export function HistoryList() {
  const [page, setPage] = React.useState(1);
  const list = useAsync(() => apiList<BatchDto>(`/api/v1/batches?page=${page}&pageSize=15`), [page]);
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader title="Upload History" description="Every upload batch. Reopen one to copy or export its links." />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-line bg-surface-2/50">
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Files</th>
                <th className={th}>Successful</th>
                <th className={th}>Failed</th>
                <th className={th}>Total size</th>
                <th className={th}>By</th>
                <th className={th}>Date</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!list.data &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={9} className="px-4 py-3">
                      <Skeleton className="h-8" />
                    </td>
                  </tr>
                ))}
              {items.map((b) => (
                <tr key={b.id} className="transition-colors hover:bg-surface-2/50">
                  <td className={td}>
                    <Link href={`/dashboard/history/${b.batchId}`} className="font-mono text-xs font-medium text-accent hover:underline">
                      {b.batchId}
                    </Link>
                  </td>
                  <td className={`${td} tabular-nums`}>{b.totalFiles}</td>
                  <td className={`${td} tabular-nums text-success`}>{b.successfulFiles}</td>
                  <td className={`${td} tabular-nums ${b.failedFiles ? "text-danger" : "text-faint"}`}>{b.failedFiles}</td>
                  <td className={`${td} tabular-nums text-muted`}>{formatBytes(b.totalSize)}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{b.createdBy.name}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(b.createdAt)}</td>
                  <td className={td}>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className={`${td} text-right`}>
                    <LinkButton href={`/dashboard/history/${b.batchId}`} variant="secondary" size="sm">
                      Open
                    </LinkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.error && !list.data && <p className="p-6 text-center text-sm text-danger">{list.error.message}</p>}
        {list.data && items.length === 0 && (
          <EmptyState
            icon={<HistoryIcon />}
            title="No upload batches yet"
            description="Each time you upload PDFs, a batch is recorded here."
            action={<LinkButton href="/dashboard/upload"><UploadCloud /> Upload PDFs</LinkButton>}
          />
        )}
        {list.data && items.length > 0 && <Pagination pagination={list.data.pagination} onPage={setPage} noun="batches" />}
      </Card>
    </>
  );
}

type BatchDetail = BatchDto & { files: FileDto[] };

export function BatchView({ batchId }: { batchId: string }) {
  const detail = useAsync(() => api<{ batch: BatchDetail }>(`/api/v1/batches/${batchId}`).then((d) => d.batch), [batchId]);
  const b = detail.data;
  const links = (b?.files ?? []).filter((f) => f.publicUrl);

  const copyAll = async () => {
    try {
      const r = await post<{ count: number; text: string }>("/api/v1/links/bulk-copy-data", { ids: links.map((l) => l.id) });
      if (await copyText(r.text)) toast.success(`Copied ${r.count} link${r.count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Link href="/dashboard/history" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Upload History
      </Link>
      <PageHeader
        title={b ? `Batch ${b.batchId}` : "Batch"}
        description={b ? `Uploaded ${formatDate(b.createdAt)}` : undefined}
        actions={
          b && (
            <>
              <Button variant="secondary" onClick={copyAll} disabled={!links.length}>
                <Copy /> Copy all links
              </Button>
              <ExportMenu getBody={() => ({ batchId: b.batchId })} disabled={!links.length} />
            </>
          )
        }
      />

      {detail.error && !b && <Card className="p-6 text-sm text-danger">{detail.error.message}</Card>}

      {b && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Files", String(b.totalFiles)],
              ["Successful", String(b.successfulFiles)],
              ["Failed / cancelled", String(b.failedFiles)],
              ["Total size", formatBytes(b.totalSize)],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">Files</span>
              <StatusBadge status={b.status} />
            </div>
            <ul className="divide-y divide-line">
              {b.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <PdfIcon />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.displayName}</p>
                    <p className="truncate text-xs text-faint">
                      {formatBytes(f.size)}
                      {f.errorMessage && <span className="text-danger"> · {f.errorMessage}</span>}
                    </p>
                  </div>
                  {f.publicUrl ? (
                    <>
                      <a href={f.publicUrl} target="_blank" rel="noreferrer" className="hidden max-w-[280px] truncate font-mono text-xs text-accent hover:underline md:block">
                        {f.publicUrl}
                      </a>
                      <CopyButton text={f.publicUrl} />
                    </>
                  ) : (
                    <StatusBadge status={f.uploadStatus === "completed" ? "revoked" : f.uploadStatus} />
                  )}
                </li>
              ))}
            </ul>
            {b.files.length === 0 && <CardBody className="text-center text-sm text-muted">This batch has no files.</CardBody>}
          </Card>
        </>
      )}
      {!b && !detail.error && <Skeleton className="h-64" />}
    </>
  );
}
