#!/usr/bin/env sh
export PATH="/root/.deno/bin:$PATH"
deno task --env-file config:install
deno serve --watch=service,config --env-file --allow-env --allow-net --allow-read --allow-write --allow-run --port=$PORT service/server.ts
