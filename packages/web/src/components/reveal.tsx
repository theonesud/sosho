import type { ReactNode } from "react";

interface RevealProps {
  readonly show: boolean;
  readonly group?: boolean;
  readonly children: ReactNode;
}

export function Reveal({ show, group = false, children }: RevealProps) {
  return (
    <span
      className="reveal"
      data-show={show ? "" : undefined}
      data-group={group ? "" : undefined}
      inert={!show}
    >
      <span className="reveal-inner">{children}</span>
    </span>
  );
}
