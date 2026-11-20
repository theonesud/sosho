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
4.2 Keep integration tests separate from unit tests.
4.3 `make check` runs unit tests only.

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
| `make check` | Run all checks and all unit tests |

Run the legacy suite with `./tests/run_tests.sh`.
