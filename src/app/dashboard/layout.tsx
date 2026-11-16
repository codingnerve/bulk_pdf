import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell";

// The dashboard is an auth-gated client app: the shell resolves the session client-side and
// every page streams its data from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

// Static shell: auth state is resolved client-side through /api/v1/auth/me, so nothing
// here reads request data. The shell uses usePathname(), which under Cache Components
// must sit behind a Suspense boundary.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
