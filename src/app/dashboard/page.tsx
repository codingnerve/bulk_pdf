import type { Metadata } from "next";
import { Overview } from "@/components/overview";

export const metadata: Metadata = { title: "Overview" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function DashboardPage() {
  return <Overview />;
}
