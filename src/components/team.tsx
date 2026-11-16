"use client";

import { hardNavigate } from "@/lib/navigation";
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { ConfirmDialog, CopyButton, PageHeader, td, th } from "@/components/shared";
import { useWorkspace } from "@/components/app-shell";
import { useAsync } from "@/hooks/use-api";
import { api, del, errorMessage, patch, post } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { InviteDto, MemberDto, WorkspaceRole } from "@/types/api";

const ROLE_TONE = { owner: "accent", admin: "success", member: "neutral" } as const;
const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

const PERMISSIONS: [string, string][] = [
  ["Upload PDFs, view and copy every link, export, download", "Everyone"],
  ["Rename, revoke and delete their own uploads", "Members"],
  ["Rename, revoke and delete anyone's uploads", "Admins & owner"],
  ["Invite members and remove members", "Admins & owner"],
  ["Promote or demote admins, transfer ownership", "Owner"],
];

export function TeamView() {
  const router = useRouter();
  const ws = useWorkspace();
  const members = useAsync(() => api<{ members: MemberDto[] }>("/api/v1/workspaces/current/members").then((d) => d.members), [ws.id]);
  const invites = useAsync(
    () => (ws.isAdmin ? api<{ invites: InviteDto[] }>("/api/v1/workspaces/current/invites").then((d) => d.invites) : Promise.resolve([] as InviteDto[])),
    [ws.id, ws.isAdmin],
  );
  const [removing, setRemoving] = React.useState<MemberDto | null>(null);
  const [transfer, setTransfer] = React.useState<MemberDto | null>(null);
  const [renaming, setRenaming] = React.useState(false);

  const refresh = () => {
    void members.reload();
    void invites.reload();
    ws.refresh();
  };

  const setRole = async (m: MemberDto, role: WorkspaceRole) => {
    if (role === "owner") return setTransfer(m);
    try {
      await patch(`/api/v1/workspaces/current/members/${m.userId}`, { role });
      toast.success(`${m.name} is now ${ROLE_LABEL[role].toLowerCase()}`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      void members.reload();
    }
  };

  const remove = async (m: MemberDto) => {
    try {
      await del(`/api/v1/workspaces/current/members/${m.userId}`);
      if (m.you) {
        toast.success("You left the workspace");
        hardNavigate("/dashboard");
        return;
      }
      toast.success(`${m.name} was removed`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const canEdit = (m: MemberDto) => ws.isAdmin && m.role !== "owner" && !m.you && (ws.role === "owner" || m.role === "member");
  const me = members.data?.find((m) => m.you);

  return (
    <>
      <PageHeader
        title="Team"
        description={
          <>
            Everyone in <b className="text-ink">{ws.name}</b> shares one library of PDFs and links.
          </>
        }
        actions={
          ws.isAdmin && (
            <Button variant="secondary" onClick={() => setRenaming(true)}>
              <Pencil /> Rename workspace
            </Button>
          )
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader title={`Members${members.data ? ` (${members.data.length})` : ""}`} className="pb-4" />
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[560px] text-left">
                <thead className="bg-surface-2/50">
                  <tr>
                    <th className={th}>Member</th>
                    <th className={th}>Role</th>
                    <th className={th}>Joined</th>
                    <th className={`${th} text-right`} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {!members.data &&
                    Array.from({ length: 3 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={4} className="px-4 py-3">
                          <Skeleton className="h-9" />
                        </td>
                      </tr>
                    ))}
                  {members.data?.map((m) => (
                    <tr key={m.userId}>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
                            {m.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {m.name} {m.you && <span className="font-normal text-faint">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-faint">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        {canEdit(m) ? (
                          <Select
                            value={m.role}
                            onChange={(e) => setRole(m, e.target.value as WorkspaceRole)}
                            className="h-8 w-36 text-[13px]"
                            aria-label={`Role for ${m.name}`}
                          >
                            <option value="member">Member</option>
                            {(ws.role === "owner" || m.role === "admin") && <option value="admin">Admin</option>}
                            {ws.role === "owner" && <option value="owner">Owner (transfer)</option>}
                          </Select>
                        ) : (
                          <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(m.joinedAt, false)}</td>
                      <td className={`${td} text-right`}>
                        {canEdit(m) && (ws.role === "owner" || m.role === "member") && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)}>
                            <Trash2 />
                          </Button>
                        )}
                        {m.you && m.role !== "owner" && (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                            <LogOut /> Leave
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {me?.role === "owner" && members.data && members.data.length > 1 && (
              <p className="border-t border-line px-4 py-3 text-xs text-muted">
                You&apos;re the owner. To leave or delete your account, transfer ownership to another member first.
              </p>
            )}
          </Card>

          {ws.isAdmin && (
            <Card>
              <CardHeader title="Invite teammates" description="Create a one-time link and send it to them. It expires in 7 days." />
              <CardBody className="space-y-5">
                <InviteForm ownerCanInviteAdmins={ws.role === "owner"} onCreated={() => void invites.reload()} />
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink">Pending invitations</p>
                  {!invites.data ? (
                    <Skeleton className="h-12" />
                  ) : invites.data.length === 0 ? (
                    <p className="text-[13px] text-muted">No pending invitations.</p>
                  ) : (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {invites.data.map((i) => (
                        <li key={i.id} className="flex items-center gap-3 px-3.5 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{i.email}</p>
                            <p className="text-xs text-faint">
                              {ROLE_LABEL[i.role]} · expires {formatDate(i.expiresAt, false)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await del(`/api/v1/workspaces/current/invites/${i.id}`);
                                toast.success("Invitation revoked");
                                void invites.reload();
                              } catch (e) {
                                toast.error(errorMessage(e));
                              }
                            }}
                          >
                            Revoke
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
          {!ws.isAdmin && members.data && members.data.length === 0 && (
            <Card>
              <EmptyState icon={<UserPlus />} title="No members" />
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="What each role can do" />
          <CardBody>
            <ul className="space-y-3">
              {PERMISSIONS.map(([what, who]) => (
                <li key={what} className="flex items-start justify-between gap-3 text-[13px]">
                  <span className="text-ink">{what}</span>
                  <Badge tone={who === "Everyone" ? "success" : who === "Members" ? "neutral" : "accent"} className="shrink-0">
                    {who}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.you ? "Leave this workspace?" : `Remove ${removing?.name}?`}
        confirmLabel={removing?.you ? "Leave workspace" : "Remove member"}
        danger
        description={
          removing?.you
            ? "You'll lose access to this workspace's files. PDFs you uploaded stay with the team."
            : "They lose access immediately. PDFs they uploaded stay in the workspace."
        }
        onConfirm={() => remove(removing!)}
      />
      <ConfirmDialog
        open={!!transfer}
        onOpenChange={(o) => !o && setTransfer(null)}
        title={`Make ${transfer?.name} the owner?`}
        confirmLabel="Transfer ownership"
        description="They become the owner with full control. You'll become an admin. Only the new owner can reverse this."
        onConfirm={async () => {
          try {
            await patch(`/api/v1/workspaces/current/members/${transfer!.userId}`, { role: "owner" });
            toast.success("Ownership transferred");
            refresh();
            router.refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <RenameDialog open={renaming} onOpenChange={setRenaming} current={ws.name} onSaved={ws.refresh} />
    </>
  );
}

function InviteForm({ ownerCanInviteAdmins, onCreated }: { ownerCanInviteAdmins: boolean; onCreated: () => void }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"member" | "admin">("member");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [link, setLink] = React.useState<{ email: string; url: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { invite } = await post<{ invite: { email: string; link: string } }>("/api/v1/workspaces/current/invites", { email, role });
      setLink({ email: invite.email, url: invite.link });
      setEmail("");
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="inv-email">Email address</Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
        </div>
        <div className="sm:w-36">
          <Label htmlFor="inv-role">Role</Label>
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">Member</option>
            {ownerCanInviteAdmins && <option value="admin">Admin</option>}
          </Select>
        </div>
        <Button type="submit" loading={busy}>
          <UserPlus /> Create invite
        </Button>
      </form>
      <FieldError message={error} />
      {link && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-3.5 animate-fade-in">
          <p className="text-[13px] font-medium text-success">Invite ready for {link.email}</p>
          <p className="mt-0.5 text-xs text-muted">Send them this link. It is shown only now. They must register or sign in with that exact email.</p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-2.5 py-1.5 font-mono text-xs text-ink">{link.url}</code>
            <CopyButton text={link.url} label="Invite link" variant="secondary" size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

function RenameDialog({ open, onOpenChange, current, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; current: string; onSaved: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Rename workspace" description="Everyone in the workspace will see the new name.">
        {open && <RenameForm current={current} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await patch("/api/v1/workspaces/current", { name: name.trim() });
          toast.success("Workspace renamed");
          onSaved();
          onClose();
        } catch (err) {
          toast.error(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus aria-label="Workspace name" />
      <div className="mt-5 flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
