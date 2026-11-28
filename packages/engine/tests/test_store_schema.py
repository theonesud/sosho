from pathlib import Path

from sosho_engine.store import Store
from sqlalchemy import create_engine, inspect, text


def test_create_tables_drops_engine_live(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'schema.sqlite'}"
    legacy = create_engine(url)
    with legacy.begin() as conn:
        conn.execute(text("CREATE TABLE engine_live (workflow_id TEXT)"))
    store = Store(url)
    store.create_tables()
    store.create_tables()
    store.close()
    names = inspect(legacy).get_table_names()
    legacy.dispose()
    assert "engine_live" not in names
    assert "engine_workflows" in names
