# Sources

1. "inference-optimisation" skill, Sybil Solutions contributors, MIT License. We took the general method from it as a reference: controls on each side, median of samples, ceilings, the ledger, and several lever priors and gotchas. This skill is independent and written from new.
2. RustingStrata v1.3.7 documentation and source: `README.md`, `docs/USAGE.md`, `docs/CALIBRATION.md`, `docs/BENCHMARKS.md`, `docs/baseline.md`, `docs/HOSTING.md`, `src/`.
3. `local-ai-best.md`, a model and engine recommendation for this machine, written by an AI assistant. Several of its claims were wrong for this machine: 30 GB RAM, an iGPU, AVX-512, a 1.7x to 2x gain, and "8 drafted tokens cost the same as 1" on MoE. We kept its rung list as input to the lever catalog.
4. Model cards: `llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF`, `incoai/Qwen3.6-35B-A3B-DFlash2`, `Qwen/Qwen3.6-35B-A3B`.
5. Our own measurements on the machine `beast`, 2026-11-26. See `machines/beast/`.
