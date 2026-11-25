"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md border border-border-strong bg-elevated px-2.5 py-1 text-[11px] font-medium text-text-primary shadow-[0_6px_20px_rgba(0,0,0,0.5)]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
