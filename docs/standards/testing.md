# Test Standard

Purpose: Rules for all new tests.

Read when: You write or change a test.

## 1 Toolchain

| Language | Tool |
| :--- | :--- |
| TypeScript | Vitest |
| Python | pytest |

## 2 Location and Names

2.1 TypeScript: put the test beside the source file. Name it `<name>.test.ts`.
2.2 Python: put tests in a `tests/` folder. Name each file `test_<name>.py`.
2.3 Name each test for the behavior it proves.

## 3 Unit Tests

3.1 A unit test must not use the network.
3.2 A unit test must not call a real model.
3.3 A unit test must not read the real clock or random numbers. Inject a fixed clock or seed.
3.4 A unit test must not depend on another test or on test order.
3.5 Use deterministic fixtures. Commit them next to the tests.

## 4 Integration Tests

4.1 Mark each integration test. Use `describe.skipIf` or a Vitest project in TypeScript. Use `@pytest.mark.integration` in Python.
4.2 Keep integration tests separate from unit tests. Put Python integration tests in `tests/integration/`.
4.3 `make test` runs unit tests and integration tests. `make test-fast` runs only the tests that are not marked `integration`.
4.3.1 Keep every test outside the `integration` marker free of model calls, GPU use, Docker, and live services. The pre-push hook runs `make test-fast` and must stay fast.
4.4 If a service does not answer, the integration test skips with the reason. Set `LIVE_STRICT=1` to fail instead.
4.5 A test must call only local models. Do not call a cloud model in a test.
4.6 A test that needs a live service, a real model, or the real pi is an integration test.

## 5 Bug Fixes

5.1 Write a failing regression test first.
5.2 Fix the code. Make the test pass.

## 6 Integrity

CAUTION: A weak test hides a defect.

6.1 Never weaken an assertion to pass a test.
6.2 Never skip, disable, or delete a test to pass a check.
6.3 If a test is wrong, fix the test and state the reason in the commit body.

## 7 Commands

| Command | Purpose |
| :--- | :--- |
| `make test` | Run all checks, unit tests, and integration tests |
| `make test-fast` | Run all checks and `pytest -m "not integration"`. The pre-push hook runs it |
| `make cov` | Run only the pytest tests with coverage |
| `make test COV=1` | Run `make test` with pytest coverage |
| `uv run pytest <path> --cov` | Run one test path with coverage |

`make test` also runs the legacy `tsx` test scripts. They move to Vitest when their package passes review.

## 8 Speed and Coverage

8.1 Every pytest run prints the duration of each test that takes 0.05 seconds or more. It also prints a short table of tests sorted by duration.
8.2 The table lists all tests if the run has 60 tests or fewer. Otherwise it lists the 40 slowest tests.
8.3 Coverage is off by default. Add `--cov` to a pytest command, or use `make cov` or `make test COV=1`.
8.4 If coverage is on, the run uses one context for each test. It prints the missing lines of each file.
8.5 If coverage is on, the summary replaces the table with a greedy set cover over the lines that each test covers. The test with the most new lines for each second of test time comes first. The summary lists:

- The tests in the cover, with their duration and the new lines that each adds.
- The count and total duration of the tests outside the cover.
- The tests outside the cover. It lists all if they are 80 or fewer. Otherwise it lists the 40 slowest.
- The tests with no per-test data, because their work runs in a child process.

8.6 Use the summary to find slow tests and tests outside the cover. Do not remove a test only because it is outside the cover.
8.7 Coverage measures `packages/engine/src/sosho_engine` and `bin`. The data file is `.cache/coverage/.coverage`. Git ignores it.
8.8 Coverage also measures child processes of the tests. Their lines count in the file report. They do not count in the per-test cover, because the child process has no test context.
8.9 Coverage makes a run slower. Tests that start many child processes are slower the most.
8.10 Vitest tests live in packages/web/src. Vitest coverage is not set up. Add `@vitest/coverage-v8` when the first test is added.
