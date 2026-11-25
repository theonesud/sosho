from dataclasses import dataclass, field

from pydantic import JsonValue

from sosho_engine.errors import LoopLimitError
from sosho_engine.graph import adjacency, incoming_edges, reachable
from sosho_engine.spec import Edge, Workflow
from sosho_engine.tools import JsonDict

DONE = "done"
SKIPPED = "skipped"
TAKEN = "taken"
DEAD = "dead"


@dataclass
class RunState:
    spec: Workflow
    run_input: JsonDict
    statuses: dict[str, str] = field(default_factory=dict[str, str])
    outputs: dict[str, JsonDict] = field(default_factory=dict[str, JsonDict])
    edge_states: dict[int, str] = field(default_factory=dict[int, str])
    loop_counts: dict[int, int] = field(default_factory=dict[int, int])
    executions: dict[str, int] = field(default_factory=dict[str, int])

    def incoming(self) -> dict[str, list[int]]:
        return incoming_edges(self.spec.edges, include_loops=False)


def new_state(spec: Workflow, trigger_id: str, run_input: JsonDict) -> RunState:
    state = RunState(spec=spec, run_input=run_input)
    for node in spec.nodes:
        if node.kind != "trigger":
            continue
        if node.id == trigger_id:
            complete(state, node.id, run_input)
        else:
            skip(state, node.id)
    return state


def _branch_matches(edge: Edge, output: JsonDict) -> bool:
    return edge.when is None or output.get("branch") == edge.when


def skip(state: RunState, node_id: str) -> None:
    state.statuses[node_id] = SKIPPED
    for index, edge in enumerate(state.spec.edges):
        if edge.source == node_id and not edge.loop:
            state.edge_states[index] = DEAD


def complete(state: RunState, node_id: str, output: JsonDict) -> None:
    state.statuses[node_id] = DONE
    state.outputs[node_id] = output
    state.executions[node_id] = state.executions.get(node_id, 0) + 1
    for index, edge in enumerate(state.spec.edges):
        if edge.source != node_id or edge.loop:
            continue
        taken = _branch_matches(edge, output)
        state.edge_states[index] = TAKEN if taken else DEAD
    for index, edge in enumerate(state.spec.edges):
        if edge.source == node_id and edge.loop and _branch_matches(edge, output):
            _take_loop(state, index, edge)


def _take_loop(state: RunState, index: int, edge: Edge) -> None:
    count = state.loop_counts.get(index, 0) + 1
    if count > (edge.max_iterations or 0):
        raise LoopLimitError(f"loop {edge.source} to {edge.target} passed {edge.max_iterations}")
    state.loop_counts[index] = count
    plain = adjacency(state.spec.edges, include_loops=False)
    region = reachable([edge.target], plain)
    for node_id in region:
        state.statuses.pop(node_id, None)
    for edge_index, other in enumerate(state.spec.edges):
        if other.source in region:
            state.edge_states.pop(edge_index, None)


def settle(state: RunState) -> list[str]:
    incoming = state.incoming()
    while True:
        ready: list[str] = []
        changed = False
        for node in state.spec.nodes:
            if node.id in state.statuses:
                continue
            states = [state.edge_states.get(index) for index in incoming.get(node.id, [])]
            if not states or None in states:
                continue
            if TAKEN in states:
                ready.append(node.id)
            else:
                skip(state, node.id)
                changed = True
        if not changed:
            return sorted(ready)


def node_data(state: RunState, node_id: str) -> dict[str, JsonValue]:
    outputs: dict[str, JsonValue] = {key: dict(value) for key, value in state.outputs.items()}
    iteration = state.executions.get(node_id, 0)
    run_input: JsonValue = dict(state.run_input)
    return {"input": run_input, "nodes": outputs, "loop": {"iteration": iteration}}


def join_inputs(state: RunState, node_id: str) -> tuple[dict[str, JsonValue], list[str]]:
    taken: dict[str, JsonValue] = {}
    dead: list[str] = []
    for index in state.incoming().get(node_id, []):
        source = state.spec.edges[index].source
        if state.edge_states.get(index) == TAKEN:
            taken[source] = dict(state.outputs[source])
        else:
            dead.append(source)
    return taken, sorted(dead)


def terminal_outputs(state: RunState) -> dict[str, JsonValue]:
    has_out = {edge.source for edge in state.spec.edges}
    return {
        node.id: dict(state.outputs[node.id])
        for node in state.spec.nodes
        if node.id not in has_out and state.statuses.get(node.id) == DONE
    }
