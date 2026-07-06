# Architectural Decision: Fixed Roster Matching and Lifecycle Separation

## Date
2026-07-06

## Status
Accepted

## Context & "Why"
Fixed-roster bots (managed by `mod-playerbots-fixed-roster`) need to fill Battleground queues, but the queue matchmaking system in `mod-playerbots` explicitly filters out non-random bots via `IsRandomBot`. 

We had to reconcile this matchmaking requirement with the fact that fixed-roster bots must **not** undergo standard random bot lifecycle routines (e.g. periodic gear/level randomization, teleports to random zones, and auto-logouts). 

## Decisions & Rationale

1. **Exempt Fixed Roster from Lifecycle Management, but Keep Random Bot Classification:**
   - **Why:** This achieves the dual goal of letting matchmaking queues read them as random bots while preventing the engine from ruining their curated level-19 specifications, custom items, and starting locations.
2. **Lazy Database Cache for Fixed Roster GUIDs:**
   - **Why:** Avoids expensive SQL queries on high-frequency matchmaking updates while maintaining decoupled configuration between modules.

---

## Rejected Alternatives

### 1. Modifying Matchmaking Queue Queries Directly
* **Why Rejected:** Changing queue filters in `mod-playerbots` (e.g., checking account prefixes) would split the definition of a "random bot" across dozens of files. This would make the submodule highly invasive and difficult to merge/maintain during upstream updates.

### 2. Allowing Roster Bots to run through `ProcessBot` (Lifecycle)
* **Why Rejected:** The random manager would frequently randomize the bots' talents, downgrade/upgrade their level, equip random gear, and teleport them away from their starting zones.

---

## Weird Behaviors & Things to Keep in Mind

* **Lifecycle Delegation:** Because the core random manager bypasses these bots, it will not handle their logouts or crashed reconnections. The fixed-roster manager is now solely responsible for keeping them online.
* **Database Sync Lag:** The GUID cache is loaded lazily. Direct SQL edits to `playerbots_fixed_roster_guid` won't take effect until `.rosterbots reload` is called to clear the cache.
* **Account Type Collision:** Roster bots must belong to accounts marked as type 1 (RNDbot). If they are misconfigured as type 2 (AddClass) in `playerbots_account_type`, some checks will behave unexpectedly.
