"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import { downloadExport, errorMessage, type ExportFormat } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Pagination as PaginationT } from "@/types/api";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CopyButton({
  text,
  label,
  size = "icon-sm",
  variant = "ghost",
  className,
  onCopied,
}: {
  text: string | (() => Promise<string> | string);
  label?: string;
  size?: "icon-sm" | "sm" | "md";
  variant?: "ghost" | "secondary" | "soft";
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const click = async () => {
    setState("busy");
    try {
      const value = typeof text === "function" ? await text() : text;
      if (!value) {
        toast.error("Nothing to copy");
        setState("idle");
        return;
      }
      const ok = await copyText(value);
      if (ok) {
        setState("done");
        toast.success(label ? `${label} copied` : "Link copied");
        onCopied?.();
        setTimeout(() => setState("idle"), 1600);
      } else {
        toast.error("Copy failed. Select the text and copy manually.");
        setState("idle");
      }
    } catch (e) {
      toast.error(errorMessage(e));
      setState("idle");
    }
  };
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={click}
      aria-label={label ?? "Copy link"}
      title={label ?? "Copy link"}
    >
      {state === "busy" ? <Loader2 className="animate-spin" /> : state === "done" ? <Check className="text-success" /> : <Copy />}
      {size !== "icon-sm" && (label ?? "Copy")}
    </Button>
  );
}

export function ExportMenu({
  getBody,
  disabled,
  label = "Export",
  variant = "secondary",
}: {
  getBody: () => { ids?: string[]; batchId?: string; includeAll?: boolean };
  disabled?: boolean;
  label?: string;
  variant?: "secondary" | "soft" | "ghost";
}) {
  const [busy, setBusy] = React.useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat) => {
    setBusy(format);
    try {
      const n = await downloadExport(format, getBody());
      if (n === 0) toast.info("Nothing to export yet. Only successful uploads with active links are included.");
      else toast.success(`Exported ${n} link${n === 1 ? "" : "s"} as ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="md" disabled={disabled || !!busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Export links as</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => run("csv")}>
          <FileText /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("xlsx")}>
          <FileSpreadsheet /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("txt")}>
          <FileText /> Plain text (URLs only)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Pagination({
  pagination,
  onPage,
  noun = "items",
}: {
  pagination: PaginationT;
  onPage: (p: number) => void;
  noun?: string;
}) {
  const { page, pageSize, total, totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
      <span className="tabular-nums">
        {from}–{to} of {total.toLocaleString()} {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {page} / {totalPages}
        </span>
        <Button variant="secondary" size="icon-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title}>
        <div className="mt-2 text-sm text-muted">{description}</div>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft/60 px-4 py-2.5 animate-fade-in">
      <span className="text-[13px] font-medium text-accent-strong tabular-nums">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button onClick={onClear} className="ml-auto text-[13px] text-muted hover:text-ink">
        Clear
      </button>
    </div>
  );
}

export const th = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-faint whitespace-nowrap";
export const td = "px-4 py-3 align-middle text-[13px]";

export function PdfIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-[10px] font-bold tracking-wide text-danger", className)}>
      PDF
    </span>
  );
}
