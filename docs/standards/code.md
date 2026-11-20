# Code Standard

Purpose: Language-independent rules for all new code.

Read when: You write or change any code.

## 1 Design

1.1 Write small modules. Give each module one responsibility.
1.2 Put logic in pure functions. Put side effects at the edges.
1.3 Point dependencies inward. Do not make circular imports.
1.4 Use composition. Do not use inheritance to share code.

## 2 Size Limits

2.1 Keep a function at 40 lines or fewer.
2.2 Keep a file at 300 lines or fewer.
2.3 If a change will exceed a limit, split the code first.

## 3 Types and Boundaries

3.1 Validate all external input at the boundary. Use Zod in TypeScript. Use Pydantic in Python.
3.2 Inside the boundary, trust the typed data. Do not validate it again.
3.3 Do not use untyped values.

## 4 Errors

4.1 Do not swallow an error.
4.2 If you rethrow an error, add context. Keep the original error as the cause.
4.3 If the configuration is bad, fail at startup.
4.4 If the caller must decide, return a typed error result.

## 5 Configuration and Secrets

5.1 Read the environment once. Validate the values at startup.
5.2 Pass the validated configuration to the code that needs it.

WARNING: A secret in source code can leak to other people.

5.3 Do not hard-code secrets, URLs with credentials, or machine paths.

## 6 Logs

6.1 Write structured logs.
6.2 Do not write secrets to logs.
6.3 Do not use `console.log` or `print` for diagnostics in committed code.

## 7 Comments

7.1 Explain why. Do not explain what.
7.2 Write comments in ASD-STE100.
7.3 Do not commit commented-out code.
7.4 Give each TODO an owner reference.

## 8 Dead Code

8.1 Delete unused code, exports, and files in the same change.

## 9 Names

9.1 Use one term for one meaning.
9.2 Use the terms from the documentation glossary.

## 10 Cross-Platform

10.1 Code and scripts must run on macOS and on Linux x86_64.
10.2 Use POSIX tools only in scripts.
10.3 Do not use GNU-only flags.
10.4 Test each script command on macOS and on Linux.

## 11 Dependencies

11.1 Add a dependency only if it removes real code.
11.2 Pin versions through a lockfile.
11.3 Commit the lockfile.

## 12 Security

12.1 Give each component the least privilege it needs.

WARNING: A shell string built from input can run attacker commands.

12.2 Do not build a shell string from input. Pass arguments as a list.
12.3 Use parameterized queries.

## 13 Change Discipline

13.1 Make small diffs.
13.2 Put one concern in each change.
13.3 Update tests and documentation in the same change.
