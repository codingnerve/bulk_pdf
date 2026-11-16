import { cn } from "@/lib/utils";

export function Progress({
  value,
  tone = "accent",
  active = false,
  className,
  label,
}: {
  value: number;
  tone?: "accent" | "success" | "danger" | "warn";
  active?: boolean;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const color = {
    accent: "bg-accent",
    success: "bg-success",
    danger: "bg-danger",
    warn: "bg-warn",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", color, active && "progress-active")}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
