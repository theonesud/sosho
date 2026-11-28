import { useState } from "react";

interface PendingDelete {
  readonly id: string;
  readonly name: string;
}

type DeleteState =
  | { readonly kind: "closed" }
  | { readonly kind: "asking"; readonly target: PendingDelete; readonly error: string | null }
  | { readonly kind: "deleting"; readonly target: PendingDelete };

export function useDeleteFlow(onRemove: (id: string, name: string) => Promise<string | null>) {
  const [state, setState] = useState<DeleteState>({ kind: "closed" });
  const target = state.kind === "closed" ? null : state.target;
  const ask = (id: string, name: string) =>
    setState({ kind: "asking", target: { id, name }, error: null });
  const cancel = () => setState({ kind: "closed" });
  const confirm = async () => {
    if (state.kind !== "asking") return;
    const { target: current } = state;
    setState({ kind: "deleting", target: current });
    const failure = await onRemove(current.id, current.name);
    setState(
      failure === null ? { kind: "closed" } : { kind: "asking", target: current, error: failure },
    );
  };
  const error = state.kind === "asking" ? state.error : null;
  return { target, error, pending: state.kind === "deleting", ask, cancel, confirm };
}
