from pathlib import Path

import pytest
from langchain_openai import ChatOpenAI
from sosho_graph.llm_client import litellm_model_factory
from sosho_graph.settings import Settings, SettingsError
from sosho_graph.tracing import open_tracing
from support import make_settings


def test_model_call_without_litellm_key_raises_settings_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("LITELLM_API_KEY", raising=False)
    settings = Settings(sosho_graph_db=tmp_path / "nokey.sqlite", litellm_api_key=None)
    model = litellm_model_factory(settings)
    with pytest.raises(SettingsError):
        model("decision")


def test_tracing_is_off_without_langfuse_keys(tmp_path: Path) -> None:
    tracing = open_tracing(make_settings(tmp_path / "trace.sqlite"))
    assert tracing.callbacks == []
    assert tracing.client is None


def test_model_factory_uses_the_role_name_as_model(tmp_path: Path) -> None:
    model = litellm_model_factory(make_settings(tmp_path / "model.sqlite"))("decision")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "decision"
