import math
import re
from collections.abc import Callable, Iterable

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from sosho_memory.models import ConceptNetRelation

_ENGLISH_PREFIX = "/c/en/"
_RELATION_PREFIX = "/r/"
_DISALLOWED_TERM_CHARS_RE = re.compile(r"[\d,]")
_STOPWORD_RE = re.compile(
    r"\b(in|on|at|to|for|of|with|by|from|a|an|the|is|are|and|or|"
    r"all|no|every|some|any|my|your|his|her|their|our)\b",
    re.IGNORECASE,
)
_SLUG_DISALLOWED_RE = re.compile(r"[^a-zA-Z0-9_:-]")
_SLUG_LEADING_PUNCT_RE = re.compile(r"^[^a-zA-Z0-9]+")


class ConceptNetFilterConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    dataset_version: str = Field(default="conceptnet-5.7.0", min_length=1)
    max_words: int = Field(default=2, ge=1)
    min_term_length: int = Field(default=2, ge=1)
    min_degree: int = Field(default=5, ge=1)
    min_weight: float = Field(default=1.0, gt=0.0)
    allowed_relations: tuple[ConceptNetRelation, ...] = tuple(ConceptNetRelation)


class RawAssertion(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source: str
    target: str
    relation: ConceptNetRelation
    weight: float


class _AssertionMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    weight: float = 1.0


def normalize_concept_term(raw_uri: str) -> str | None:
    if not raw_uri.startswith(_ENGLISH_PREFIX):
        return None
    parts = raw_uri.split("/")
    if len(parts) < 4:
        return None
    term = parts[3].lower().replace("_", " ").strip()
    return term or None


def concept_slug(term: str) -> str:
    collapsed = re.sub(r"\s+", "_", term.strip())
    cleaned = _SLUG_DISALLOWED_RE.sub("", collapsed)
    slug = _SLUG_LEADING_PUNCT_RE.sub("", cleaned)
    if not slug:
        raise ValueError(f"Cannot build concept slug from {term!r}")
    return slug


def is_clean_concept_term(term: str, config: ConceptNetFilterConfig) -> bool:
    stripped = term.strip()
    if len(stripped) < config.min_term_length:
        return False
    words = stripped.split()
    if not words or len(words) > config.max_words:
        return False
    if _DISALLOWED_TERM_CHARS_RE.search(stripped):
        return False
    return not _STOPWORD_RE.search(stripped)


def _parse_line_weight(raw_meta: str) -> float | None:
    try:
        meta = _AssertionMetadata.model_validate_json(raw_meta)
    except ValidationError:
        return None
    if not math.isfinite(meta.weight):
        return None
    return meta.weight


def _validated_endpoints(
    raw_source: str,
    raw_target: str,
    config: ConceptNetFilterConfig,
    noun_predicate: Callable[[str], bool] | None,
) -> tuple[str, str] | None:
    source = normalize_concept_term(raw_source)
    target = normalize_concept_term(raw_target)
    if source is None or target is None or source == target:
        return None
    if not is_clean_concept_term(source, config) or not is_clean_concept_term(target, config):
        return None
    if noun_predicate is not None and (not noun_predicate(source) or not noun_predicate(target)):
        return None
    return source, target


def _parse_single_line(
    line: str,
    config: ConceptNetFilterConfig,
    allowed_map: dict[str, ConceptNetRelation],
    noun_predicate: Callable[[str], bool] | None,
) -> RawAssertion | None:
    parts = line.rstrip("\r\n").split("\t")
    if len(parts) < 5 or not parts[1].startswith(_RELATION_PREFIX):
        return None
    relation = allowed_map.get(parts[1].removeprefix(_RELATION_PREFIX))
    if relation is None:
        return None
    endpoints = _validated_endpoints(parts[2], parts[3], config, noun_predicate)
    weight = _parse_line_weight(parts[4])
    if endpoints is None or weight is None or weight < config.min_weight:
        return None
    return RawAssertion(source=endpoints[0], target=endpoints[1], relation=relation, weight=weight)


def parse_conceptnet_lines(
    lines: Iterable[str],
    config: ConceptNetFilterConfig,
    noun_predicate: Callable[[str], bool] | None = None,
) -> tuple[RawAssertion, ...]:
    allowed_map = {relation.value: relation for relation in config.allowed_relations}
    deduped: dict[tuple[str, str, ConceptNetRelation], float] = {}
    for line in lines:
        parsed = _parse_single_line(line, config, allowed_map, noun_predicate)
        if parsed is None:
            continue
        key = (parsed.source, parsed.target, parsed.relation)
        existing = deduped.get(key)
        deduped[key] = parsed.weight if existing is None else max(existing, parsed.weight)
    sorted_keys = sorted(deduped.keys(), key=lambda item: (item[0], item[1], item[2].value))
    return tuple(
        RawAssertion(source=src, target=tgt, relation=rel, weight=deduped[(src, tgt, rel)])
        for src, tgt, rel in sorted_keys
    )
