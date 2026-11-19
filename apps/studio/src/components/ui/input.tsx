import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded-md border border-border-subtle bg-canvas px-2.5 py-1 text-[12px] text-text-primary placeholder:text-text-muted transition-colors duration-150 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
