import type { CSSProperties } from "react";

export type CssVars = Readonly<Record<`--${string}`, string | number>>;

export function cssVars(vars: CssVars): CSSProperties {
  return Object.assign<CSSProperties, CssVars>({}, vars);
}
