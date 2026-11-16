import { Suspense } from "react";
import type { Metadata } from "next";
import { FileManager } from "@/components/file-manager";

export const metadata: Metadata = { title: "All Files" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function FilesPage() {
  return (
    <Suspense>
      <FileManager mode="files" />
    </Suspense>
  );
}
