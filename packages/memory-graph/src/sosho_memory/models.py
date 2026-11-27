from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class NodeKind(StrEnum):
    ENTITY = "entity"
    CONCEPT = "concept"
    PREFERENCE = "preference"
    ERROR = "error"
    FIX = "fix"
    EPISODE = "episode"


class ConceptNetRelation(StrEnum):
    IS_A = "IsA"
    PART_OF = "PartOf"
    USED_FOR = "UsedFor"
    CAUSES = "Causes"
    HAS_PREREQUISITE = "HasPrerequisite"
    ANTONYM = "Antonym"


class WorkflowRelation(StrEnum):
    PREFERS_OVER = "PrefersOver"
    FIXED_BY = "FixedBy"
    VIOLATES_RULE = "ViolatesRule"
    SUPERSEDES = "Supersedes"
    DEPENDS_ON = "DependsOn"


type RelationType = ConceptNetRelation | WorkflowRelation

APPROVED_RELATIONS: frozenset[str] = frozenset(
    relation.value for relation in (*ConceptNetRelation, *WorkflowRelation)
)


class AgentRole(StrEnum):
    COORDINATOR = "coordinator"
    SUBAGENT = "subagent"
    SYSTEM = "system"


class AuditAction(StrEnum):
    CREATE_NODE = "create_node"
    UPDATE_NODE = "update_node"
    DELETE_NODE = "delete_node"
    CREATE_EDGE = "create_edge"
    CLOSE_EDGE = "close_edge"
    DELETE_EDGE = "delete_edge"


class Provenance(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    valid_from: datetime
    valid_to: datetime | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    agent_id: str = Field(min_length=1)
    agent_role: AgentRole
    session_id: str = Field(min_length=1)
    timestamp: datetime


class MemoryNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: NodeKind
    key: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_:-]*$")
    label: str = Field(min_length=1)
    content: str
    embedding: tuple[float, ...] | None = None
    provenance: Provenance


class MemoryEdge(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation: ConceptNetRelation | WorkflowRelation
    source_kind: NodeKind
    source_key: str = Field(min_length=1)
    target_kind: NodeKind
    target_key: str = Field(min_length=1)
    weight: float = Field(default=1.0, gt=0.0)
    provenance: Provenance


class AuditLogEntry(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    transaction_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    agent_role: AgentRole
    action: AuditAction
    target_table: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    payload_json: str
    timestamp: datetime


class OntologyMetadata(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    dataset_version: str = Field(min_length=1)
    filter_fingerprint: str = Field(min_length=1)
    concept_count: int = Field(ge=0)
    spine_edge_count: int = Field(ge=0)
    lateral_edge_count: int = Field(ge=0)
    loaded_at: datetime
    session_id: str = Field(min_length=1)
