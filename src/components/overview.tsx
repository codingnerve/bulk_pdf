"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, FileStack, HardDrive, Link2, UploadCloud, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { CopyButton, PageHeader, PdfIcon } from "@/components/shared";
import { ActivityChart, StorageChart } from "@/components/charts";
import { useUser } from "@/components/app-shell";
import { useAsync } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { formatBytes, formatDate } from "@/lib/utils";
import type { OverviewStats } from "@/types/api";

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "accent",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "accent" | "success" | "danger";
}) {
  const tones = { accent: "bg-accent-soft text-accent", success: "bg-success-soft text-success", danger: "bg-danger-soft text-danger" };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={`flex size-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </Card>
  );
}

export function Overview() {
  const user = useUser();
  const { data, error, loading, reload } = useAsync(() => api<OverviewStats>("/api/v1/stats"), []);

  const copyRecent = async () => {
    try {
      const urls = (data?.recentUploads ?? []).filter((f) => f.publicUrl).map((f) => f.publicUrl);
      if (!urls.length) return toast.info("No active links to copy yet");
      if (await copyText(urls.join("\n"))) toast.success(`Copied ${urls.length} recent link${urls.length === 1 ? "" : "s"}`);
      else toast.error("Copy failed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const t = data?.totals;
  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Here's what's happening with your PDFs."
        actions={
          <>
            <Button variant="secondary" onClick={copyRecent} disabled={!data}>
              <Copy /> Copy recent links
            </Button>
            <LinkButton href="/dashboard/files" variant="secondary">
              <FileStack /> View all files
            </LinkButton>
            <LinkButton href="/dashboard/upload">
              <UploadCloud /> Upload PDFs
            </LinkButton>
          </>
        }
      />

      {error && !data && (
        <Card className="mb-6 border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Couldn&apos;t load your statistics: {error.message}{" "}
          <button className="font-medium underline" onClick={() => reload()}>
            Retry
          </button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading && !data
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
          : t && (
              <>
                <Stat icon={FileStack} label="Total PDFs" value={t.totalPdfs.toLocaleString()} hint="Uploaded and verified" />
                <Stat icon={HardDrive} label="Storage used" value={formatBytes(t.storageUsedBytes)} hint="Across all your files" />
                <Stat icon={Link2} label="Active public links" value={t.activeLinks.toLocaleString()} hint={t.totalPdfs - t.activeLinks > 0 ? `${t.totalPdfs - t.activeLinks} revoked` : "Anyone with a link can open it"} />
                <Stat icon={CheckCircle2} label="Successful uploads" value={t.successfulUploads.toLocaleString()} tone="success" hint={t.inProgress ? `${t.inProgress} in progress` : undefined} />
                <Stat icon={AlertTriangle} label="Failed uploads" value={t.failedUploads.toLocaleString()} tone={t.failedUploads ? "danger" : "accent"} hint={t.failedUploads ? "See All Files → Failed" : "Nothing to fix"} />
              </>
            )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Storage usage" description="Cumulative size, last 30 days" />
          <CardBody>{data ? <StorageChart data={data.storageSeries} /> : <Skeleton className="h-[190px]" />}</CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Upload activity"
            description="Files uploaded per day"
            action={
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-accent" />Uploaded</span>
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-danger" />Failed</span>
              </div>
            }
          />
          <CardBody>{data ? <ActivityChart data={data.activitySeries} /> : <Skeleton className="h-[190px]" />}</CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent uploads"
          action={
            <Link href="/dashboard/files" className="text-[13px] font-medium text-accent hover:underline">
              View all
            </Link>
          }
        />
        <div className="mt-3">
          {!data ? (
            <div className="space-y-3 p-5 pt-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : data.recentUploads.length === 0 ? (
            <EmptyState
              icon={<UploadCloud />}
              title="No uploads yet"
              description="Drop your first PDFs on the Bulk Upload page to get public links."
              action={<LinkButton href="/dashboard/upload">Upload PDFs</LinkButton>}
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {data.recentUploads.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                  <PdfIcon />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{f.displayName}</p>
                    <p className="truncate text-xs text-faint">
                      {formatBytes(f.size)} · {formatDate(f.uploadedAt)}
                    </p>
                  </div>
                  {f.publicUrl ? (
                    <>
                      <a href={f.publicUrl} target="_blank" rel="noreferrer" className="hidden max-w-[260px] truncate font-mono text-xs text-accent hover:underline md:block">
                        {f.publicUrl}
                      </a>
                      <CopyButton text={f.publicUrl} />
                    </>
                  ) : (
                    <span className="text-xs text-warn">Revoked</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
