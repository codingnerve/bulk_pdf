"use client";

import { hardNavigate } from "@/lib/navigation";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, MailWarning, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { api, errorMessage, post } from "@/lib/api-client";
import type { PublicUser } from "@/types/api";

interface InviteInfo {
  workspaceName: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string;
}

export function InviteView() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = React.useState<InviteInfo | null>(null);
  const [error, setError] = React.useState("");
  const [me, setMe] = React.useState<PublicUser | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    api<InviteInfo>(`/api/v1/invites/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
    api<{ user: PublicUser }>("/api/v1/auth/me")
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      await post("/api/v1/invites/accept", { token });
      toast.success(`You joined ${info?.workspaceName}`);
      hardNavigate("/dashboard");
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    await post("/api/v1/auth/logout").catch(() => undefined);
    setMe(null);
  };

  const problem = error || (!token ? "This invitation link is incomplete." : "");
  if (problem) {
    return (
      <>
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <MailWarning className="size-6" />
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Invitation not valid</h1>
        <p className="mt-1.5 text-sm text-muted">{problem} Ask your workspace admin to send a new invitation.</p>
        <LinkButton href="/login" variant="secondary" className="mt-6 w-fit">
          Go to sign in
        </LinkButton>
      </>
    );
  }
  if (!info || me === undefined) return <Skeleton className="h-64" />;

  const next = `/invite?token=${encodeURIComponent(token)}`;
  const sameEmail = me?.email === info.email;

  return (
    <>
      <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Users className="size-6" />
      </div>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">Join {info.workspaceName}</h1>
      <p className="mt-1.5 text-sm text-muted">
        <b className="text-ink">{info.invitedBy}</b> invited <b className="text-ink">{info.email}</b> to share this team&apos;s PDFs and links as {info.role === "admin" ? "an admin" : "a member"}.
      </p>

      {me && sameEmail && (
        <div className="mt-8">
          <p className="mb-3 flex items-center gap-2 text-[13px] text-success">
            <CheckCircle2 className="size-4" /> Signed in as {me.email}
          </p>
          <Button size="lg" className="w-full" onClick={accept} loading={busy}>
            Join workspace
          </Button>
        </div>
      )}

      {me && !sameEmail && (
        <div className="mt-8 rounded-lg border border-warn/30 bg-warn-soft p-3.5 text-[13px] text-[#7a4a00]">
          You&apos;re signed in as <b>{me.email}</b>, but this invitation is for <b>{info.email}</b>.
          <Button variant="secondary" size="sm" className="mt-3" onClick={switchAccount}>
            Sign out and continue
          </Button>
        </div>
      )}

      {me === null && (
        <div className="mt-8 space-y-3">
          <LinkButton href={`/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(info.email)}`} size="lg" className="w-full">
            Create account to join
          </LinkButton>
          <LinkButton href={`/login?next=${encodeURIComponent(next)}`} variant="secondary" size="lg" className="w-full">
            I already have an account
          </LinkButton>
          <p className="text-center text-xs text-faint">
            Use <b>{info.email}</b> so the invitation matches.
          </p>
        </div>
      )}
      {me && (
        <button onClick={() => router.push("/dashboard")} className="mt-6 text-sm text-muted hover:text-ink">
          No thanks, go to my dashboard
        </button>
      )}
    </>
  );
}

