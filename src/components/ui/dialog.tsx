"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  side,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  hideClose?: boolean;
  side?: "left";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 border border-line bg-surface shadow-pop focus:outline-none",
          side === "left"
            ? "inset-y-0 left-0 w-72 animate-slide-in"
            : "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 animate-pop-in",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className={side ? "sr-only" : "text-base font-semibold tracking-tight text-ink"}>
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className={side ? "sr-only" : "mt-1 text-sm text-muted"}>
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
