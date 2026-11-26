# Quality gates

## 1. Change classes

| Class | Examples | Required gates |
|---|---|---|
| Lossless | thread count, chunk size, expert placement, speculative decoding, kernel launch settings, memory margin | G1, G3 |
| Numerics | a new kernel, a different reduction order, a different attention path | G1, G2, G3 |
| Lossy | KV cache quantization, a lower weight quant, int8 activations | G1, G2, G3, G4, and a written label of the cost |

## 2. One-time independent check (G0)

Run G0 once per new engine and model pair, in phase 3.

Purpose: an independent engine computes the same model. If both engines agree, the new engine reads this model file correctly. A young engine can have a defect for one quant type or one architecture that the authors never tested. Without G0, every later gate compares against a reference that can be wrong.

Method:

1. Run llama.cpp `llama-server` on the same model file as the reference.
2. Compare the greedy next token at each position of a fixed prompt set. RustingStrata ships `tools/parity.py` for this.
3. Pass: top-1 agreement of 98% or more. Two runs of llama.cpp in two batch modes agree on only about 98.3%, so 100% is not possible.
4. If the agreement is lower, compare the logits at the first divergence. A near-tie of a few hundredths of a nat is not a defect.

After G0 passes, the later gates use the engine's own B0 outputs as the reference. llama.cpp is not needed again.

## 3. Gates for each accepted change

- **G1, function.** Load, one chat turn, one tool call round trip, one reasoning turn. No loops, no empty replies, no malformed tool calls.
- **G2, agreement with B0.** Run the fixed prompt set greedy. Compare the tokens with the B0 reference. The pass bar is at most 1% lower than B0 against itself. Measure the B0 self-agreement first: some engines move experts at run time, so B0 does not exactly match itself.
- **G3, needle.** Find 3 of 3 facts at 50% and at about 100% of the context.
- **G4, lossy cost.** Measure KL divergence or perplexity against B0 on a fixed text. Write the number in the label.

## 4. Speculative decoding

Greedy speculative decoding must give the same text as greedy plain decoding. Small differences can come from a different reduction order in the verify pass. Accept a difference only at a near-tie of the logits.

## 5. Practical form of G0 and G2

`scripts/gate_greedy.py` runs a fixed set of 12 prompts greedy, 64 tokens each: 6 short panel prompts, 4 recorded agent turns at growing context with tools, 2 recorded single calls. It compares two runs by the first differing character. A prompt agrees if the shared prefix is at least half the text or 120 characters.

1. Measure the noise floor first: two runs of B0. An engine that moves experts at run time does not match itself. In the first campaign: 9 of 12 agreed, mean share 0.81.
2. G2 passes if the candidate against B0 is at the noise floor.
3. G0 with the same script against `llama-server` on the same GGUF: identical prompt token counts show the same chat template. Short answers must be identical. Long agent turns may split at the same near-ties where B0 splits from itself.
4. This is weaker than a token-by-token check with teacher forcing. Use the engine's own parity tool when it can run in the container.
