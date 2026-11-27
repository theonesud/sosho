NODE_TABLES: tuple[str, ...] = ("entity", "concept", "preference", "error", "fix", "episode")
CONCEPTNET_EDGE_TABLES: tuple[str, ...] = (
    "IsA",
    "PartOf",
    "UsedFor",
    "Causes",
    "HasPrerequisite",
    "Antonym",
)
WORKFLOW_EDGE_TABLES: tuple[str, ...] = (
    "PrefersOver",
    "FixedBy",
    "ViolatesRule",
    "Supersedes",
    "DependsOn",
)
EDGE_TABLES: tuple[str, ...] = CONCEPTNET_EDGE_TABLES + WORKFLOW_EDGE_TABLES
AUDIT_LOG_TABLE: str = "audit_log"
ONTOLOGY_METADATA_TABLE: str = "ontology_metadata"
TEXT_ANALYZER_NAME: str = "memory_text_analyzer"

_PROVENANCE_FIELDS: tuple[tuple[str, str], ...] = (
    ("valid_from", "datetime"),
    ("valid_to", "option<datetime>"),
    ("confidence", "float"),
    ("agent_id", "string"),
    ("agent_role", "string"),
    ("session_id", "string"),
    ("timestamp", "datetime"),
)

_NODE_FIELDS: tuple[tuple[str, str], ...] = (
    ("key", "string"),
    ("label", "string"),
    ("content", "string"),
    ("embedding", "option<array<float>>"),
    *_PROVENANCE_FIELDS,
)

_EDGE_FIELDS: tuple[tuple[str, str], ...] = (
    ("weight", "float"),
    *_PROVENANCE_FIELDS,
)

_AUDIT_LOG_FIELDS: tuple[tuple[str, str], ...] = (
    ("transaction_id", "string"),
    ("session_id", "string"),
    ("agent_id", "string"),
    ("agent_role", "string"),
    ("action", "string"),
    ("target_table", "string"),
    ("target_id", "string"),
    ("payload_json", "string"),
    ("timestamp", "datetime"),
)

_ONTOLOGY_METADATA_FIELDS: tuple[tuple[str, str], ...] = (
    ("dataset_version", "string"),
    ("filter_fingerprint", "string"),
    ("concept_count", "int"),
    ("spine_edge_count", "int"),
    ("lateral_edge_count", "int"),
    ("loaded_at", "datetime"),
    ("session_id", "string"),
)


def _field_statements(table: str, fields: tuple[tuple[str, str], ...]) -> tuple[str, ...]:
    return tuple(
        f"DEFINE FIELD IF NOT EXISTS {name} ON TABLE {table} TYPE {field_type};"
        for name, field_type in fields
    )


def analyzer_statements() -> tuple[str, ...]:
    return (
        f"DEFINE ANALYZER IF NOT EXISTS {TEXT_ANALYZER_NAME} "
        "TOKENIZERS blank, class FILTERS lowercase, ascii;",
    )


def node_table_statements(table: str, embedding_dimensions: int) -> tuple[str, ...]:
    if isinstance(embedding_dimensions, bool) or embedding_dimensions < 1:
        raise ValueError("embedding_dimensions must be at least 1")
    return (
        f"DEFINE TABLE IF NOT EXISTS {table} SCHEMAFULL;",
        *_field_statements(table, _NODE_FIELDS),
        f"DEFINE INDEX IF NOT EXISTS idx_{table}_key ON TABLE {table} FIELDS key UNIQUE;",
        f"DEFINE INDEX IF NOT EXISTS idx_{table}_embedding ON TABLE {table} "
        f"FIELDS embedding HNSW DIMENSION {embedding_dimensions} DIST COSINE;",
        f"DEFINE INDEX IF NOT EXISTS idx_{table}_content_bm25 ON TABLE {table} "
        f"FIELDS content FULLTEXT ANALYZER {TEXT_ANALYZER_NAME} BM25;",
    )


def edge_table_statements(table: str) -> tuple[str, ...]:
    targets = "|".join(NODE_TABLES)
    return (
        f"DEFINE TABLE IF NOT EXISTS {table} TYPE RELATION IN {targets} OUT {targets} SCHEMAFULL;",
        *_field_statements(table, _EDGE_FIELDS),
    )


def audit_log_statements() -> tuple[str, ...]:
    return (
        f"DEFINE TABLE IF NOT EXISTS {AUDIT_LOG_TABLE} SCHEMAFULL;",
        *_field_statements(AUDIT_LOG_TABLE, _AUDIT_LOG_FIELDS),
        f"DEFINE INDEX IF NOT EXISTS idx_{AUDIT_LOG_TABLE}_transaction_id "
        f"ON TABLE {AUDIT_LOG_TABLE} FIELDS transaction_id;",
        f"DEFINE INDEX IF NOT EXISTS idx_{AUDIT_LOG_TABLE}_session_id "
        f"ON TABLE {AUDIT_LOG_TABLE} FIELDS session_id;",
    )


def ontology_metadata_statements() -> tuple[str, ...]:
    return (
        f"DEFINE TABLE IF NOT EXISTS {ONTOLOGY_METADATA_TABLE} SCHEMAFULL;",
        *_field_statements(ONTOLOGY_METADATA_TABLE, _ONTOLOGY_METADATA_FIELDS),
        f"DEFINE INDEX IF NOT EXISTS idx_{ONTOLOGY_METADATA_TABLE}_dataset_version "
        f"ON TABLE {ONTOLOGY_METADATA_TABLE} FIELDS dataset_version UNIQUE;",
    )


def build_schema_statements(embedding_dimensions: int) -> tuple[str, ...]:
    if isinstance(embedding_dimensions, bool) or embedding_dimensions < 1:
        raise ValueError("embedding_dimensions must be at least 1")
    statements: list[str] = [*analyzer_statements()]
    for table in NODE_TABLES:
        statements.extend(node_table_statements(table, embedding_dimensions))
    for table in EDGE_TABLES:
        statements.extend(edge_table_statements(table))
    statements.extend(audit_log_statements())
    statements.extend(ontology_metadata_statements())
    return tuple(statements)
