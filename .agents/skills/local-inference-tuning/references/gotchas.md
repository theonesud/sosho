# Gotchas

## Measurement

1. An engine bench and an engine server can use different internal settings. Measure the server for decisions.
2. A built-in bench prompt can route few experts. It gives too-high numbers on a hybrid MoE model.
3. Speculative decoding sends several tokens in one stream chunk. Count tokens from `usage`.
4. A repeated filler document raises n-gram and MTP acceptance. Use real text.
5. The first run after a container start compiles kernels and fills the page cache. Discard it.
6. A cache hit is not prefill. Report cold prefill and warm turns separately.
7. A proxy or gateway can cut long requests at a timeout, often 600 s. Test the engine directly.

## Containers

1. A CUDA runtime package can lack the `/usr/local/cuda` link and the unversioned `libnvrtc.so`. Point the library path at the versioned folder, or give the engine the exact library name.
2. Without a mounted cache folder, every new container compiles kernels again and loses calibration and routing profiles.
3. A dangling build cache can fill a small disk. Prune it after each image build.
4. Build the image with the same compiler and CPU target as a host build. Then a host and a container run give the same speed. We measured the difference at less than 1%.
5. A forced container stop during a long prefill can cause a GPU fault. Stop the client first, then stop the container with a timeout.

## Host

1. A busy host CPU slows GPU decode when experts run on the CPU.
2. A database container in the user's stack can use a full core when it is idle. Record it in the base load.
3. The GPU that drives the desktop has less free VRAM. A browser or a video wallpaper can take several hundred MB.
4. An idle GPU lowers its PCIe link speed. Read the link speed under load.
5. Swap use slows page-cache reads of the model file.
6. Do not use `pkill -f` or `pgrep -f` with a pattern that also matches your own shell.
7. Detach long jobs with `setsid nohup`, so that an agent restart does not kill them.

## Model

1. The MTP head of an abliterated model can be stripped. Check the GGUF tensor list for the draft layer.
2. A hybrid linear-attention model keeps a recurrent state. A lower-precision state can produce garbage output. Check the output after a state type change.
3. Speculative acceptance depends on the content, the temperature, and thinking mode. Report them with every number.

## Hybrid MoE with experts offloaded

1. A prefill of only 100 tokens routes to almost every expert in every layer. If the engine uploads missed experts over PCIe for prefill, each agent turn pays a fixed cost of several GB of copies. Measure it: fit server `prompt_ms` against new tokens. An intercept near 1 s means this cost.
2. Speculative decoding can slow agent work even when decode gets faster: the draft head takes VRAM and slows prefill.
3. Turning off expert adaptation to save the copies after each prefill can cost far more in decode.
4. A conversation-level prompt cache does not share a system prompt between separate requests. Single calls get no cache hit.

## Runs

1. Two controls per batch are too few to measure noise. Pool all control runs of the same config and load profile.
2. Check free disk space before each batch and each image build. Other containers, for example a ClickHouse with system logs, can fill the disk during a campaign.
3. A power loss voids the running config. Clean up the engine container and its cache folder, write a note in the ledger, and resume with the next config. A cut while the GPU was idle points to the mains, not to the load.
4. An environment check that lists containers must ignore the engine container itself.
5. `pgrep -f PATTERN` matches the shell that runs it. Match the exact argument start with `ps -eo args | grep '^python3 ...'`.
6. A redaction pattern on words like "secret" matches normal text. Require a `:` or `=` after the key name.
7. An agent can send no sampling values and rely on the server preset. A new engine with a greedy default then changes the output without an error.
8. A yardstick engine needs its own smoke test before a batch. The llama.cpp container in the first campaign exited at start with an empty log, and the batch went on without it.
