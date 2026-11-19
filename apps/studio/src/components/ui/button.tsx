"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-45 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-zinc-950 hover:bg-emerald-400 active:bg-emerald-500 font-semibold",
        secondary:
          "bg-elevated text-text-primary border border-border-subtle hover:border-border-strong hover:bg-zinc-800/80 active:bg-zinc-800",
        ghost: "text-text-secondary hover:text-text-primary hover:bg-elevated active:bg-zinc-800",
        danger:
          "bg-error/15 text-red-400 border border-error/30 hover:bg-error/25 hover:border-error/50 active:bg-error/30",
        warning:
          "bg-warning/15 text-amber-300 border border-warning/35 hover:bg-warning/25 hover:border-warning/50",
      },
      size: {
        xs: "h-6 px-2 text-[11px]",
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8 px-3 text-[12px]",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "sm",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
