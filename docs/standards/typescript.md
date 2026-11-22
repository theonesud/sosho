# TypeScript Standard

Purpose: Rules for all new `.ts` and `.tsx` files.

Read when: You edit a `.ts` or `.tsx` file.

## 1 Toolchain

| Task | Tool |
| :--- | :--- |
| Package manager | pnpm |
| Format and lint | Biome |
| Type check | `tsc` strict |
| Test | Vitest |
| Boundary validation | Zod |

1.1 Biome is the only formatter. Do not add another formatter.
1.2 Follow [code.md](code.md) for all language-independent rules.

## 2 Compiler

2.1 Set `strict` to `true` in `tsconfig.json`.
2.2 Set `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride` to `true`.
2.3 Do not lower a compiler option to pass a check.

## 3 Forbidden Constructs

3.1 Do not use `any`. Use `unknown` and narrow it.
3.2 Do not use the non-null operator `!`.
3.3 Do not use `@ts-ignore` or `@ts-expect-error`.
3.4 Do not use `as` to cast external data. Parse it with Zod.

## 4 Modules

4.1 Use ESM only. Do not use `require`.
4.2 Use `import type` for type-only imports.
4.3 Use named exports.
4.4 Use a default export only if a framework requires it.

## 5 Types

5.1 Define each boundary schema with Zod. Infer the type with `z.infer`.
5.2 Use a discriminated union. Do not use boolean flags for states.
5.3 Mark properties and arrays `readonly` by default.

DO:

```ts
type Result = { kind: "ok"; value: string } | { kind: "error"; error: Error };
```

DO NOT:

```ts
type Result = { ok: boolean; value?: string; error?: Error };
```

## 6 Async

6.1 Await every promise or return it.
6.2 Do not leave a floating promise.
6.3 Do not use an empty `catch`. Add context and rethrow, or handle the error.

## 7 Names

| Item | Style |
| :--- | :--- |
| Variable and function | `camelCase` |
| Type and class | `PascalCase` |
| File | `kebab-case.ts` |

## 8 Commands

| Command | Purpose |
| :--- | :--- |
| `make fix` | Format and fix with Biome |
| `make test` | Lint, format check, `tsc`, and Vitest |
