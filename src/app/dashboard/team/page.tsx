import type { Metadata } from "next";
import { TeamView } from "@/components/team";

export const metadata: Metadata = { title: "Team" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function TeamPage() {
  return <TeamView />;
}
