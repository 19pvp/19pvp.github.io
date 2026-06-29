#!/usr/bin/env sh
/root/.deno/bin/deno serve --env-file --allow-env --allow-net --allow-read --allow-write --allow-run --port=$PORT service/server.ts
