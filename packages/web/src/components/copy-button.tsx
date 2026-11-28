import { Button } from "@ui-sdk/react/button";
import { toast } from "@ui-sdk/react/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { useEffect, useState } from "react";
import { Icon } from "./icon";

interface CopyButtonProps {
  readonly value: string;
  readonly label: string;
  readonly secret?: boolean;
}

const DONE_MS = 1600;

export function CopyButton({ value, label, secret = false }: CopyButtonProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error("Copy failed", { description: "The browser blocked clipboard access." });
      return;
    }
    setDone(true);
    toast.success("Copied to clipboard", secret ? {} : { description: value });
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<Button data-variant="ghost" aria-label={label} onClick={copy} />}>
        <span className="icon-swap" data-done={done ? "" : undefined}>
          <Icon name="copy" className="icon-idle" />
          <Icon name="check" className="icon-done" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
