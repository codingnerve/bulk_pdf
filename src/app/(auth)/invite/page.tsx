import { Suspense } from "react";
import type { Metadata } from "next";
import { InviteView } from "@/components/invite";

export const metadata: Metadata = { title: "Team invitation" };

export default function InvitePage() {
  return (
    <Suspense>
      <InviteView />
    </Suspense>
  );
}
