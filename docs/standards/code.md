# Code Standard

Purpose: Language-independent rules for all new code.

Read when: You write or change any code.

## 1 Design

1.1 Write small modules. Give each module one responsibility.
1.2 Put logic in pure functions. Put side effects at the edges.
1.3 Point dependencies inward. Do not make circular imports.
1.4 Use composition. Do not use inheritance to share code.

## 2 Size Limits

2.1 Keep a function at 60 lines or fewer.
2.2 Keep a file at 1000 lines or fewer.
2.3 If a change will exceed a limit, split the code first.
2.4 `bin/check-file-length.py` checks rule 2.2 for `.py`, `.ts`, `.tsx`, `.mts`, `.js`, `.mjs`, `.cjs`, and `.sh` files. `make test` fails on each file over its limit.

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

7.1 Do not write comments. This rule covers every file type: code, scripts, configuration, Dockerfiles, and Makefiles. It also covers docstrings and file headers.
7.2 Write a comment only if the code cannot show a necessary fact. Examples:
- A workaround for a defect in an external tool. Give the tool and the version.
- A security or safety reason that a reader can remove by accident.
- A constraint from an external format or protocol that the names cannot show.
7.3 Before you write a comment, try a better name, a smaller function, or a test.
7.4 Do not explain what the code does. Do not repeat the name. Do not write a section banner.
7.5 Write a necessary comment in ASD-STE100. Keep it to one sentence when possible.
7.6 Do not commit commented-out code.
7.7 Give each TODO an owner reference.
7.8 If you change a file, remove the comments in your diff that break this section.
7.9 `bin/check-comments.py` finds every comment and Python docstring. `make test` fails on each one that `.config/comments-allow.toml` does not list.
7.10 To keep a necessary comment, add an entry to `.config/comments-allow.toml` with the path, the exact text, and a reason. Tell the owner about each new entry in your report.
7.11 Do not add an entry to avoid the work in 7.3. The owner reviews each entry.
7.12 Tool directives are not comments. Examples: `# noqa:`, `# shellcheck`, `# gitleaks:allow`, `// biome-ignore`, and a first-line `#!`.

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
11.2 Pin each dependency to one exact version. This covers npm and Python packages, Docker images, Dockerfile base images, mise tools, and `npx` package arguments.
11.3 Do not use a version range or a floating tag. Examples: `^1.2.0`, `~1.2`, `>=1.2`, `*`, `latest`, `7-alpine`.
11.3.1 Exception by owner decision: pi and each pi package must use `latest`. A pi package name starts with `@earendil-works/pi-`, or it is a pi extension package in `.pi/settings.json`. Pin all other packages exactly.
11.4 If an image has no exact version tag, pin it by `sha256` digest.
11.5 Use the newest stable version when you add or update a dependency.
11.6 Update outdated dependencies in a separate change. `make test` lists them as warnings.
11.7 Commit each lockfile.
11.8 The package managers write exact versions: `saveExact` in `pnpm-workspace.yaml`, `save-exact` in each `.npmrc`, `add-bounds = "exact"` for uv, and `pin` for mise. Do not change these settings.
11.9 Use the newest version that the pnpm release-age policy allows. Do not add an entry to `minimumReleaseAgeExclude`.
NOTE: `peerDependencies` can use a range, because they state compatibility with the host. An image that this repository builds can use the `latest` tag.

## 12 Security

12.1 Give each component the least privilege it needs.

WARNING: A shell string built from input can run attacker commands.

12.2 Do not build a shell string from input. Pass arguments as a list.
12.3 Use parameterized queries.

## 13 Change Discipline

13.1 Make small diffs.
13.2 Put one concern in each change.
13.3 Update tests and documentation in the same change.
