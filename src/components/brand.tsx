import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#4f46e5" />
      <path d="M10 8.5h8.2L22 12.3V23a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 9 23V10a1.5 1.5 0 0 1 1-1.5Z" fill="#fff" fillOpacity=".95" />
      <path d="M18 8.5v3a1.3 1.3 0 0 0 1.3 1.3H22" fill="none" stroke="#4f46e5" strokeOpacity=".35" strokeWidth="1.2" />
      <path d="M12.5 18.2c1.2-1.9 3-1.9 4.2 0s3 1.9 4.2 0" fill="none" stroke="#4f46e5" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        PDF<span className="text-accent">Linker</span>
      </span>
    </span>
  );
}
