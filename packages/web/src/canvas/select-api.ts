import type { Selection } from "../state/selection";

export interface SelectApi {
  readonly set: (selection: Selection) => void;
  readonly toggle: (id: string) => void;
  readonly many: (ids: readonly string[]) => void;
}
