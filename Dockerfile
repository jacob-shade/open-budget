# syntax=docker/dockerfile:1

# ---------- 1. Build the React frontend ----------
FROM node:24-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- 2. Build the Rust backend ----------
FROM rust:1.99-slim-trixie AS backend
# perl + make: build the OpenSSL that SQLCipher (database encryption) is linked against.
RUN apt-get update \
    && apt-get install -y --no-install-recommends perl make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Cache dependency builds: compile against a stub main first.
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src target/release/deps/open_budget*
COPY backend/migrations ./migrations
COPY backend/src ./src
RUN cargo build --release --locked

# ---------- 3. Runtime ----------
FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app app \
    && mkdir -p /data && chown app /data
WORKDIR /app
COPY --from=backend /app/target/release/open-budget /app/open-budget
COPY --from=frontend /app/dist /app/static

ENV BIND_ADDR=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:///data/budget.db \
    RUST_LOG=open_budget=info,tower_http=info

USER app
VOLUME /data
EXPOSE 3000
CMD ["/app/open-budget"]
