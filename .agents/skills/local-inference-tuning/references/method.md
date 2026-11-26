# Method

## 1. Baseline (B0)

B0 is the engine with no tuning. It sets only the facts that define the workload.

| Item | B0 value | Why it is fixed |
|---|---|---|
| Model file | the user's choice | Input of the skill. |
| Engine build | pinned tag or commit, container | Input of the skill. |
| Device | GPU on, if the engine needs a flag for it | Without it the engine runs a different path. |
| Context length | the user's need, for example 65536 | An agent session overflows a small default context. |
| Users | 1 | The user's workload. |
| Modality | text only | The user's workload, unless they need images. |
| Thinking | the user's mode, for example on | It changes the output length and the template. |
| Sampling | the model card values, sent by the client | Speculative acceptance depends on temperature. Measure at the values that the user will serve with. |
| Everything else | engine default | No calibration file, empty engine cache, default KV type, default threads, default memory margin, no drafts. |

Rules:

1. Record B0 once, at the start of the campaign. Do not change it later.
2. A calibration file is a tuning result. B0 runs without one.
3. If the engine fails at B0, for example out of memory, record the failure. Then use the smallest change that makes it run, and record that change as part of B0.

## 2. Measurement levels

| Level | Name | Tool | Use |
|---|---|---|---|
| M1 | Micro | the engine's own bench with a real prompt file | Fast check of one knob. Diagnostic only. |
| M2 | Server | `scripts/bench_server.py` against the engine's OpenAI API | Single-request decode, time to first token, cold prefill, needle. Diagnostic and gate. |
| M3 | Agent replay | `scripts/replay.py` against the engine's OpenAI API | The main score. |

NOTE: An engine bench can use different internal settings than its server. RustingStrata adapts expert placement differently in `bench` and `serve`. An M1 gain is a hint. Only M3 decides.

## 3. M1 and M2 details

M1:

1. Use a prompt file that is real code or a real agent transcript. A built-in prose prompt can route few experts and give too-high numbers.
2. Measure prefill and decode at 4K and 32K depth.

M2 measures these values:

1. Decode for one request: the median of 6 or more requests, 512 output tokens each, from a fixed prompt panel.
2. Short time to first token: one short prompt, after a warm-up.
3. Cold prefill at 4K and 32K: a unique document each time, so that no cache hit occurs. Prefill rate is prompt tokens divided by time to first token.
4. Needle: 3 facts in a long document, at 50% and at about 100% of the context.

Count tokens from the server `usage` fields, not from stream chunks. Speculative decoding sends several tokens in one chunk.

## 4. M3: agent replay

### 4.1 Session selection

1. Select 2 or 3 real sessions that the user did with a local model.
2. Prefer sessions with 10 to 60 turns, a context that grows to 20K to 60K tokens, and several tool calls.
3. Remove secrets from the replay files.

### 4.2 Replay design

The replay uses the recorded history, not the new model output. This keeps the workload identical between runs.

Best source: the exact request bodies from a tracing tool, for example Arize Phoenix behind the LLM proxy. Use `scripts/export_phoenix.py` and the notes in `SKILL.md` section 6. They hold the real system prompt, the tools, and the way the agent sends old reasoning back. Second-best source: the agent's session files. Rebuild the requests from those only when no trace exists.

1. For each assistant turn t, use the recorded request, or build it from the recorded messages before turn t. Include the system prompt and the tool definitions. Keep `reasoning_content` on the old assistant messages if the agent sends it.
2. The agent may send no sampling values and rely on the server preset. The replay sends the serving values explicitly, because engines have different defaults.
3. Send the request with streaming and the serving sampling values.
4. Set `max_tokens` to the recorded output length of turn t.
5. Record: time to first token, prompt tokens, cached prompt tokens, output tokens, and decode time.
6. Send the turns in order on one connection, the way the agent does.

### 4.3 Score

The score is the replay time in seconds. Lower is better.

`replay_time = sum over turns of (ttft_t + recorded_output_tokens_t / decode_rate_t)`

This formula does not depend on when the model stops. A model that stops early does not get a better score.

Also report these values:

- the sum of time to first token
- the median decode rate
- the cache hit share, which is cached prompt tokens divided by prompt tokens
- the slowest turn

NOTE: The engine's prompt cache holds the model's own output from turn t, but turn t+1 contains the recorded output. So each turn prefills the recorded output of the previous turn again. Real use is slightly faster than the replay. The bias is the same for every config.

## 5. Runs and statistics

Run each thing once. Spend time only where a result is unclear.

### 5.1 Profiles

| Profile | Content | Time per config | Use |
|---|---|---|---|
| `quick` | M3: S1 complete and the first 10 W1 calls, 1 rep. M2: 3 decode samples, one cold prefill at 4K and at 32K. | 5.0 to 5.5 min measured, of which about 80 s is the engine start | Every candidate |
| `full` | M3: all sessions, 1 rep. M2: 6 decode samples, 2 prefills per size, needle at 50% and 100%. | about 20 min | B0 once, the final best config once |

The quick score is the sum of `replay_s` over the M3 sessions of the profile. Lower is better.

### 5.2 Batches

1. Close all apps that are not needed. Keep the required containers.
2. Put the controls at the start and the end of a batch only: `control, cand1, cand2, ..., candN, control`.
3. Screen independent levers in one batch. Each candidate changes one lever from the same control.
4. Run the batch unattended and detached.
5. Pool all control runs of the same config and load profile, from all batches, to get the mean and the spread. Two controls alone are too few: one batch had 3.5% between its controls, while the pooled spread was 1.5%.

### 5.3 Decision

| Gain of the candidate over the pooled control mean | Decision |
|---|---|
| more than `max(3%, 2 × pooled spread)`, and below every control run | keep |
| between `noise` and that bar | unclear: run it again once in the next batch |
| less than `noise`, or a loss | reject |

Also reject a candidate that makes any M2 value worse by more than 5%, or that fails a request, or that loops.

After a screening batch, combine all kept levers into one config. Confirm the combination in the next batch. Levers can interact: two VRAM levers compete for the same memory.

A batch is void if the controls differ by more than 5%, or if the environment changed. Find the cause before the next batch.

## 6. Ledger

Append one JSON line per run to `ledger.jsonl`:

```json
{"time": "2026-11-26T14:00:00", "config": "a01-kv-q8", "role": "candidate", "level": "M3",
 "session": "s1", "replay_s": 412.3, "ttft_sum_s": 98.1, "decode_med": 61.2, "cache_hit": 0.91,
 "env": {"base_load": "quiet", "gpu_mem_other_mib": 640, "cpu_busy_pct": 4.1},
 "ok": true, "flags": []}
```

Flags: `LOOP`, `REQ_FAIL`, `OOM`, `ENV_CHANGED`, `SUSPECT`.

Write each experiment in `PLAN.md` with: the time, the config name, the one change, the numbers, the verdict, and the reason.

### 5.4 Interruptions

1. If a batch stops, for example by a power loss, remove the engine container and its fresh cache folder.
2. Write a ledger note that marks the cut run as void.
3. Resume with the configs that did not finish. Close the batch with a control. Results of finished configs stay valid if the controls of the resumed part agree with the pooled controls.

### 5.5 Diagnosis before levers

After B0, split the M3 time of one session:

1. Decode part: recorded output tokens divided by decode rate, summed over turns.
2. Time to first token, first turn: the cold prefill.
3. Time to first token, later turns: fit the server `timings.prompt_ms` against the new tokens per turn. The intercept is the fixed cost per request. The slope is the cost per token.

Rank levers by the part they can reduce. In the first campaign the fixed cost was 0.9 s per request, about 21% of the score, and it led to the largest lever.
