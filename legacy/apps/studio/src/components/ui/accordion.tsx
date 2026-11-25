"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn("border-t border-border-subtle", className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "flex flex-1 items-center justify-between py-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary [&[data-state=open]>svg]:rotate-180 cursor-pointer",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-150" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content className="overflow-hidden text-[12px]" {...props}>
      <div className={cn("pb-3 pt-1 space-y-2.5", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
