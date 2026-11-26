# Ceilings for hybrid CPU and GPU MoE models

## 1. Why

A ceiling shows the best speed that the hardware permits. It tells you when to stop, and it shows which tier limits the speed.

## 2. Inputs to measure

| Symbol | Meaning | How to get it |
|---|---|---|
| `B_gpu` | GPU memory bandwidth, GB/s | Device-to-device copy test. |
| `B_ram` | Host RAM read bandwidth, GB/s | A multi-thread read test on a large buffer. |
| `B_pcie` | Host-to-device bandwidth, GB/s | A pinned-memory copy test under load. |
| `D` | Dense bytes per token: attention, linear-attention, norms, router, shared experts | From the GGUF tensor list. |
| `H` | LM head bytes | From the GGUF tensor list. |
| `E` | Bytes of one routed expert, all three matrices | From the GGUF tensor list. |
| `L`, `k`, `n` | MoE layers, active experts, experts per layer | From the model config. |
| `h` | Share of active experts that are in VRAM. This is the hit rate, not the resident share. | From the engine log or a routing trace. |
| `S` | Recurrent state bytes read and written per token, for linear-attention layers | From the model config. |
| `KV(c)` | KV bytes read per token at context `c` | `attn_layers × 2 × kv_heads × head_dim × bytes × c`. |

## 3. Decode, one token, no drafts

The GPU and CPU work in parallel on each layer. The slower side sets the time.

```
t_gpu = (D + H + S + KV(c) + L·k·h·E) / B_gpu
t_cpu = (L·k·(1-h)·E) / B_ram
t_token ≈ max(t_gpu, t_cpu) + L · t_sync
decode_ceiling = 1 / t_token
```

`t_sync` is the cost of one GPU and CPU handoff per layer. Measure it with a run where all experts are on the GPU and with a run where all are on the CPU.

## 4. Decode with drafts

A verify step with `r = drafts + 1` rows activates a union of experts:

```
union(r) = n · (1 - (1 - k/n)^r)      experts per layer, uniform routing
```

Real routing is not uniform, so the union is smaller. The verify step reads `union(r)` experts instead of `k`. With `a` accepted tokens per step:

```
tok/s = a / t_step(r)
```

Drafts pay only if `a` grows faster than `t_step`. On the CPU tier, `t_step` grows with the union. The claim "8 drafted tokens cost the same as 1" is false for MoE.

## 5. Prefill

```
prefill_ceiling ≈ achieved_tflops / (2 · active_params + attention_flops(c))
```

During prefill, the engine can copy experts to the GPU in batches. PCIe then becomes a tier: `chunk_tokens` share the cost of one expert copy. A larger chunk gives better reuse but longer stalls.

## 6. Use

1. Compute `t_gpu` and `t_cpu` for B0. The larger one is the bottleneck.
2. If `t_cpu` dominates, work on the hit rate, the CPU kernels, and the CPU threads.
3. If `t_gpu` dominates, work on GPU kernels and graphs.
4. Write the ceilings in the campaign `PLAN.md` under "Theory".
