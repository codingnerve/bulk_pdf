import type { Metadata } from "next";
import { SettingsView } from "@/components/settings";

export const metadata: Metadata = { title: "Settings" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function SettingsPage() {
  return <SettingsView />;
}
