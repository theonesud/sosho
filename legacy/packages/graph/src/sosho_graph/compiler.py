from collections import defaultdict
from collections.abc import Callable, Mapping

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from sosho_graph.nodes.decision import DecisionConfig
from sosho_graph.registry import BoundNode, NodeContext, NodeRegistry, Services
from sosho_graph.schema import GraphDefinition, GraphEdge, GraphNode
from sosho_graph.state import Checkpointer, GraphApp, GraphState, NodeUpdate

_CONDITION_LABELS: dict[str, frozenset[str]] = {"checkpoint": frozenset({"approve", "reject"})}


class GraphBuildError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


def _bind_error(node: GraphNode, registry: NodeRegistry) -> str | None:
    kind = registry.get(node.type)
    if kind is None:
        return f"node '{node.id}': type '{node.type}' is not in the catalog"
    try:
        kind.bind(node.model_dump(by_alias=True))
    except ValidationError as error:
        details = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors()
        )
        return f"node '{node.id}' config: {details}"
    return None


def _node_errors(graph: GraphDefinition, registry: NodeRegistry) -> list[str]:
    problems = (_bind_error(node, registry) for node in graph.nodes)
    return [problem for problem in problems if problem is not None]


def _edge_condition_error(
    edge: GraphEdge, types: Mapping[str, str], branches: Mapping[str, list[str]]
) -> str | None:
    if edge.condition is None or edge.condition.strip() == "":
        return None
    label = edge.condition.strip()
    source_type = types[edge.source]
    if source_type == "decision":
        if label in branches.get(edge.source, []):
            return None
        return f"edge '{edge.id}' condition '{label}' is not a branch of '{edge.source}'"
    allowed = _CONDITION_LABELS.get(source_type)
    if allowed is not None and label in allowed:
        return None
    return f"edge '{edge.id}' condition '{label}' is not allowed on '{edge.source}' ({source_type})"


def _edge_problems(
    edge: GraphEdge, types: Mapping[str, str], branches: Mapping[str, list[str]]
) -> list[str]:
    problems = [
        f"edge '{edge.id}' references unknown node '{end}'"
        for end in (edge.source, edge.target)
        if end not in types
    ]
    if edge.source in types:
        condition_problem = _edge_condition_error(edge, types, branches)
        if condition_problem is not None:
            problems.append(condition_problem)
    return problems


def _edge_errors(
    graph: GraphDefinition, types: Mapping[str, str], branches: Mapping[str, list[str]]
) -> list[str]:
    return [problem for edge in graph.edges for problem in _edge_problems(edge, types, branches)]


def _decision_branches(graph: GraphDefinition) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for node in graph.nodes:
        if node.type != "decision":
            continue
        try:
            found[node.id] = DecisionConfig.model_validate(node.model_dump(by_alias=True)).branches
        except ValidationError:
            continue
    return found


def validate_graph(graph: GraphDefinition, registry: NodeRegistry) -> list[str]:
    errors: list[str] = []
    ids = [node.id for node in graph.nodes]
    if len(set(ids)) != len(ids):
        errors.append("duplicate node id")
    types = {node.id: node.type for node in graph.nodes}
    if graph.entry_node not in types:
        errors.append(f"entryNode '{graph.entry_node}' does not exist in nodes")
    branches = _decision_branches(graph)
    errors.extend(_edge_errors(graph, types, branches))
    errors.extend(_mixed_edge_errors(graph))
    errors.extend(_node_errors(graph, registry))
    return errors


def _mixed_edge_errors(graph: GraphDefinition) -> list[str]:
    conditional: dict[str, bool] = defaultdict(bool)
    plain: dict[str, bool] = defaultdict(bool)
    for edge in graph.edges:
        if edge.condition and edge.condition.strip():
            conditional[edge.source] = True
        else:
            plain[edge.source] = True
    return [
        f"node '{source}' mixes conditional and unconditional outgoing edges"
        for source in conditional
        if plain[source]
    ]


def _router(
    source: str, targets_by_label: Mapping[str, list[str]]
) -> Callable[[GraphState], list[str]]:
    def route(state: GraphState) -> list[str]:
        label = state["branches"].get(source)
        if label is None:
            return [END]
        return targets_by_label.get(label) or [END]

    return route


class _NodeAdapter:
    def __init__(self, node_id: str, bound: BoundNode, services: Services) -> None:
        self._node_id = node_id
        self._bound = bound
        self._services = services

    async def __call__(self, state: GraphState, config: RunnableConfig) -> NodeUpdate:
        return await self._bound(NodeContext(self._node_id, state, self._services, config))


def compile_graph(
    graph: GraphDefinition,
    registry: NodeRegistry,
    services: Services,
    checkpointer: Checkpointer,
) -> GraphApp:
    errors = validate_graph(graph, registry)
    if errors:
        raise GraphBuildError(errors)
    builder: StateGraph[GraphState, None, GraphState, GraphState] = StateGraph(GraphState)
    for node in graph.nodes:
        kind = registry.get(node.type)
        if kind is None:
            raise GraphBuildError([f"type '{node.type}' is not in the catalog"])
        bound = kind.bind(node.model_dump(by_alias=True))
        builder.add_node(node.id, _NodeAdapter(node.id, bound, services))
    builder.add_edge(START, graph.entry_node)
    _add_edges(builder, graph)
    return builder.compile(checkpointer=checkpointer)


def _add_edges(
    builder: StateGraph[GraphState, None, GraphState, GraphState], graph: GraphDefinition
) -> None:
    outgoing: dict[str, list[GraphEdge]] = defaultdict(list)
    for edge in graph.edges:
        outgoing[edge.source].append(edge)
    for source, edges in outgoing.items():
        if any(edge.condition and edge.condition.strip() for edge in edges):
            targets: dict[str, list[str]] = defaultdict(list)
            for edge in edges:
                if edge.condition is not None:
                    targets[edge.condition.strip()].append(edge.target)
            all_targets = sorted({edge.target for edge in edges})
            builder.add_conditional_edges(source, _router(source, targets), [*all_targets, END])
            continue
        for edge in edges:
            builder.add_edge(source, edge.target)
