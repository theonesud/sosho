# Engine: RustingStrata

Pure-Rust engine for GGUF models. CUDA kernels compile at run time with NVRTC. Experts that do not fit in VRAM run on the CPU in parallel with the GPU work.

- Repository: `https://github.com/RustingStudio/RustingStrata`
- Version studied: v1.3.7 (2026-11-26). The project is young and releases often. Pin a tag.
- License: "RustingStrata License 1.0". Use, change, and distribution are allowed. You may not sell the engine itself.

Source references below are `path:line` in v1.3.7.

## 1. Zero-config behaviour

| Setting | Default | Note |
|---|---|---|
| `--gpu` | off | Required for the GPU path (`src/main.rs:30`). |
| `--ctx` | 4096 | Hard KV cap per slot. Too small for agents. |
| `--kv` | f16 | |
| `--chunk` | calibration, else 4096 | Prefill chunk. Prefill scratch grows with it. |
| `--mtp` | calibration, else 0 | |
| `--short` | calibration, else 32 | Short-prompt threshold. |
| `--threads` | calibration, else physical cores | The Rayon pool is built once per process (`src/main.rs:497`). |
| `--vram-margin` | 512 MB | |
| `--spec-type` | none | |
| `--cache-ram` | 4096 MB | Parked conversations in host RAM. |
| `--preserve-thinking`, `--think` | true, true | Keeps old thinking blocks, so the prefix stays the same. |
| `--parallel` | 1 | MTP turns off when this is above 1 (`src/main.rs:735`). |
| Sampling | greedy | The engine does not read sampling values from the GGUF. The client must send them. |

`serve` does not calibrate by itself. Without a calibration file it prints a warning (`src/main.rs:462`). A calibration file is ignored if the GPU name or the model file size differs.

## 2. bench compared with serve

| Setting | `bench` | `serve` |
|---|---|---|
| Expert adapt interval | 8 tokens | 16 tokens |
| Swaps per adapt | 64 | 16 |
| Reset counts after prefill | no | yes |

Source: `gpu_model.rs:1146`, `gpu_model.rs:3462`. Use `serve` for decisions.

## 3. Knobs

### Flags

| Flag | Effect |
|---|---|
| `--ctx`, `--kv f16, q8, q4, q2` | KV size and type. |
| `--vram-margin` | VRAM left free. |
| `--chunk`, `--short`, `--threads` | Prefill chunk, short-prompt path, CPU expert threads. |
| `--mtp N`, `--mtp-model` | Built-in or separate MTP draft head. |
| `--draft-model` | DFlash, DFlash2, EAGLE3, or a small model with the same vocabulary. DFlash safetensors convert once to `model-dflash-q4_0.gguf`. |
| `--spec-type`, `--spec-draft-n-max`, `--spec-ngram-size-n`, `--spec-ngram-size-m`, `--spec-ngram-min-hits` | Context-lookup drafters: `suffix`, `ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod`, `ngram-cache`. They combine with MTP. |
| `--lookup-cache-static`, `--lookup-cache-dynamic` | N-gram caches on disk. |
| `--cache-ram`, `--prompt-cache` | Host RAM cache and disk cache of KV and recurrent state. |
| `--fixed-experts`, `--llama-numerics` | Deterministic placement, llama.cpp numerics. Use for parity only. |
| `--auto-unload` | Unload the model after idle seconds. |

### Environment variables for qwen35moe on CUDA

| Variable | Default | Effect |
|---|---|---|
| `STRATA_EXPERT_MB` | free VRAM minus margin | Explicit expert slot budget. |
| `STRATA_ADAPT_EVERY`, `STRATA_ADAPT_SWAPS` | 16 and 16 in serve | Placement adapt. 0 turns it off. |
| `STRATA_PF_ADAPT` | 0 | Re-place experts every N prefill chunks. The source says "untested on real hardware". |
| `STRATA_FIXED_EXPERTS` | off | Layer-order placement, no profile. |
| `STRATA_MOE_PREFETCH` | off | Next-layer L2 prefetch. |
| `STRATA_HUGEPAGE`, `STRATA_PRELOAD`, `STRATA_COLD_KEEP` | off, auto, off | Page-cache behaviour of the model file. |
| `STRATA_MTP_ADAPT` | on | Drops to 1 draft when the expert hit window is low. |
| `STRATA_MTP_FULL_VOCAB` | off | Turns off the draft vocabulary shortlist. |
| `STRATA_VERIFY_GEMM` | 0 | GEMM verify from N rows. |
| `STRATA_BATCH_MIN` | 16 for MoE | Batched forward threshold. |
| `STRATA_DFLASH_BLOCK`, `STRATA_DFLASH_Q8`, `STRATA_DFLASH_STEPS` | adaptive, off, - | DFlash settings. |
| `STRATA_GEMV_BLOCK*`, `STRATA_RPW*`, `STRATA_MMQ`, `STRATA_GEMM_BK`, `STRATA_GEMM_MIN_BLOCKS`, `STRATA_SMEM_CARVEOUT`, `STRATA_NO_GRAPH` | authors' values | Kernel launch settings. Tuned on a 12 GB RTX 3060. |
| `STRATA_NVRTC` | `libnvrtc.so` | Library name. Set it in a container. |
| `STRATA_NO_UPDATE_CHECK` | off | Set it to 1 for reproducible runs. |
| `XDG_CACHE_HOME` | `~/.cache` | Calibration, routing profile, compiled kernels. Mount it in a container. |

`STRATA_AVX512` needs AVX-512 VNNI and VBMI. There is no `mlock` in the source.

## 4. Internals that matter

1. The CPU expert path: the GPU writes routing to a pinned host "mailbox". A spinning worker thread computes the missed experts with AVX2 integer dots and writes the sum back.
2. The log line `fast path off` is normal when not every expert fits in VRAM. The fast path needs every expert resident (`gpu_model.rs:3449`).
3. The routing profile is saved in the cache folder at the end of a run. The next start places the hottest experts first.
4. The MTP layer's experts share the expert cache.

## 5. Tools

| Tool | Needs | Pass bar |
|---|---|---|
| `tools/parity.py` | `llama-server` on port 8199 with the same model | 634 of 640 (99%). The default path reaches about 98% in the authors' runs. |
| `calibrate` | the model | Searches chunk, MTP 0 to 4, and short threshold only. It does not search ctx, KV, threads, margin, or adapt settings. |
| `calibrate spec` | the model | Searches spec type, draft max, n-gram size, MTP. |
| `perplexity --kld-base` | llama-perplexity output | KL divergence. |

## 6. Container

`scripts/engines/rustingstrata/Dockerfile` builds the engine with the host CPU target and NVRTC 13.5. Run flags: `--gpus all --ipc host --ulimit memlock=-1`, a cache volume on `/cache`, and the model folder read-only on `/models`.

## 7. Prefill and the per-request cost

- A request that extends the cached conversation restores the saved recurrent state and prefills only the new tokens. It also prefills the previous reply again, because the state is saved before the assistant header.
- New tokens under `--short` (default 32) use the decode path. Above that, chunked prefill runs. For a single request, chunked prefill uploads every missed expert that any token routes to over PCIe (`src/gpu_model/prefill.rs:637-725`). The CPU runs missed experts only in the `--parallel` batch path.
- After the prefill, `settle` swaps hot experts into VRAM with no cap (`src/expert_cache.rs:232`).
- Measured on an RTX 3060 Ti with about 1,700 resident experts: `prompt_ms` ≈ 0.9 s + 1.4 ms per new token.
- The prompt cache works per conversation. Separate requests with the same system prompt get no cache hit.

## 8. Fork: CPU split for small prefills

Branch `lit/c12-cpu-prefill` in the local clone, commits `20fbb58` and `efdd548` on v1.3.7. Not upstream.

| Variable | Default | Effect |
|---|---|---|
| `STRATA_CPU_PF_ROWS=R` | 0, off | In a single-request prefill chunk, the CPU runs each missed expert with at most R rows. Busier missed experts still copy over PCIe. Both work beside the resident GEMMs. |
| `STRATA_CPU_PF_MAX_TOKENS=T` | 0, all chunks | Apply the split only to chunks of at most T tokens. |

Measured with the agent replay: R = 4 to 8 best, R = 16 worse. Without T, the cold 32K prefill lost 7% to 8%. With T = 512 to 2048, the loss was gone. Chosen: R = 8, T = 1024.

## 9. Measured knob effects, Qwen3.6-35B-A3B Q4_K_M, RTX 3060 Ti 8 GB

See `references/levers.md` section 6.
