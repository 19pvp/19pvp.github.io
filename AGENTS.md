# Project Notes

## Stack
- Azeroth Core
- deno

## LUA Engine (ALE, ex: eluna)
- Doc is located in doc-ale directory
- New hooks should always try to fit parameter order of existing events
- Custom EventID should start from 7000+ to never conflict with potential new offical ones added

## Generated SQL Workflow

- `deno task refresh-db` refreshes Google Sheet data and regenerates derived files in `sql/`.
- Generated SQL files are named `sql/generated-*.sql`.
- Generated SQL is intentionally split for granular refresh/apply behavior:
  - `sql/generated-item-props.sql`: per-item property/stat/name/use-effect updates from the ITEM sheet.
  - `sql/generated-item-template.sql`: shared item normalization, level relaxation, armor restrictions, weapon
    restrictions, and shield restrictions.
  - `sql/generated-quests.sql`: generated quest data plus NPC name/subname/spawn updates from the QUEST and NPC sheets.
- `deno task sql` runs `refresh-db` first, then applies changed generated SQL files.
- `deno task sql:apply` applies changed generated SQL files without regenerating them first.
- `deno task sql:dry` validates changed generated SQL files without applying or updating stored hashes.
- The generated SQL runner stores SHA-1 hashes in Deno `localStorage`, using `DENO_DIR=/tmp/deno-cache` and
  `--location=http://19pvp.local` from `deno.json`.
- With no positional file arguments, the runner checks every `sql/generated-*.sql` file.
- With positional file arguments, it checks only those files. Filenames are resolved relative to `sql/`, so these are
  equivalent:
  - `deno task sql:apply -- generated-item-template.sql`
  - `deno task sql:apply -- sql/generated-item-template.sql`
- Use `--force` to rerun selected generated SQL files even when their stored SHA-1 hash matches.
- Use `--dry` with `tasks/refresh_sql.ts` directly to validate without applying:
  - `deno task sql:dry -- --force generated-item-template.sql`

## Generated File Ownership

- Do not hand-edit `sql/generated-*.sql`; update `tasks/refresh_db.ts` and rerun `deno task refresh-db`.
- `tasks/sql_utils.ts` contains shared SQL comment stripping, statement splitting, and transaction application helpers.
- `tasks/sql.ts` remains the one-file SQL validator/applicator for non-generated SQL.
- `tasks/refresh_sql.ts` is the hash-aware generated SQL runner.

## Core Script SQL

- SQL files under `core_scripts/` should be applied by `deno task sql` / `deno task sql:apply`, not loaded from Lua.
- `tasks/refresh_sql.ts` applies generated SQL plus managed core SQL files such as `starting-info.sql` and
  `random-enchant-npc.sql`.
- Starting location, starting gear, and custom starting spells are defined in `sql/starting-info.sql`, not Lua.
- `tasks/refresh_db.ts` regenerates the starting gear section from ITEM sheet rows where `SOURCE` is `Starter`;
  `CLASSES` is a comma-separated list of class names for each starter item.
- `config/worldserver.json` must keep `PlayerStart.CustomSpells` set to `1` for SQL-defined starting spells.
- Keep managed core SQL unqualified by database name; `tasks/refresh_sql.ts` selects `WORLD_DB` before applying it.

## Core References

- Commands/runtime: `core/src/server/game/Chat/`; command maps are loaded from `World/World.cpp`.
- Reload behavior: command handlers ultimately call loaders in `Globals/ObjectMgr.cpp`, `Loot/LootMgr.cpp`,
  `DataStores/DBCStores.cpp`, or manager-specific files.
- Script hooks: `core/src/server/game/Scripting/ScriptDefines/*Script.h`; start with `PlayerScript.h`,
  `CreatureScript.h`, `ItemScript.h`, `WorldScript.h`.
- Script dispatch: `core/src/server/game/Scripting/ScriptMgr.h` and `ScriptMgr.cpp`.
- Config keys/defaults: `core/src/server/game/World/WorldConfig.cpp`; runtime access goes through `World/World.h`.
- DBC loading: `core/src/server/game/DataStores/DBCStores.cpp` and `DBCStructure.h`.
- DB-backed templates: `core/src/server/game/Globals/ObjectMgr.cpp` loads creatures, items, quests, and player create
  info.
- Character creation: `core/src/server/game/Entities/Player/Player.cpp`; use this for level 19 start level, location,
  outfit order, custom spells, skills, ammo, and durability behavior.
- Item rules/equipment: `core/src/server/game/Entities/Item/` and player equip checks in `Entities/Player/Player.cpp`.
- Worldserver is not accessible locally and unreachable, prompt the user to get logs or status from it

## Automated Patches & Modules

- The API service in `service/server.ts` automatically applies `.patch` files from the `patches/` folder on startup.
- Patches starting with `mod-` (e.g. `mod-playerbots.patch`) are automatically mapped and applied to
  `${CORE_PATH}/modules/[module-name]/`.
- Patches should NEVER be edited directly you must do the changes on the matching repository locally and generate the
  patch with git commands, ex: `deno task patches:generate`

## Architectural Decision Records (ADRs)

- Architectural and implementation decisions are stored in the `adr/` directory using the
  `adr/[yyyy-mm-dd]_[description].md` naming convention.
- Consult these files before modifying integrated submodules (e.g. refer to
  [adr/2026-06-07_fixed-roster-implem.md](./adr/2026-06-07_fixed-roster-implem.md)
  when changing playerbot matchmaking or lifecycle hooks).

## Lazy senior dev mode

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark intentional simplifications with a `NOTE:` comment. If the shortcut has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment names the ceiling and the upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.