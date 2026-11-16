"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Bell, BookOpen, CheckCircle2, ChevronsUpDown, Clock, FileStack, History, LayoutDashboard, Link2, LogOut, Menu, Settings, UploadCloud, Users } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/card";
import { api, ApiClientError, post } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { OverviewStats, PublicUser, WorkspaceInfo } from "@/types/api";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/upload", label: "Bulk Upload", icon: UploadCloud },
  { href: "/dashboard/files", label: "All Files", icon: FileStack },
  { href: "/dashboard/links", label: "Link Manager", icon: Link2 },
  { href: "/dashboard/history", label: "Upload History", icon: History },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const UserContext = React.createContext<PublicUser | null>(null);
export const useUser = () => {
  const u = React.useContext(UserContext);
  if (!u) throw new Error("useUser must be used inside the dashboard");
  return u;
};

const WorkspaceContext = React.createContext<{ workspace: WorkspaceInfo; refresh: () => void } | null>(null);
export const useWorkspace = () => {
  const w = React.useContext(WorkspaceContext);
  if (!w) throw new Error("useWorkspace must be used inside the dashboard");
  return { ...w.workspace, isAdmin: w.workspace.role !== "member", refresh: w.refresh };
};

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />}
            <Icon className={cn("size-[18px]", active ? "text-accent" : "text-faint group-hover:text-muted")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto space-y-3 pt-6">
      <a
        href="/api/v1/docs"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <BookOpen className="size-4 text-faint" /> API documentation
      </a>
      <p className="px-3 text-[11.5px] leading-relaxed text-faint">
        Links are public: anyone with a URL can open the PDF until you revoke or delete it.
      </p>
    </div>
  );
}

function Notifications() {
  const [stats, setStats] = React.useState<OverviewStats | null>(null);
  const load = React.useCallback(() => {
    api<OverviewStats>("/api/v1/stats").then(setStats).catch(() => undefined);
  }, []);
  React.useEffect(load, [load]);
  const failed = stats?.totals.failedUploads ?? 0;
  const inProgress = stats?.totals.inProgress ?? 0;
  return (
    <DropdownMenu onOpenChange={(o) => o && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell />
          {failed > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-danger ring-2 ring-surface" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        {!stats && <p className="px-2.5 py-3 text-[13px] text-muted">Loading…</p>}
        {stats && failed === 0 && inProgress === 0 && stats.recentUploads.length === 0 && (
          <p className="px-2.5 py-3 text-[13px] text-muted">You&apos;re all caught up.</p>
        )}
        {failed > 0 && (
          <Link href="/dashboard/files?status=failed">
            <DropdownMenuItem>
              <AlertTriangle className="!text-danger" />
              <span>
                <b>{failed}</b> failed upload{failed === 1 ? "" : "s"} need attention
              </span>
            </DropdownMenuItem>
          </Link>
        )}
        {inProgress > 0 && (
          <DropdownMenuItem>
            <Clock className="!text-warn" />
            <span>
              <b>{inProgress}</b> upload{inProgress === 1 ? "" : "s"} in progress
            </span>
          </DropdownMenuItem>
        )}
        {stats?.recentUploads.slice(0, 4).map((f) => (
          <DropdownMenuItem key={f.id} className="items-start">
            <CheckCircle2 className="mt-0.5 !text-success" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{f.displayName}</span>
              <span className="text-xs text-faint">Uploaded {formatDate(f.uploadedAt)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-surface-2" aria-label="Account menu">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{initials}</span>
          <span className="hidden text-left sm:block">
            <span className="block text-[13px] font-medium leading-tight text-ink">{user.name}</span>
            <span className="block max-w-40 truncate text-[11.5px] leading-tight text-faint">{user.email}</span>
          </span>
          <ChevronsUpDown className="hidden size-3.5 text-faint sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-faint">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <Link href="/dashboard/settings">
          <DropdownMenuItem>
            <Settings /> Settings
          </DropdownMenuItem>
        </Link>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface p-5 lg:block">
        <Skeleton className="mb-8 h-8 w-36" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="mb-2 h-9 w-full" />
        ))}
      </aside>
      <div className="flex-1 p-8">
        <Skeleton className="mb-6 h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = React.useState<PublicUser | null>(null);
  const [workspace, setWorkspace] = React.useState<WorkspaceInfo | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const refreshWorkspace = React.useCallback(() => {
    api<{ user: PublicUser; workspace: WorkspaceInfo }>("/api/v1/auth/me")
      .then((d) => setWorkspace(d.workspace))
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    api<{ user: PublicUser; workspace: WorkspaceInfo }>("/api/v1/auth/me")
      .then((d) => {
        if (cancelled) return;
        setUser(d.user);
        setWorkspace(d.workspace);
      })
      .catch(async (e) => {
        if (cancelled) return;
        if (e instanceof ApiClientError && e.status === 401) {
          await post("/api/v1/auth/logout").catch(() => undefined); // clears stale cookies
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await post("/api/v1/auth/logout").catch(() => undefined);
    router.replace("/login");
  };

  if (!user || !workspace) return <ShellSkeleton />;

  const current = NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)));

  return (
    <UserContext.Provider value={user}>
      <WorkspaceContext.Provider value={{ workspace, refresh: refreshWorkspace }}>
      <div className="min-h-screen lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
          <Link href="/dashboard" className="mb-5 px-3">
            <Logo />
          </Link>
          <WorkspaceSwitcher current={workspace} />
          <NavLinks />
          <SidebarFooter />
        </aside>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent side="left" title="Navigation" hideClose className="flex flex-col px-3 py-5">
            <Link href="/dashboard" className="mb-5 px-3" onClick={() => setMobileOpen(false)}>
              <Logo />
            </Link>
            <WorkspaceSwitcher current={workspace} />
            <NavLinks onNavigate={() => setMobileOpen(false)} />
            <SidebarFooter />
          </DialogContent>
        </Dialog>

        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <span className="text-sm font-medium text-ink lg:hidden">{current?.label ?? "PDFLinker"}</span>
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <UserMenu user={user} onLogout={logout} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
      </WorkspaceContext.Provider>
    </UserContext.Provider>
  );
}
