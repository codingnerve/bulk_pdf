"use client";

import * as React from "react";
import { DropdownMenu as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-pop animate-pop-in",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item> & { danger?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-faint",
        danger
          ? "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger"
          : "text-ink data-[highlighted]:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className }: { className?: string }) => (
  <Primitive.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} />
);

export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Primitive.Label>) => (
  <Primitive.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-faint", className)} {...props} />
);
