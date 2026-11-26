---
name: local-inference-tuning
description: Tune a local LLM server for one machine and one user. The user picks the model file and the inference engine. The skill does the rest - zero-config baseline, ceilings, agent-replay scoring, one-change-at-a-time hill-climb, quality gates, and a final serving config. Use it when the user wants a local model to run faster on their own hardware, or wants to compare a tuned config against the engine defaults.
---

# Local Inference Tuning

## 1. Inputs

The user decides only two things:

1. The model file, for example `Qwen3.6-35B-A3B-...-Q4_K_M.gguf`.
2. The inference engine, for example RustingStrata or llama.cpp.

The skill decides everything else. Ask the user only for facts that the skill cannot measure. Examples: the work they do, the context length they need, and if they need images.

## 2. Philosophy

1. **Measure what the user feels.** The main score is the replay of the user's real agent sessions (M3). Synthetic benchmarks are diagnostics only.
2. **Start from zero.** The baseline is the engine with no tuning. Every tuned value must earn its place against that baseline.
3. **Change one thing at a time.** A run with two changes teaches nothing.
4. **Trust medians and controls, not single runs.** The noise on a desktop machine is 3% to 10%.
5. **Never trade quality for speed without a label.** A lossless change must keep the output the same. A lossy change must state the cost.
6. **Know the ceiling.** Compute the best possible speed from hardware numbers before the climb. Stop when the gap is small or three levers in a row give nothing.
7. **Write everything down.** Every run goes into the ledger. Every decision gets a reason in `PLAN.md`.
8. **The machine is shared.** The user works on the same machine. A config that is fast only on an idle machine is not a good config.

## 3. Folder layout

| Path | Content |
|---|---|
| `SKILL.md` | This file: inputs, philosophy, procedure. |
| `references/method.md` | Baseline, measurement levels, statistics, accept rule, ledger. |
| `references/quality.md` | Quality gates and why each one exists. |
| `references/environment.md` | Machine state, base load, noise control. |
| `references/ceilings.md` | Speed ceilings for hybrid CPU and GPU MoE models. |
| `references/levers.md` | Engine-independent catalog of tuning levers, with priors. |
| `references/gotchas.md` | Traps that cost time before. |
| `references/engines/<engine>.md` | Knobs, defaults, and traps of one engine. |
| `references/sources.md` | Where the knowledge came from. |
| `machines/<host>/` | Hardware profile and measured results of one machine. |
| `campaigns/<model>__<engine>__<host>/` | `PLAN.md`, `ledger.jsonl`, `configs/`, `best-config.json`, logs. |
| `scripts/` | Harness scripts. |

## 4. Procedure

Do the phases in order. Record the result of each phase in the campaign `PLAN.md`.

### Phase 0: Set up the campaign

1. Create `campaigns/<model>__<engine>__<host>/` with `PLAN.md`, `ledger.jsonl`, and `configs/`.
2. Write the machine profile in `machines/<host>/profile.md` if it does not exist. See `references/environment.md` section 2.
3. Read `references/engines/<engine>.md`. If it does not exist, write it first: defaults, knobs, and traps from the engine docs and source.
4. Build or pull the engine at a pinned commit or tag. Run it in a container. Persist the engine cache folder on a volume.

### Phase 1: Build the workload

1. Select 2 or 3 real agent sessions of the user. See `references/method.md` section 4.
2. Convert them into replay files.
3. Write a real prompt file for the micro bench (M1).

### Phase 2: Measure hardware and ceilings

1. Measure GPU memory bandwidth, RAM bandwidth, and PCIe bandwidth under load.
2. Compute the decode and prefill ceilings. See `references/ceilings.md`.

### Phase 3: Freeze the baseline

1. Run the zero-config baseline (B0) once with the `full` profile. See `references/method.md` sections 1 and 5.
2. Record the reference outputs for the quality gates. See `references/quality.md`.
3. Run the one-time independent correctness check. See `references/quality.md` section 2.

### Phase 4: Hill-climb

Before each batch, check free disk space and the load profile. Before the first batch, split the B0 time into parts. See `references/method.md` section 5.5.


1. Take the next group of independent levers from the campaign `PLAN.md`.
2. Write one config per lever. Each changes only that lever from the current best.
3. Run one batch with the `quick` profile: control, candidates, control. See `references/method.md` section 5.
4. Apply the decision table. Combine the kept levers into one config. Confirm it at the start of the next batch.
5. Run the quality gates on each new best config.
6. Write the result and the reason in `PLAN.md`. Update `best-config.json`.
7. Stop when a batch keeps nothing, or when the gap to the ceiling is below 10%.

Do config levers before code changes. Do code changes only after a profile shows where the time goes.

### Phase 5: Qualify

1. Run the full quality gates on the best config.
2. Run the replay under the user's normal base load. See `references/environment.md` section 3.
3. Run a soak test: one hour of replay in a loop, with no errors and no memory growth.

### Phase 6: Hand over

1. Write the final serving command and the container definition.
2. Write a short report: B0, best, the gain per lever, the costs, and the open items.

## 5. Rules

1. Run one GPU job at a time. Use the lock in `scripts/`.
2. Do not stop a server during a request. Stop the client first, then stop the server with a timeout.
3. Discard the first run after a cold start, a kernel compile, or a cache miss.
4. Check every result for loops, failed requests, and numbers that are too good.
5. Keep the user's other containers and apps running unless the campaign `PLAN.md` says otherwise.
6. Record the environment state with every run. Void the run if the state changed during the run.

## 6. Scripts

Run every script with `python3 -I`. `C` is the campaign folder name.

| Script | Use |
|---|---|
| `scripts/export_phoenix.py list --model M [--project P] [--since T]` | List recorded conversations in Phoenix. `M` is a LiteLLM alias or an upstream model name. |
| `scripts/export_phoenix.py export --model M --campaign C --group S1=HASH --singles W1=40` | Write replay files to `campaigns/C/replays/`, with secrets removed. |
| `scripts/run.py --campaign C queue b0 cand1 cand2 b0 --profile quick` | One batch. Starts and stops the engine container for each config, writes the ledger, and prints one score line per config. Use `--roles` to set the roles. |
| `scripts/run.py --campaign C serve CONFIG` and `stop` | Leave one config running, for manual tests. |
| `scripts/replay.py --base-url URL --campaign C --replay S1 [--limit N]` | M3 against a running server. |
| `scripts/bench_server.py --base-url URL --campaign C [--quick] [--needle]` | M2 against a running server. |
| `scripts/env_check.py` | Machine state as JSON. Set `LOAD_PROFILE` to the profile name. |
| `scripts/gate_greedy.py run --base-url URL --campaign C --model M --out NAME` and `compare --campaign C REF OTHER` | G0 and G2: greedy outputs of a fixed prompt set, and their agreement. |
| `scripts/load_gen.py --procs 1 --duty 1.0` | Synthetic CPU load for the `stress` profile. |

`campaigns/C/campaign.json` holds the engine image, model, port, context, replays, reps, sampling, and the containers to stop during runs. `campaigns/C/configs/NAME.json` holds one config: `serve_args`, `env`, `docker_args`, and `cache` (`fresh` for an empty cache on each start, or a folder name to keep it).

### Phoenix replay source

1. The source is the LiteLLM `chat` span in Phoenix, on `http://127.0.0.1:6006`.
2. The span holds the full request in `gen_ai.input.messages` only if LiteLLM runs with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only`. The default is `no_content`.
3. Phoenix does not keep `reasoning_effort`, `stream`, or `stream_options`. The replay file holds `null` for `reasoning_effort`.
4. A raw Langfuse ClickHouse archive of 3710 events exists in Native format with zstd, at `campaigns/qwen36-35b-a3b-heretic-q4km__rustingstrata__beast/replays/langfuse-archive-2026-11-26/`.
5. Reading the archive needs a ClickHouse server. Restore command, not verified: `zstd -dc <file> | clickhouse-client --query "INSERT INTO default.<table> FORMAT Native"`.
