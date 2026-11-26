ARG RUST_VERSION
FROM rust:${RUST_VERSION}-slim-bookworm AS build
WORKDIR /src
COPY . .
ENV RUSTFLAGS="-C target-cpu=native"
RUN cargo build --release --locked && cp target/release/rustingstrata /rustingstrata

FROM ubuntu:24.04
ARG NVRTC_PKG=cuda-nvrtc-13-5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /tmp/k.deb https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb \
 && dpkg -i /tmp/k.deb && rm /tmp/k.deb && apt-get update \
 && apt-get install -y --no-install-recommends ${NVRTC_PKG} \
 && rm -rf /var/lib/apt/lists/*
ENV LD_LIBRARY_PATH=/usr/local/cuda-13.5/targets/x86_64-linux/lib \
    STRATA_NVRTC=libnvrtc.so.13 STRATA_NO_UPDATE_CHECK=1 XDG_CACHE_HOME=/cache NVIDIA_DRIVER_CAPABILITIES=compute,utility
COPY --from=build /rustingstrata /usr/local/bin/rustingstrata
ENTRYPOINT ["rustingstrata"]
