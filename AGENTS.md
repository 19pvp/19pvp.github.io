# Project Notes

## Generated SQL Workflow

- `deno task refresh-db` refreshes Google Sheet data and regenerates derived files in `core_scripts/`.
- Generated SQL files are named `core_scripts/generated-*.sql`.
- Generated SQL is intentionally split for granular refresh/apply behavior:
  - `core_scripts/generated-item-props.sql`: per-item property/stat/name/use-effect updates from the ITEM sheet.
  - `core_scripts/generated-item-template.sql`: shared item normalization, level relaxation, armor restrictions, weapon
    restrictions, and shield restrictions.
  - `core_scripts/generated-quests.sql`: generated quest data plus NPC name/subname/spawn updates from the QUEST and NPC
    sheets.
- `deno task sql` runs `refresh-db` first, then applies changed generated SQL files.
- `deno task sql:apply` applies changed generated SQL files without regenerating them first.
- `deno task sql:dry` validates changed generated SQL files without applying or updating stored hashes.
- The generated SQL runner stores SHA-1 hashes in Deno `localStorage`, using `DENO_DIR=/tmp/deno-cache` and
  `--location=http://19pvp.local` from `deno.json`.
- With no positional file arguments, the runner checks every `core_scripts/generated-*.sql` file.
- With positional file arguments, it checks only those files. Filenames are resolved relative to `core_scripts/`, so
  these are equivalent:
  - `deno task sql:apply -- generated-item-template.sql`
  - `deno task sql:apply -- core_scripts/generated-item-template.sql`
- Use `--force` to rerun selected generated SQL files even when their stored SHA-1 hash matches.
- Use `--dry` with `tasks/refresh_sql.ts` directly to validate without applying:
  - `deno task sql:dry -- --force generated-item-template.sql`

## Generated File Ownership

- Do not hand-edit `core_scripts/generated-*.sql`; update `tasks/refresh_db.ts` and rerun `deno task refresh-db`.
- `tasks/sql_utils.ts` contains shared SQL comment stripping, statement splitting, and transaction application helpers.
- `tasks/sql.ts` remains the one-file SQL validator/applicator for non-generated SQL.
- `tasks/refresh_sql.ts` is the hash-aware generated SQL runner.

## Core Script SQL

- SQL files under `core_scripts/` should be applied by `deno task sql` / `deno task sql:apply`, not loaded from Lua.
- `tasks/refresh_sql.ts` applies generated SQL plus managed core SQL files such as `starting-info.sql` and
  `random-enchant-npc.sql`.
- Starting location, starting gear, and custom starting spells are defined in `core_scripts/starting-info.sql`, not Lua.
- `tasks/refresh_db.ts` regenerates the starting gear section from ITEM sheet rows where `SOURCE` is `Starter`;
  `CLASSES` is a comma-separated list of class names for each starter item.
- `config/worldserver.json` must keep `PlayerStart.CustomSpells` set to `1` for SQL-defined starting spells.
- Keep managed core SQL unqualified by database name; `tasks/refresh_sql.ts` selects `WORLD_DB` before applying it.
