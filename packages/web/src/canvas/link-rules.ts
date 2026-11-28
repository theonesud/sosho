import type { NodeKind } from "../api/types";

type TargetRule = (target: string) => boolean;

const TARGET_RULES: Partial<Record<NodeKind, TargetRule>> = {
  trigger: (target) => target !== "trigger",
};

export function validTargets<T extends { readonly kind: string }>(
  source: NodeKind,
  kinds: readonly T[],
): readonly T[] {
  const rule = TARGET_RULES[source];
  return rule ? kinds.filter((entry) => rule(entry.kind)) : kinds;
}
