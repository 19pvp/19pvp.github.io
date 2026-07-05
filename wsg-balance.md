# WSG Balance Plan

## Goal

Keep Warsong Gulch balanced around real players first, with bots acting as elastic fillers.

Bots should make the match possible when the server is empty, but they should not count the same way real players count
when deciding team balance.

The server is expected to run crossfaction BGs. Balance should treat teams as WSG sides, not strict Horde/Alliance
factions, even though the fixed bot roster can still contain mirrored Horde and Alliance characters.

## Balance Rules

- Real players are primary.
- Bots are fillers.
- A real player should always be preferred over a bot.
- Bots should leave queue or battleground slots when real players need space.
- WSG should stay balanced at all times.
- Fixed mirrored bot teams are acceptable for the first version, but replacement should already be role-aware.

## Initial Target

For now:

- When one real player queues WSG, add bots so both teams can form.
- Use two fixed 5-bot teams as the filler baseline.
- Each baseline team has 1 priest healer, 3 DPS bots, and 1 druid tank/flag carrier.
- Keep the two WSG teams symmetrical unless real players require replacement.
- If real queued players are DPS, remove DPS bots first so bot healer/tank roles keep supporting the match.
- Do not let bots create an uneven WSG queue.

Example:

- 1 DPS real player queues.
- That player's WSG team gets 4 bots, dropping one DPS filler first.
- The other WSG team gets 5 bots.
- WSG can start 5v5.

If another DPS real player joins the same WSG team before start:

- That team drops to 3 bots, removing another DPS filler.
- The other team remains 5 bots unless real players are assigned there too.

## Later Target

Team balance should eventually consider:

- Real player count per WSG team.
- Bot count per WSG team.
- Class distribution.
- Healer count.
- Flag carrier availability.
- Player role and bot replacement priority.
- Gear/power score.
- Premade/group constraints.
- Queue wait time.
- Win/loss correction if one side is repeatedly stronger.

## Queue Semantics Needed

The queue needs a way to distinguish:

- Real players.
- Managed WSG filler bots.

Managed WSG filler bots should be excluded or weighted differently in balance calculations. They should be used to fill
the missing side, not to decide whether one side has too many real players.

There should be no regular playerbot category for this server. Any bot in WSG should be part of the managed filler
roster.

## Core Files To Inspect

- `core/src/server/game/Battlegrounds/BattlegroundQueue.h`: queue data structures and selected groups.
- `core/src/server/game/Battlegrounds/BattlegroundQueue.cpp`: group selection, invite, and queue count behavior.
- `core/src/server/game/Battlegrounds/Battleground.cpp`: player add/remove and BG lifecycle.
- `core/src/server/game/Battlegrounds/BattlegroundMgr.cpp`: BG creation and queue updates.
- `core/src/server/game/Battlegrounds/Zones/BattlegroundWS.cpp`: WSG-specific scoring/end rules.
- `mod-playerbots/src/Bot/RandomPlayerbotMgr.cpp`: current bot BG queue automation.
- `mod-playerbots/src/Script/Playerbots.cpp`: existing BG script hooks.

## Implementation Direction

Add a managed-bot identity check first:

- `IsManagedWsgBot(Player*)`
- `IsRealQueuedPlayer(Player*)`
- `GetEffectiveQueueCount(team)`
- `GetFillerBotCount(team)`
- `GetRoleBalance(team)`
- `ChooseBotToReplace(team, incomingPlayerRole)`

Then update WSG queue decisions to use real-player counts first and filler counts second.

Keep the first version simple and explicit. The important part is making bots removable and non-authoritative for team
balance.
