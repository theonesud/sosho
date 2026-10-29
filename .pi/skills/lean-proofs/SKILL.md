---
name: lean-proofs
description: Formulate and verify Lean 4 mathematical proofs, theorem statements, and inductive types without verbose compiler output.
---

# Lean Proofs: Lean 4 Formal Verification

Formulate theorems and test formal proofs in Lean 4 with concise error reporting.

## Usage

```bash
# Verify a Lean 4 source file
.pi/skills/lean-proofs/scripts/verify.sh theorem.lean
```

## Protocol
1. Write theorems and proofs with clean tactic steps (`rw`, `simp`, `intro`, `apply`, `exact`).
2. Run `verify.sh` after each modification.
3. If tactic errors or unsolved goals occur, isolate the specific sub-goal from stdout and iterate surgically.
