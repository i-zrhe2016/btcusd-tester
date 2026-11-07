# syntax=docker/dockerfile:1.7
FROM rust:1.88-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY services/market-data services/market-data
COPY services/backtest services/backtest
COPY services/crypto_symbols.rs services/crypto_symbols.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/target,id=rust-target,sharing=locked \
    CARGO_TARGET_DIR=/target cargo build --locked --release -p backtest-service \
    && cp /target/release/backtest-service /usr/local/bin/backtest-service

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
COPY --from=builder /usr/local/bin/backtest-service /usr/local/bin/backtest-service
USER app
EXPOSE 8082
ENTRYPOINT ["backtest-service"]
