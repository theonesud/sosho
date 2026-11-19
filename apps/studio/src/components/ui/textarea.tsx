import type * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[72px] w-full rounded-md border border-border-subtle bg-canvas px-2.5 py-2 text-[12px] text-text-primary placeholder:text-text-muted transition-colors duration-150 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y",
        className,
      )}
      {...props}
    />
  );
}
