import type { Metadata } from "next";
import { HistoryList } from "@/components/history";

export const metadata: Metadata = { title: "Upload History" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function HistoryPage() {
  return <HistoryList />;
}
