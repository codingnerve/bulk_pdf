import type { Metadata } from "next";
import { BulkUpload } from "@/components/bulk-upload";

export const metadata: Metadata = { title: "Bulk Upload" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function UploadPage() {
  return <BulkUpload />;
}
