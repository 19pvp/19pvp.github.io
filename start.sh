#!/usr/bin/env sh
export PATH="/root/.deno/bin:$PATH"
deno task config:install
deno serve --env-file --allow-env --allow-net --allow-read --allow-write --allow-run --port=$PORT service/server.ts
