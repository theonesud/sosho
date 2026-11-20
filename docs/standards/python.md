# Python Standard

Purpose: Rules for all new `.py` files.

Read when: You edit a `.py` file.

## 1 Toolchain

| Task | Tool |
| :--- | :--- |
| Package manager | uv |
| Format and lint | Ruff |
| Type check | Pyright strict |
| Test | pytest |
| Boundary validation | Pydantic |

1.1 Ruff is the only formatter. Do not add another formatter.
1.2 Use uv only. Do not run `pip install`.
1.3 Follow [code.md](code.md) for all language-independent rules.

## 2 Types

2.1 Add type hints to every function parameter and return value.
2.2 Keep Pyright strict mode clean.
2.3 Do not use `Any`, `# type: ignore`, or `cast` to hide an error.

## 3 Data and Boundaries

3.1 Use Pydantic models for external input.
3.2 Use `pydantic-settings` for settings. Read the environment once at startup.
3.3 Use a dataclass or a Pydantic model for data. Do not pass bare dicts between modules.
3.4 Use `frozen=True` for data that does not change.

## 4 Async

4.1 Do not call a blocking function in the event loop.
4.2 To run blocking code, call `asyncio.to_thread`.
4.3 Await every coroutine. Do not leave a coroutine unawaited.

DO:

```python
data = await asyncio.to_thread(path.read_bytes)
```

DO NOT:

```python
data = path.read_bytes()  # inside async def
```

## 5 Exceptions

5.1 Raise a specific exception type. Do not raise bare `Exception`.
5.2 Do not use a bare `except`. Do not swallow an exception.
5.3 To add context, use `raise NewError(...) from error`.

## 6 Logs

6.1 Use the `logging` module. Do not use `print`.
6.2 Create one logger for each module with `logging.getLogger(__name__)`.

## 7 Names

| Item | Style |
| :--- | :--- |
| Module and function | `snake_case` |
| Class | `PascalCase` |
| Constant | `UPPER_SNAKE_CASE` |

## 8 Commands

| Command | Purpose |
| :--- | :--- |
| `make fix` | Format and fix with Ruff |
| `make check` | Ruff check, Pyright, and pytest |
