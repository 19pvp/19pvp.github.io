#!/usr/bin/env sh
cd "$(dirname "$0")"
export PATH="/root/.deno/bin:$PATH"
deno serve --watch=service --env-file --allow-env --allow-net --allow-read --allow-write --allow-run --port=$PORT service/server.ts
