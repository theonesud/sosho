import re

from sosho_memory.errors import (
    MemoryValidationError,
    SecretRejectedError,
    UnapprovedRelationError,
)
from sosho_memory.models import (
    ConceptNetRelation,
    MemoryEdge,
    MemoryNode,
    Provenance,
    WorkflowRelation,
)

_SECRET_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private_key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("openai_or_anthropic_key", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b")),
    (
        "github_token",
        re.compile(
            r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b"
            r"|\bgithub_pat_[A-Za-z0-9_]{20,}\b"
        ),
    ),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("hf_token", re.compile(r"\bhf_[A-Za-z0-9]{20,}\b")),
    ("bearer_token", re.compile(r"\bBearer\s+[A-Za-z0-9._-]{16,}\b")),
    ("credential_url", re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")),
    (
        "env_secret_assignment",
        re.compile(
            r"(?im)^\s*(?:export\s+)?[A-Z0-9_]*"
            r"(?:API_KEY|SECRET|PASSWORD|TOKEN|MASTER_KEY|PRIVATE_KEY)"
            r"[A-Z0-9_]*\s*=\s*\S+"
        ),
    ),
)

_APPROVED_RELATION_MAP: dict[str, ConceptNetRelation | WorkflowRelation] = {
    **{relation.value: relation for relation in ConceptNetRelation},
    **{relation.value: relation for relation in WorkflowRelation},
}


def detect_secret_rule(text: str) -> str | None:
    for rule_name, pattern in _SECRET_RULES:
        if pattern.search(text) is not None:
            return rule_name
    return None


def assert_no_secrets(text: str, field_name: str) -> None:
    rule = detect_secret_rule(text)
    if rule is not None:
        raise SecretRejectedError(f"Secret pattern '{rule}' rejected in field '{field_name}'.")


def validate_write_provenance(provenance: Provenance) -> None:
    if not provenance.agent_id.strip():
        raise MemoryValidationError("Provenance agent_id must not be empty.")
    if not provenance.session_id.strip():
        raise MemoryValidationError("Provenance session_id must not be empty.")
    if provenance.timestamp.tzinfo is None:
        raise MemoryValidationError("Provenance timestamp must include timezone information.")
    if provenance.valid_from.tzinfo is None:
        raise MemoryValidationError("Provenance valid_from must include timezone information.")
    if provenance.valid_to is not None:
        if provenance.valid_to.tzinfo is None:
            raise MemoryValidationError("Provenance valid_to must include timezone information.")
        if provenance.valid_to < provenance.valid_from:
            raise MemoryValidationError(
                "Provenance valid_to must be greater than or equal to valid_from."
            )


def validate_relation_name(relation: str) -> ConceptNetRelation | WorkflowRelation:
    matched = _APPROVED_RELATION_MAP.get(relation)
    if matched is None:
        raise UnapprovedRelationError(f"Relation '{relation}' is not in the approved allowlist.")
    return matched


def validate_node_write(node: MemoryNode) -> None:
    validate_write_provenance(node.provenance)
    assert_no_secrets(node.key, "key")
    assert_no_secrets(node.label, "label")
    assert_no_secrets(node.content, "content")


def validate_edge_write(edge: MemoryEdge) -> None:
    validate_relation_name(edge.relation.value)
    validate_write_provenance(edge.provenance)
    assert_no_secrets(edge.source_key, "source_key")
    assert_no_secrets(edge.target_key, "target_key")
