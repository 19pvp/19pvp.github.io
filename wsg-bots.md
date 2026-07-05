# WSG Bot Plan

## Goal

Use exactly 10 fixed level 19 playerbots as Warsong Gulch fillers. There should be no general-purpose or regular
playerbot population on this server.

The bots should be available whenever a real player queues WSG, split into two fixed teams of 5. The server is expected
to run crossfaction BGs, so balance should care about BG team slots and roles more than player faction. The bot
characters can still be fixed Horde/Alliance mirrors.

## Desired Behavior

- Keep a configured pool of 10 named bots.
- Define each bot explicitly: name, faction, race, class, role/spec, gear, spells, talents, and behavior profile.
- Keep the pool level-19 only.
- Auto-login only those configured bots.
- Queue bots for Warsong Gulch only when at least one real player is queued.
- Maintain two mirrored fixed bot teams of 5.
- Each team should have the same role shape:
  - 1 priest healer.
  - 3 DPS: mage, warrior, hunter.
  - 1 druid tank/flag carrier that can assist with healing.
- Remove or avoid inviting bots when real players are available for those slots.
- Replace bots by role when possible; if queued players are mostly DPS, remove DPS bots first so healer/tank support
  remains available.
- Never let bots prevent a real player from entering WSG.
- Allow real players to give tactical orders to managed WSG bots.

## Current Problem

Setting `MinRandomBots=10` / `MaxRandomBots=10` in `config/playerbots.json` is not enough for this use case.

That config is aimed at random bot population management. It does not define a stable WSG roster, fixed teams, gear,
names, or queue replacement policy.

The intended end state is to disable normal random/playerbot behavior and keep only the managed WSG filler system.

## Proposed Shape

Add a small custom WSG bot controller on top of `mod-playerbots`:

- A fixed roster source, preferably SQL or a small local config generated from data.
- A startup/load step that ensures the 10 bot characters exist.
- A WSG queue monitor that reacts to real-player WSG queue state.
- A bot slot manager that decides which configured bots should be online, queued, invited, or removed.
- A thin Lua binding layer for fast tuning without recompiling.

## Data Model

Suggested roster fields:

- `team`: `alliance` or `horde`
- `mirror_slot`: links the equivalent bot on the other mirrored team
- `slot`: 1-5 within the fixed team
- `name`
- `account`
- `race`
- `class`
- `level`: always 19
- `role`: healer, dps, tank, flag-carrier, support
- `replacement_priority`: which bot should leave first when a real player needs the slot
- `gear_profile`
- `behavior_profile`
- `enabled`

Gear can initially be SQL-backed using normal character inventory/item tables, then later generated from a sheet if that
becomes easier to maintain.

## Lua Binding Target

Expose only high-level controls to Lua:

- Get configured WSG bot roster.
- Mark a bot behavior profile.
- Ask a bot to queue WSG.
- Ask a bot to leave queue/BG.
- Query real player count and bot count per WSG team.
- Query whether a player is a managed WSG filler bot.
- Send a tactical order to one bot, a role group, or all managed bots on the player's team.

Lua should tune behavior and policies. Character creation, login/session safety, queue internals, and DB writes should
stay in C++/SQL.

## Player Orders

Players should be able to command bots during WSG with simple tactical orders:

- `follow me`: selected bot or group follows the player.
- `defend`: hold a position, base, flag room, tunnel, ramp, or graveyard.
- `attack`: push offense toward the enemy base or a selected target.
- `focus X`: prioritize a named enemy, current target, flag carrier, or healer.
- `pick flag`: send a capable bot to take the enemy flag.
- `return flag`: prioritize recovering the friendly dropped flag.
- `escort`: protect the friendly flag carrier.
- `peel`: protect a healer or flag carrier from attackers.
- `reset`: clear the manual order and return to the bot's default WSG behavior profile.

Orders should be scoped and safe:

- Only affect managed WSG filler bots on the player's team.
- Prefer party/raid leader commands first; loosen later if needed.
- Manual orders should expire after a short timeout or when the objective completes.
- Bot autonomy should still handle survival, interrupts, dispels, and obvious combat reactions.

Command delivery can start with chat commands or Lua calls, then later move to gossip/UI if useful.

## Core Files To Inspect

- `mod-playerbots/src/Bot/RandomPlayerbotMgr.cpp`: current random bot login and BG queue behavior.
- `mod-playerbots/src/Bot/RandomPlayerbotMgr.h`: manager API/state.
- `mod-playerbots/src/Bot/PlayerbotMgr.cpp`: bot session/group control.
- `mod-playerbots/src/Script/Playerbots.cpp`: module scripts and BG hooks.
- `core/src/server/game/Battlegrounds/BattlegroundQueue.cpp`: queue selection/invitation.
- `core/src/server/game/Battlegrounds/BattlegroundMgr.cpp`: BG template/instance handling.
- `core/src/server/game/Battlegrounds/Zones/BattlegroundWS.cpp`: WSG-specific behavior.

## First Milestone

Do not solve full team balancing yet.

First implementation should:

1. Load or create 10 fixed level-19 bot characters.
2. Keep them offline until a real player queues WSG.
3. Queue enough bots to make WSG start.
4. Prefer real players over bots when slots are limited.
5. Log every bot queue/join/leave decision clearly.
