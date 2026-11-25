import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none tracking-tight tabular-nums border",
  {
    variants: {
      variant: {
        neutral: "bg-elevated text-text-secondary border-border-subtle",
        accent: "bg-accent/15 text-emerald-300 border-accent/30",
        info: "bg-info/15 text-sky-300 border-info/30",
        warning: "bg-warning/15 text-amber-300 border-warning/35",
        error: "bg-error/15 text-red-300 border-error/35",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
