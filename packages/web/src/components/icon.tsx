import type { SVGProps } from "react";
import { type IconName, iconPaths } from "./icon-paths";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  readonly name: IconName;
  readonly size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
