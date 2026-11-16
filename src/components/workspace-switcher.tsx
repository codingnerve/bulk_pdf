"use client";

import { hardNavigate } from "@/lib/navigation";
import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Label } from "@/components/ui/input";
import { api, errorMessage, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { WorkspaceInfo, WorkspaceSummary } from "@/types/api";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export function WorkspaceSwitcher({ current }: { current: WorkspaceInfo }) {
  const [list, setList] = React.useState<WorkspaceSummary[] | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = () => {
    api<{ workspaces: WorkspaceSummary[] }>("/api/v1/workspaces")
      .then((d) => setList(d.workspaces))
      .catch(() => undefined);
  };

  const choose = async (id: string) => {
    if (id === current.id) return;
    try {
      await post("/api/v1/workspaces/active", { workspaceId: id });
      hardNavigate("/dashboard"); // full reload: every view re-fetches in the new workspace
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && load()}>
        <DropdownMenuTrigger asChild>
          <button
            className="mb-4 flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            aria-label="Switch workspace"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
              {current.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{current.name}</span>
              <span className="block text-[11.5px] leading-tight text-faint">
                {ROLE_LABEL[current.role]} · {current.memberCount} member{current.memberCount === 1 ? "" : "s"}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {!list && <p className="px-2.5 py-2 text-[13px] text-muted">Loading…</p>}
          {list?.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => choose(w.id)} className="justify-between">
              <span className="min-w-0">
                <span className={cn("block truncate", w.current && "font-semibold")}>{w.name}</span>
                <span className="text-xs text-faint">
                  {ROLE_LABEL[w.role]} · {w.memberCount} member{w.memberCount === 1 ? "" : "s"}
                </span>
              </span>
              {w.current && <Check className="!text-accent" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspace open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateWorkspace({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await post("/api/v1/workspaces", { name: name.trim() });
      hardNavigate("/dashboard/team");
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="New workspace" description="A separate shared library of PDFs. You'll be its owner and can invite teammates.">
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Marketing team" autoFocus />
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              Create workspace
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
