from sosho_memory.schema import EDGE_TABLES, NODE_TABLES

_DEFAULT_HNSW_EF: int = 40
_FIXED_EDGE_PROJECTION: str = (
    "->FixedBy[WHERE valid_to IS NONE AND out.valid_to IS NONE].* AS _fixed_edges"
)
_FIX_NODE_PROJECTION: str = (
    "->FixedBy[WHERE valid_to IS NONE]->fix[WHERE valid_to IS NONE].* AS _fixes"
)


def _validate_positive_limit(value: int, name: str) -> None:
    if isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} must be at least 1")


def _hnsw_ef(limit: int) -> int:
    return max(_DEFAULT_HNSW_EF, limit * 2)


def build_hybrid_search_query(*, include_vector: bool, include_bm25: bool, top_k: int) -> str:
    _validate_positive_limit(top_k, "top_k")
    ef = _hnsw_ef(top_k)
    statements: list[str] = [
        "BEGIN TRANSACTION;",
        "SELECT * FROM preference WHERE valid_to IS NONE LIMIT $top_k;",
    ]
    for table in NODE_TABLES:
        if include_vector:
            statements.append(
                f"SELECT *, vector::distance::knn() AS _vec_dist FROM {table} "  # noqa: S608
                f"WHERE valid_to IS NONE AND embedding <|{top_k}, {ef}|> $query_vector "
                "ORDER BY _vec_dist ASC;"
            )
        if include_bm25:
            statements.append(
                f"SELECT *, search::score(1) AS _bm25_score FROM {table} "  # noqa: S608
                "WHERE valid_to IS NONE AND content @1@ $query_text "
                "ORDER BY _bm25_score DESC LIMIT $top_k;"
            )
    statements.append("COMMIT TRANSACTION;")
    return "\n".join(statements)


def build_error_fix_query(*, include_vector: bool, include_bm25: bool, limit: int) -> str:
    _validate_positive_limit(limit, "limit")
    ef = _hnsw_ef(limit)
    projections = f"{_FIXED_EDGE_PROJECTION}, {_FIX_NODE_PROJECTION}"
    if include_vector and include_bm25:
        vector_subquery = (
            "SELECT *, vector::distance::knn() AS _vec_dist FROM error "  # noqa: S608
            f"WHERE valid_to IS NONE AND embedding <|{limit}, {ef}|> $query_vector "
            "ORDER BY _vec_dist ASC"
        )
        bm25_subquery = (
            "SELECT *, search::score(1) AS _bm25_score FROM error "
            "WHERE valid_to IS NONE AND content @1@ $query_text "
            "ORDER BY _bm25_score DESC LIMIT $limit"
        )
        return f"SELECT *, {projections} FROM ({vector_subquery}), ({bm25_subquery});"  # noqa: S608
    if include_vector:
        return (
            f"SELECT *, vector::distance::knn() AS _vec_dist, {projections} "  # noqa: S608
            f"FROM error WHERE valid_to IS NONE AND embedding <|{limit}, {ef}|> $query_vector "
            "ORDER BY _vec_dist ASC;"
        )
    if include_bm25:
        return (
            f"SELECT *, search::score(1) AS _bm25_score, {projections} "  # noqa: S608
            "FROM error WHERE valid_to IS NONE AND content @1@ $query_text "
            "ORDER BY _bm25_score DESC LIMIT $limit;"
        )
    return f"SELECT *, {projections} FROM error WHERE valid_to IS NONE LIMIT $limit;"  # noqa: S608


def _validate_tables(tables: tuple[str, ...], allowed: tuple[str, ...], kind: str) -> None:
    if not tables:
        raise ValueError(f"{kind}_tables must not be empty")
    for table in tables:
        if table not in allowed:
            raise ValueError(f"Unknown {kind} table: {table!r}")


def _build_table_selects(tables: tuple[str, ...], where_clause: str) -> str:
    return "\n".join(f"SELECT * FROM {table} WHERE {where_clause};" for table in tables)  # noqa: S608


def build_neighbors_query(edge_tables: tuple[str, ...]) -> str:
    _validate_tables(edge_tables, EDGE_TABLES, "edge")
    tables = ", ".join(edge_tables)
    return (
        f"SELECT * FROM {tables} "  # noqa: S608
        "WHERE valid_to IS NONE AND (in IN $record_ids OR out IN $record_ids);"
    )


def build_active_nodes_query(node_tables: tuple[str, ...] = NODE_TABLES) -> str:
    _validate_tables(node_tables, NODE_TABLES, "node")
    return _build_table_selects(node_tables, "valid_to IS NONE")


def build_active_edges_query(edge_tables: tuple[str, ...] = EDGE_TABLES) -> str:
    _validate_tables(edge_tables, EDGE_TABLES, "edge")
    return _build_table_selects(edge_tables, "valid_to IS NONE")


def build_incident_edges_query(edge_tables: tuple[str, ...] = EDGE_TABLES) -> str:
    _validate_tables(edge_tables, EDGE_TABLES, "edge")
    return _build_table_selects(
        edge_tables,
        "valid_to IS NONE AND (in = $record_id OR out = $record_id)",
    )
