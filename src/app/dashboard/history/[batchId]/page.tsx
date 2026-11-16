import { Suspense } from "react";
import type { Metadata } from "next";
import { BatchView } from "@/components/history";
import { Skeleton } from "@/components/ui/card";

export const metadata: Metadata = { title: "Batch details" };

// Auth-gated client app: data streams from /api/v1, so instant-navigation validation does not apply.
export const instant = false;

export default function BatchPage({ params }: PageProps<"/dashboard/history/[batchId]">) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Batch params={params} />
    </Suspense>
  );
}

// `params` is request-time data under Cache Components, so it is read behind a Suspense boundary.
async function Batch({ params }: { params: PageProps<"/dashboard/history/[batchId]">["params"] }) {
  const { batchId } = await params;
  return <BatchView batchId={batchId} />;
}
