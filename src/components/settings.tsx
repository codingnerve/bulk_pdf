"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe, Laptop, LogOut, Puzzle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared";
import { useAsync } from "@/hooks/use-api";
import { api, del, errorMessage, patch, post } from "@/lib/api-client";
import { passwordSchema } from "@/lib/validators/password-rule";
import { formatDate } from "@/lib/utils";
import type { SessionInfo, SettingsPayload } from "@/types/api";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-md">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ profile
function Profile({ data, onSaved }: { data: SettingsPayload; onSaved: () => void }) {
  const schema = z.object({ name: z.string().trim().min(1, "Name is required").max(100) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<{ name: string }>({ resolver: zodResolver(schema), defaultValues: { name: data.profile.name } });
  return (
    <Card>
      <CardHeader title="Profile" description="How you appear in PDFLinker." />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async (v) => {
            try {
              await patch("/api/v1/settings", { name: v.name });
              toast.success("Profile updated");
              reset(v);
              onSaved();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-name">Full name</Label>
              <Input id="p-name" aria-invalid={!!errors.name} {...register("name")} />
              <FieldError message={errors.name?.message} />
            </div>
            <div>
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" value={data.profile.email} disabled readOnly />
            </div>
          </div>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save profile
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ password
const pwSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

function Password() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  return (
    <Card>
      <CardHeader title="Password" description="Changing it signs you out of all other devices." />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async ({ currentPassword, newPassword }) => {
            try {
              await post("/api/v1/auth/change-password", { currentPassword, newPassword });
              toast.success("Password changed");
              reset();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="pw-cur">Current password</Label>
              <Input id="pw-cur" type="password" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...register("currentPassword")} />
              <FieldError message={errors.currentPassword?.message} />
            </div>
            <div>
              <Label htmlFor="pw-new">New password</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...register("newPassword")} />
              <FieldError message={errors.newPassword?.message} />
            </div>
            <div>
              <Label htmlFor="pw-conf">Confirm new password</Label>
              <Input id="pw-conf" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
              <FieldError message={errors.confirm?.message} />
            </div>
          </div>
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ storage + limits
function StorageAndLinks({ data, onSaved }: { data: SettingsPayload; onSaved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await patch("/api/v1/settings", body);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Storage & public links" description="How new uploads are published." />
      <CardBody className="divide-y divide-line">
        <Row label="Public storage domain" hint="Set by your administrator with the R2_PUBLIC_DOMAIN environment variable. Storage credentials never reach the browser.">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 font-mono text-[13px] text-ink">
            <Globe className="size-4 text-faint" />
            <span className="truncate">{data.publicDomain ?? "Not configured"}</span>
          </div>
        </Row>
        <Row label="Make new uploads public" hint="When off, new files are stored privately and have no URL until you restore public access.">
          <Switch checked={data.settings.defaultPublic} disabled={busy} onCheckedChange={(v) => save({ defaultPublic: v })} aria-label="Make new uploads public" />
        </Row>
        <Row label="Browser behaviour" hint="Open PDFs in the browser tab, or force a download when the link is opened.">
          <Select
            value={data.settings.contentDisposition}
            disabled={busy}
            onChange={(e) => save({ contentDisposition: e.target.value })}
            aria-label="Content disposition"
          >
            <option value="inline">Open in browser (inline)</option>
            <option value="attachment">Download (attachment)</option>
          </Select>
        </Row>
      </CardBody>
      <div className="mx-5 mb-5 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-[#7a4a00]">
        <b>Heads up:</b> public links are not protected. Anyone who has a URL can open the PDF without signing in, until you revoke the link or delete the file.
      </div>
    </Card>
  );
}

function Limits({ data, onSaved }: { data: SettingsPayload; onSaved: () => void }) {
  const s = data.serverLimits;
  const num = (label: string, max: number) =>
    z
      .string()
      .refine((v) => v === "" || (/^\d+$/.test(v) && +v >= 1 && +v <= max), `${label}: enter 1–${max} or leave blank`);
  const schema = z.object({
    maxFileSizeMb: num("File size", s.maxFileSizeMb),
    maxFilesPerBatch: num("Files per batch", s.maxFilesPerBatch),
    uploadConcurrency: num("Concurrency", 16),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      maxFileSizeMb: data.settings.maxFileSizeMb?.toString() ?? "",
      maxFilesPerBatch: data.settings.maxFilesPerBatch?.toString() ?? "",
      uploadConcurrency: data.settings.uploadConcurrency?.toString() ?? "",
    },
  });
  const toVal = (v: string) => (v === "" ? null : Number(v));
  return (
    <Card>
      <CardHeader title="Upload limits" description="You can lower the server limits for your own uploads. Leave blank to use the default." />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async (v) => {
            try {
              await patch("/api/v1/settings", {
                maxFileSizeMb: toVal(v.maxFileSizeMb),
                maxFilesPerBatch: toVal(v.maxFilesPerBatch),
                uploadConcurrency: toVal(v.uploadConcurrency),
              });
              toast.success("Upload limits saved");
              reset(v);
              onSaved();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="l-size">Max file size (MB)</Label>
              <Input id="l-size" inputMode="numeric" placeholder={String(s.maxFileSizeMb)} aria-invalid={!!errors.maxFileSizeMb} {...register("maxFileSizeMb")} />
              <FieldError message={errors.maxFileSizeMb?.message} />
              <p className="mt-1.5 text-xs text-faint">Server limit: {s.maxFileSizeMb} MB</p>
            </div>
            <div>
              <Label htmlFor="l-files">Files per batch</Label>
              <Input id="l-files" inputMode="numeric" placeholder={String(s.maxFilesPerBatch)} aria-invalid={!!errors.maxFilesPerBatch} {...register("maxFilesPerBatch")} />
              <FieldError message={errors.maxFilesPerBatch?.message} />
              <p className="mt-1.5 text-xs text-faint">Server limit: {s.maxFilesPerBatch}</p>
            </div>
            <div>
              <Label htmlFor="l-conc">Parallel uploads</Label>
              <Input id="l-conc" inputMode="numeric" placeholder={String(s.uploadConcurrency)} aria-invalid={!!errors.uploadConcurrency} {...register("uploadConcurrency")} />
              <FieldError message={errors.uploadConcurrency?.message} />
              <p className="mt-1.5 text-xs text-faint">Default: {s.uploadConcurrency} · max 16</p>
            </div>
          </div>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save limits
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ sessions
function Sessions() {
  const router = useRouter();
  const list = useAsync(() => api<{ sessions: SessionInfo[] }>("/api/v1/auth/sessions").then((d) => d.sessions), []);
  const revoke = async (id: string) => {
    try {
      await del(`/api/v1/auth/sessions/${id}`);
      toast.success("Device signed out");
      await list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const all = async () => {
    await post("/api/v1/auth/logout", { allDevices: true }).catch(() => undefined);
    router.replace("/login");
  };
  return (
    <Card>
      <CardHeader
        title="Devices & sessions"
        description="Browsers and extensions currently signed in to your account."
        action={
          <Button variant="secondary" size="sm" onClick={all}>
            <LogOut /> Sign out everywhere
          </Button>
        }
      />
      <CardBody className="space-y-2">
        {!list.data && <Skeleton className="h-14" />}
        {list.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted">
              {s.client === "extension" ? <Puzzle className="size-4" /> : <Laptop className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {s.label ?? (s.client === "extension" ? "Browser extension" : "Web browser")}
                {s.current && <Badge tone="accent" className="ml-2">This device</Badge>}
              </p>
              <p className="text-xs text-faint">Signed in {formatDate(s.createdAt)}</p>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                Revoke
              </Button>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ danger zone
function Danger() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await del("/api/v1/account", { password: pw });
      toast.success("Your account was deleted");
      router.replace("/login");
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Card className="border-danger/25">
      <CardHeader title="Danger zone" description="Permanently delete your account. Workspaces only you belong to are deleted with all their PDFs. In shared workspaces you simply leave (your uploads stay with the team); owners must transfer ownership first." />
      <CardBody>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <ShieldAlert /> Delete account
        </Button>
        <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent title="Delete your account?" description="All files are removed from cloud storage and every public link stops working. This can't be undone.">
            <div className="mt-4">
              <Label htmlFor="del-pw">Confirm with your password</Label>
              <Input id="del-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="danger" loading={busy} disabled={!pw} onClick={remove}>
                Delete everything
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardBody>
    </Card>
  );
}

export function SettingsView() {
  const settings = useAsync(() => api<SettingsPayload>("/api/v1/settings"), []);
  const d = settings.data;
  return (
    <>
      <PageHeader title="Settings" description="Profile, security, upload behaviour and connected devices." />
      {settings.error && !d && <Card className="p-6 text-sm text-danger">{settings.error.message}</Card>}
      {!d && !settings.error && (
        <div className="space-y-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-56" />
        </div>
      )}
      {d && (
        <div className="max-w-4xl space-y-5">
          <Profile key={d.profile.name} data={d} onSaved={settings.reload} />
          <Password />
          <StorageAndLinks data={d} onSaved={settings.reload} />
          <Limits key={JSON.stringify(d.settings)} data={d} onSaved={settings.reload} />
          <Sessions />
          <Danger />
        </div>
      )}
    </>
  );
}
