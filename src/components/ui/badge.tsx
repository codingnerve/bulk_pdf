import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-muted",
        accent: "bg-accent-soft text-accent-strong",
        success: "bg-success-soft text-success",
        danger: "bg-danger-soft text-danger",
        warn: "bg-warn-soft text-warn",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {props.children}
    </span>
  );
}

const STATUS_TONE: Record<string, { tone: "neutral" | "accent" | "success" | "danger" | "warn"; label: string }> = {
  pending: { tone: "neutral", label: "Pending" },
  validating: { tone: "neutral", label: "Validating" },
  uploading: { tone: "accent", label: "Uploading" },
  processing: { tone: "warn", label: "Processing" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "danger", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  revoked: { tone: "warn", label: "Revoked" },
  partial: { tone: "warn", label: "Partial" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_TONE[status] ?? { tone: "neutral" as const, label: status };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
