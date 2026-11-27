import pytest
from sosho_memory import (
    MemoryConfigError,
    cosine_similarity,
    load_memory_settings,
    select_best_sense_candidate,
)


def test_litellm_settings_validation() -> None:
    defaults = load_memory_settings(surreal_url="mem://")
    assert defaults.litellm_url == "http://127.0.0.1:4000"
    assert defaults.litellm_api_key is None
    assert defaults.embed_role == "embed"
    assert defaults.decision_role == "decision"
    assert defaults.model_timeout_seconds == 60.0

    for bad_url in ("ftp://127.0.0.1:4000", "http://", "https://   ", "http://:4000"):
        with pytest.raises(MemoryConfigError):
            load_memory_settings(surreal_url="mem://", litellm_url=bad_url)

    with pytest.raises(MemoryConfigError):
        load_memory_settings(surreal_url="mem://", embed_role="")

    with pytest.raises(MemoryConfigError):
        load_memory_settings(surreal_url="mem://", decision_role="")

    with pytest.raises(MemoryConfigError):
        load_memory_settings(surreal_url="mem://", model_timeout_seconds=0.0)


def test_curation_vector_selection_is_deterministic() -> None:
    assert cosine_similarity((1.0, 0.0), (1.0, 0.0)) == pytest.approx(1.0)
    assert cosine_similarity((1.0, 0.0), (0.0, 1.0)) == pytest.approx(0.0)
    assert cosine_similarity((0.0, 0.0), (1.0, 0.0)) == 0.0
    assert cosine_similarity((1.0,), (1.0, 0.0)) == 0.0

    chosen = select_best_sense_candidate(
        (0.9, 0.1),
        (("database", (0.1, 0.9)), ("graph", (0.95, 0.05))),
    )
    assert chosen == "graph"
    assert select_best_sense_candidate((1.0, 0.0), ()) is None
