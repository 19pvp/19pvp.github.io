# Architectural Decision: Detach Players from Shared Battleground Queue Groups

## Date

2026-07-11

## Status

Accepted

## Context

AzerothCore represents both solo players and queued parties with `GroupQueueInfo`. When a party queues, every member's
GUID in `BattlegroundQueue::m_QueuedPlayers` points to the same `GroupQueueInfo`, and that object contains the full
`Players` set. Fields such as `teamId`, `IsInvitedToBGInstanceGUID`, and `RemoveInviteTime` therefore apply to the
entire queued party.

That ownership model matches native matchmaking, where a queued party is selected and invited as an indivisible unit.
It does not support the custom WSG policy, which requires all party members to enter the same battleground instance but
allows them to be assigned to different battleground teams.

The ALE `Player:InviteToBattleground(bg, teamId)` API looked like a per-player operation but previously changed the
shared queue record:

1. Inviting the first party member wrote that member's team to the shared `GroupQueueInfo::teamId`.
2. Inviting another member to the other side overwrote the same field.
3. `HandleBattleFieldPortOpcode` later read `ginfo.teamId` when each player accepted the invite.
4. All members therefore entered on the last team written, regardless of the team in their original invite packet.

The shared record also affected rejection and expiration. The leave path iterates `ginfo.Players`, so one member
declining an invite could remove every member still attached to that queue record.

The social `Group` and the queued `GroupQueueInfo` are separate concepts. AzerothCore already preserves the original
social group while players are temporarily placed into team-specific battleground raids. The required change is thus
to split queue ownership, not to disband or modify the social party.

## Decision

Add `BattlegroundQueue::DetachPlayerFromGroup(ObjectGuid guid, TeamId teamId)` as the single core operation for turning
one member of a shared queue group into an independently owned queue record.

Lua remains responsible for matchmaking policy and chooses each player's battleground team. C++ remains responsible
for queue storage, pointer ownership, invitation state, expiration, acceptance, and cleanup.

### Detachment Algorithm

`DetachPlayerFromGroup` performs the following steps:

1. Find the player's current `GroupQueueInfo` through `m_QueuedPlayers`.
2. Return `nullptr` without changing state if the player has no valid queue record.
3. If the queue record already contains only that player, update its `teamId` and return it without allocating.
4. Otherwise, copy the complete `GroupQueueInfo` into a new record.
5. Replace the copied `Players` set with only the detached player's GUID.
6. Set the detached record's independently selected `teamId`.
7. Clear `IsInvitedToBGInstanceGUID` and `RemoveInviteTime`, because invite state must be established only after
   detachment.
8. Remove the player's GUID from the original record.
9. Redirect that player's `m_QueuedPlayers` entry to the detached record.
10. Add the detached record to the same `m_QueuedGroups[BracketId][GroupType]` storage list as the original.

The complete structure is copied instead of manually rebuilding selected fields. `GroupQueueInfo` contains queue
metadata used by cleanup, wait-time accounting, arenas, and matchmaking. Copying preserves fields such as `BracketId`,
`GroupType`, `RealTeamID`, ratings, and opponent metadata and avoids uninitialized-state bugs when fields are added or
used later.

The detached record stays in the original queue bucket even if its assigned `teamId` differs from the bucket's native
faction. At this point the player has already been selected for immediate invitation. The bucket is also the ownership
location that `RemovePlayer()` searches using the record's `BracketId` and `GroupType`; inserting it elsewhere while
retaining copied metadata would make cleanup unable to find the record.

### Invitation Ordering

`Player:InviteToBattleground` now uses this order:

1. Validate the player, battleground, and requested team.
2. Check the player's own queue invite state for idempotency before any mutation.
3. Detach the player from any shared queue record.
4. Abort and return `false` if no queue record exists.
5. Establish the player's queue slot and per-player invited instance.
6. Increment the battleground's invited count for the selected team.
7. Store the instance and expiration time on the now-single-player `GroupQueueInfo`.
8. Schedule that player's removal event.
9. Send the invite packet containing the selected team.

After this sequence, the accept handler reads a stable per-player `ginfo.teamId`, and declining or timing out affects
only that player's one-element `Players` set.

### Shared Core Consumers

Both custom distribution branches in `BattlegroundQueueUpdate` use `DetachPlayerFromGroup` before
`InviteGroupToBG`:

- filling an existing battleground with free slots;
- creating and filling a new non-rated battleground.

The ALE direct invitation method uses the same helper. Queue splitting therefore has one implementation and the native
distribution hook and manual Lua-created battleground path follow the same ownership rules.

## Invariants

- Every queued player GUID maps to exactly one live `GroupQueueInfo` through `m_QueuedPlayers`.
- Every live `GroupQueueInfo` is owned by exactly one `m_QueuedGroups[BracketId][GroupType]` list.
- A detached invitation record contains exactly one player.
- The original record remains valid for its remaining players and is deleted normally when its last player leaves.
- Invite state is written only after detachment, so it cannot leak from one member to another.
- `teamId` on a detached record is the authoritative team later read by the battlefield port handler.
- Detachment never changes or destroys the player's social `Group`.
- This mechanism is intended for custom non-rated battleground distribution. Rated arena teams must remain atomic
  because their queue records also carry shared rating and opponent semantics.

For a three-player party, the first invited member receives a copied one-player record, the second receives another
copied record from the remaining two-player record, and the third keeps the now-single-player original. All three
records retain valid queue ownership metadata and can accept, reject, or expire independently.

## Consequences

### Positive

- Lua can assign members of one queued party to different teams in the same battleground.
- The last invitation no longer overwrites the team used by earlier members.
- Accept, reject, and timeout behavior becomes per-player after custom distribution.
- Social party membership remains intact outside the battleground.
- New queue metadata is automatically preserved by structure copying.
- The previous duplicated and partially initialized queue-splitting code is removed.

### Costs and Limitations

- A distributed party temporarily uses up to one `GroupQueueInfo` allocation per player until the invitations resolve.
  Battleground player limits keep this bounded.
- `GroupType` continues to describe the queue storage bucket selected before detachment; it is not guaranteed to match
  the player's final battleground team.
- The helper does not perform matchmaking or validate team balance. Lua or the distribution hook must decide teams
  before calling it.
- This decision does not address combat faction or client presentation for same-faction opponents; it only makes queue
  and battleground team assignment independent per player.

## Rejected Alternatives

### Mutate the Shared `teamId` for Each Invite

Rejected because `HandleBattleFieldPortOpcode` reads the shared value later, after all invite calls. The last write wins.

### Add a Per-Player Team Map Inside `GroupQueueInfo`

Rejected because all accept, reject, timeout, invited-count, and cleanup paths would need to understand two ownership
models. It would leave group-wide `Players` iteration dangerous and create a much larger core change.

### Manually Construct Partial Queue Records

Rejected because omitted fields such as `BracketId` or `GroupType` break `RemovePlayer()`, while omitted rating and
opponent fields create latent arena bugs. Copying the authoritative record is smaller and safer.

### Disband the Social Party

Rejected because the social group is not the source of the queue-team overwrite. AzerothCore already overlays
team-specific battleground raids and restores the original group afterward.

### Let Lua Modify Queue Containers Directly

Rejected because the two queue indexes own raw `GroupQueueInfo` pointers and must remain synchronized. Ownership and
cleanup stay in C++ while Lua supplies only policy decisions.

## Verification

- The configured `deno task compile` build completed successfully, including `worldserver` linking.
- `deno task test:lua` runs `tasks/wsg_balance_test.lua` and verifies balanced assignment, group preservation where
  possible, faction preference, randomized split selection, and player counts from 1 through 20.
- Runtime acceptance, rejection, and expiration still require verification against the deployed worldserver logs.

## Relevant Files

- `core/src/server/game/Battlegrounds/BattlegroundQueue.h`
- `core/src/server/game/Battlegrounds/BattlegroundQueue.cpp`
- `core/src/server/game/Handlers/BattleGroundHandler.cpp`
- `mod-ale/src/LuaEngine/methods/PlayerMethods.h`
- `core_scripts/bots.lua`
- `core_scripts/wsg_balance.lua`
- `tasks/wsg_balance_test.lua`
- `patches/core.patch`
- `patches/mod-ale.patch`
