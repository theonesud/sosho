import { Button } from "@ui-sdk/react/button";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

interface IconTipProps {
  readonly icon: IconName;
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly className?: string;
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly onClick: () => void;
}

export function IconTip({
  icon,
  label,
  shortcut,
  disabled = false,
  pressed,
  className,
  side = "bottom",
  onClick,
}: IconTipProps) {
  return (
    <Tooltip {...(shortcut ? { shortcut } : {})}>
      <TooltipTrigger
        render={
          <Button
            data-variant="ghost"
            aria-label={label}
            disabled={disabled}
            {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
            onClick={onClick}
            {...(className ? { className } : {})}
          />
        }
      >
        <Icon name={icon} />
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut ? <TooltipShortcut /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
