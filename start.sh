#!/usr/bin/env sh
export PATH="/root/.deno/bin:$PATH"
deno serve --unstable-raw-imports --env-file="$(dirname "$0")/.env" --allow-env --allow-net --allow-read --allow-write --allow-run --port=$PORT service/server.ts
