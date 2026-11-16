"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, Copy, Download, ExternalLink, Eye, FileStack, Link2, Loader2, MoreHorizontal, Pencil, RotateCcw, Search, ShieldCheck, ShieldOff, Trash2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Select } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
import { ConfirmDialog, CopyButton, ExportMenu, PageHeader, Pagination, PdfIcon, SelectionBar, td, th } from "@/components/shared";
import { useAsync, useDebounced, useSelection } from "@/hooks/use-api";
import { useUser } from "@/components/app-shell";
import { apiList, del, errorMessage, patch, post, api } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import type { FileDto } from "@/types/api";

type Mode = "files" | "links";

const PAGE_SIZE = 20;

interface Verify {
  ok: boolean;
  at: string | Date | null;
  busy?: boolean;
  error?: string | null;
}

export function FileManager({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const user = useUser();
  const [mine, setMine] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState(params.get("status") ?? "");
  const [visibility, setVisibility] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState("newest");
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim(), 300);

  const qs = React.useMemo(() => {
    const p = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (mine) p.set("uploadedBy", user.id);
    if (mode === "files") {
      if (status) p.set("status", status);
      if (visibility !== "all") p.set("visibility", visibility);
    }
    return p.toString();
  }, [q, from, to, sort, page, status, visibility, mode, mine, user.id]);

  const list = useAsync(() => apiList<FileDto>(`/api/v1/${mode}?${qs}`), [mode, qs]);
  const items = React.useMemo(() => list.data?.items ?? [], [list.data]);
  const pagination = list.data?.pagination;
  const sel = useSelection(React.useMemo(() => items.map((i) => i.id), [items]));

  // reset to page 1 whenever a filter changes
  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
    sel.clear();
  };

  const [verifies, setVerifies] = React.useState<Record<string, Verify>>({});
  const [renaming, setRenaming] = React.useState<FileDto | null>(null);
  const [deleting, setDeleting] = React.useState<FileDto[] | null>(null);
  const [revoking, setRevoking] = React.useState<FileDto[] | null>(null);
  const [preview, setPreview] = React.useState<FileDto | null>(null);

  const verify = async (f: FileDto) => {
    setVerifies((v) => ({ ...v, [f.id]: { ok: false, at: null, busy: true } }));
    try {
      const r = await post<{ ok: boolean; checkedAt: string; error: string | null }>(`/api/v1/links/${f.id}/verify`);
      setVerifies((v) => ({ ...v, [f.id]: { ok: r.ok, at: r.checkedAt, error: r.error } }));
      if (r.ok) toast.success(`Link is live: ${f.displayName}`);
      else toast.error(`Link check failed: ${r.error ?? "unreachable"}`);
    } catch (e) {
      setVerifies((v) => ({ ...v, [f.id]: { ok: false, at: null } }));
      toast.error(errorMessage(e));
    }
  };

  const verifyState = (f: FileDto): Verify | null =>
    verifies[f.id] ?? (f.lastVerifiedAt ? { ok: !!f.lastVerifyOk, at: f.lastVerifiedAt } : null);

  const copyIds = async (ids: string[] | "all") => {
    try {
      const r = await post<{ count: number; text: string }>(
        "/api/v1/links/bulk-copy-data",
        ids === "all" ? { all: true } : { ids },
      );
      if (!r.count) return toast.info("No active public links in this selection");
      if (await copyText(r.text)) toast.success(`Copied ${r.count} link${r.count === 1 ? "" : "s"}`);
      else toast.error("Copy failed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const download = async (f: FileDto) => {
    try {
      const { url } = await api<{ url: string }>(`/api/v1/files/${f.id}/download`);
      window.location.assign(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doDelete = async (files: FileDto[]) => {
    try {
      if (files.length === 1) await del(`/api/v1/files/${files[0].id}`);
      else {
        const r = await post<{ deleted: string[]; failed: unknown[] }>("/api/v1/files/bulk-delete", { ids: files.map((f) => f.id) });
        if (r.failed.length) toast.warning(`Deleted ${r.deleted.length}; ${r.failed.length} could not be removed from storage`);
      }
      toast.success(files.length === 1 ? "File deleted" : `Deleted ${files.length} files`);
      sel.clear();
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doRevoke = async (files: FileDto[]) => {
    let ok = 0;
    for (const f of files) {
      try {
        await post(`/api/v1/links/${f.id}/revoke`);
        ok++;
      } catch (e) {
        toast.error(`${f.displayName}: ${errorMessage(e)}`);
      }
    }
    if (ok) toast.success(`Revoked ${ok} link${ok === 1 ? "" : "s"}. The public URL${ok === 1 ? " now returns" : "s now return"} 404.`);
    sel.clear();
    await list.reload();
  };

  const restore = async (f: FileDto) => {
    try {
      await post(`/api/v1/links/${f.id}/restore`);
      toast.success("Public access restored");
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const selectedFiles = items.filter((i) => sel.selected.has(i.id));
  const filtersActive = !!(q || from || to || status || mine || visibility !== "all");
  const colSpan = mode === "files" ? 9 : 7;

  return (
    <>
      <PageHeader
        title={mode === "files" ? "All Files" : "Link Manager"}
        description={
          mode === "files"
            ? "Every PDF you've uploaded, with its public link and status."
            : "All active public links. Check, copy, preview or revoke them."
        }
        actions={
          mode === "links" ? (
            <>
              <Button variant="secondary" onClick={() => copyIds("all")}>
                <Copy /> Copy all links
              </Button>
              <ExportMenu getBody={() => ({})} label="Export all" />
            </>
          ) : (
            <>
              <ExportMenu getBody={() => ({ includeAll: false })} label="Export links" />
              <LinkButton href="/dashboard/upload">
                <UploadCloud /> Upload PDFs
              </LinkButton>
            </>
          )
        }
      />

      <Card className="overflow-hidden">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-4">
          <div className="relative min-w-52 flex-1 sm:max-w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)}
              placeholder="Search by filename…"
              className="pl-9"
              aria-label="Search by filename"
            />
          </div>
          {mode === "files" && (
            <>
              <Select value={status} onChange={(e) => setFilter(setStatus)(e.target.value)} className="w-36" aria-label="Filter by status">
                <option value="">All statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="uploading">Uploading</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
              <Select value={visibility} onChange={(e) => setFilter(setVisibility)(e.target.value)} className="w-36" aria-label="Filter by visibility">
                <option value="all">Any visibility</option>
                <option value="public">Public</option>
                <option value="revoked">Revoked</option>
              </Select>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => setFilter(setFrom)(e.target.value)} className="w-[9.5rem]" aria-label="From date" />
            <span className="text-xs text-faint">to</span>
            <Input type="date" value={to} onChange={(e) => setFilter(setTo)(e.target.value)} className="w-[9.5rem]" aria-label="To date" />
          </div>
          <Select value={mine ? "mine" : "all"} onChange={(e) => setFilter(setMine)(e.target.value === "mine")} className="w-40" aria-label="Filter by uploader">
            <option value="all">Everyone&apos;s files</option>
            <option value="mine">Uploaded by me</option>
          </Select>
          <Select value={sort} onChange={(e) => setFilter(setSort)(e.target.value)} className="w-32" aria-label="Sort order">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setMine(false);
                setStatus("");
                setVisibility("all");
                setFrom("");
                setTo("");
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
        </div>

        <SelectionBar count={sel.count} onClear={sel.clear}>
          <Button size="sm" variant="secondary" onClick={() => copyIds([...sel.selected])}>
            <Copy /> Copy links
          </Button>
          <ExportMenu getBody={() => ({ ids: [...sel.selected] })} variant="secondary" label="Export selected" />
          {mode === "links" && (
            <Button size="sm" variant="secondary" onClick={() => setRevoking(selectedFiles)}>
              <ShieldOff /> Revoke
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setDeleting(selectedFiles)}>
            <Trash2 /> Delete
          </Button>
        </SelectionBar>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-line bg-surface-2/50">
              <tr>
                <th className={cn(th, "w-10")}>
                  <Checkbox
                    checked={sel.allOnPage ? true : sel.someOnPage ? "indeterminate" : false}
                    onCheckedChange={sel.toggleAll}
                    aria-label="Select all on this page"
                  />
                </th>
                <th className={th}>File</th>
                <th className={th}>Size</th>
                <th className={th}>Uploaded</th>
                <th className={th}>By</th>
                {mode === "files" && <th className={th}>Status</th>}
                <th className={th}>Public URL</th>
                {mode === "files" && <th className={th}>Location</th>}
                <th className={cn(th, "sticky right-0 w-28 bg-[#f9fafd] text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.loading && !list.data &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={colSpan} className="px-4 py-3">
                      <Skeleton className="h-9" />
                    </td>
                  </tr>
                ))}
              {items.map((f) => {
                const v = verifyState(f);
                const live = f.uploadStatus === "completed";
                return (
                  <tr key={f.id} className={cn("transition-colors hover:bg-surface-2/50", sel.selected.has(f.id) && "bg-accent-soft/40", list.loading && "opacity-60")}>
                    <td className={td}>
                      <Checkbox checked={sel.selected.has(f.id)} onCheckedChange={() => sel.toggle(f.id)} aria-label={`Select ${f.displayName}`} />
                    </td>
                    <td className={cn(td, "max-w-[280px]")}>
                      <div className="flex items-center gap-3">
                        <PdfIcon />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink" title={f.displayName}>
                            {f.displayName}
                          </p>
                          {f.displayName !== f.originalName ? (
                            <p className="truncate text-xs text-faint" title={f.originalName}>
                              {f.originalName}
                            </p>
                          ) : f.errorMessage ? (
                            <p className="truncate text-xs text-danger" title={f.errorMessage}>
                              {f.errorMessage}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className={cn(td, "whitespace-nowrap text-muted tabular-nums")}>{formatBytes(f.size)}</td>
                    <td className={cn(td, "whitespace-nowrap text-muted")}>{formatDate(f.uploadedAt ?? f.createdAt)}</td>
                    <td className={cn(td, "max-w-[120px] truncate whitespace-nowrap text-muted")} title={f.uploadedBy.name}>
                      {f.uploadedBy.id === user.id ? "You" : f.uploadedBy.name}
                    </td>
                    {mode === "files" && (
                      <td className={td}>
                        {live && !f.isPublic ? <StatusBadge status="revoked" /> : <StatusBadge status={f.uploadStatus} />}
                      </td>
                    )}
                    <td className={cn(td, "max-w-[260px]")}>
                      {f.publicUrl ? (
                        <div className="flex items-center gap-1.5">
                          <a href={f.publicUrl} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-accent hover:underline" title={f.publicUrl}>
                            {f.publicUrl.replace(/^https?:\/\//, "")}
                          </a>
                          {mode === "links" && v && (
                            <span title={v.ok ? `Verified ${formatDate(v.at)}` : (v.error ?? "Link check failed")}>
                              {v.busy ? <Loader2 className="size-3.5 animate-spin text-faint" /> : v.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-faint">{live ? "Access revoked" : "—"}</span>
                      )}
                    </td>
                    {mode === "files" && (
                      <td className={cn(td, "max-w-[180px] truncate font-mono text-xs text-faint")} title={f.storageLocation}>
                        {f.storageLocation}
                      </td>
                    )}
                    <td className={cn(td, "sticky right-0 bg-surface text-right shadow-[-8px_0_8px_-8px_rgb(11_18_48/0.08)]")}>
                      <div className="flex items-center justify-end gap-0.5">
                        {f.publicUrl && <CopyButton text={f.publicUrl} />}
                        {mode === "links" && f.publicUrl && (
                          <Button size="icon-sm" variant="ghost" onClick={() => setPreview(f)} aria-label="Preview" title="Preview">
                            <Eye />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${f.displayName}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {f.publicUrl && (
                              <DropdownMenuItem onSelect={() => window.open(f.publicUrl, "_blank", "noopener,noreferrer")}>
                                <ExternalLink /> Open PDF
                              </DropdownMenuItem>
                            )}
                            {f.publicUrl && (
                              <DropdownMenuItem onSelect={() => copyText(f.publicUrl).then(() => toast.success("Link copied"))}>
                                <Copy /> Copy URL
                              </DropdownMenuItem>
                            )}
                            {f.publicUrl && (
                              <DropdownMenuItem onSelect={() => verify(f)}>
                                <ShieldCheck /> Check accessibility
                              </DropdownMenuItem>
                            )}
                            {live && (
                              <DropdownMenuItem onSelect={() => download(f)}>
                                <Download /> Download
                              </DropdownMenuItem>
                            )}
                            {f.canManage && (
                              <DropdownMenuItem onSelect={() => setRenaming(f)}>
                                <Pencil /> Rename
                              </DropdownMenuItem>
                            )}
                            {f.canManage && live && f.isPublic && (
                              <DropdownMenuItem onSelect={() => setRevoking([f])}>
                                <ShieldOff /> Revoke public access
                              </DropdownMenuItem>
                            )}
                            {f.canManage && live && !f.isPublic && (
                              <DropdownMenuItem onSelect={() => restore(f)}>
                                <RotateCcw /> Restore public access
                              </DropdownMenuItem>
                            )}
                            {f.canManage && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem danger onSelect={() => setDeleting([f])}>
                                  <Trash2 /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {list.error && !list.data && (
          <div className="p-6 text-center text-sm text-danger">
            {list.error.message}{" "}
            <button className="font-medium underline" onClick={() => list.reload()}>
              Retry
            </button>
          </div>
        )}
        {list.data && items.length === 0 && (
          <EmptyState
            icon={mode === "files" ? <FileStack /> : <Link2 />}
            title={filtersActive ? "No matching files" : mode === "files" ? "No files yet" : "No active links"}
            description={filtersActive ? "Try a different search or clear the filters." : "Upload PDFs to generate public links."}
            action={
              !filtersActive && (
                <LinkButton href="/dashboard/upload">
                  <UploadCloud /> Upload PDFs
                </LinkButton>
              )
            }
          />
        )}
        {pagination && items.length > 0 && <Pagination pagination={pagination} onPage={(p) => { setPage(p); sel.clear(); }} noun={mode === "files" ? "files" : "links"} />}
      </Card>

      <RenameDialog file={renaming} onClose={() => setRenaming(null)} onSaved={() => list.reload()} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} files?` : "Delete this file?"}
        danger
        confirmLabel="Delete permanently"
        description={
          <>
            The PDF{deleting && deleting.length > 1 ? "s" : ""} will be removed from cloud storage and{" "}
            <b>the public link{deleting && deleting.length > 1 ? "s" : ""} will stop working</b>. This can&apos;t be undone.
          </>
        }
        onConfirm={() => doDelete(deleting!)}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking && revoking.length > 1 ? `Revoke ${revoking.length} links?` : "Revoke public access?"}
        confirmLabel="Revoke access"
        description="The public URL will return “not found” for everyone. Copies already cached by a browser or CDN can keep working for up to 5 minutes. Your file stays safe in your account and you can restore access later."
        onConfirm={() => doRevoke(revoking!)}
      />

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <DialogContent title={preview.displayName} description={preview.publicUrl} className="max-w-4xl !p-0 overflow-hidden" hideClose>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5 pr-4">
              <PdfIcon />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{preview.displayName}</p>
                <p className="truncate font-mono text-xs text-faint">{preview.publicUrl}</p>
              </div>
              <CopyButton text={preview.publicUrl} variant="secondary" size="sm" />
              <a href={preview.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
                <ExternalLink className="size-4" /> Open
              </a>
              <DialogClose asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Close preview">
                  <Ban className="size-4 rotate-45" />
                </Button>
              </DialogClose>
            </div>
            <iframe src={preview.publicUrl} title={`Preview of ${preview.displayName}`} className="h-[70vh] w-full bg-surface-2" />
            <div className="flex items-center gap-2 border-t border-line px-5 py-3">
              <Badge tone="success" dot>Public link</Badge>
              <span className="text-xs text-muted">Anyone with this URL can open this PDF.</span>
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => verify(preview)}>
                <ShieldCheck /> Check accessibility
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function RenameDialog({ file, onClose, onSaved }: { file: FileDto | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename file" description="Only the display name changes. The public URL stays the same.">
        {file && <RenameForm file={file} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ file, onClose, onSaved }: { file: FileDto; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(file.displayName);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await patch(`/api/v1/files/${file.id}`, { displayName: name.trim() });
      toast.success("Renamed");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} autoFocus aria-label="Display name" />
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
