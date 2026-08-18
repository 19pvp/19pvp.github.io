# Leaderboard & Raw Match Events CSV Export Documentation

The CSV export endpoint is available via `GET /api/leaderboards/csv`.

---

## 1. Export Modes & Endpoints

| Query Parameter | Export Mode | Filename Format |
| :--- | :--- | :--- |
| **Omitted** (`GET /api/leaderboards/csv`) | Raw per-match events | `leaderboard-raw-{timestamp}.csv` |
| `period=today\|week\|month\|all` | Aggregated period totals | `leaderboard-{period}-{timestamp}.csv` |

- **Timestamp format**: `YYYY-MM-DDTHH-mm-ss-sssZ`
- **Content-Type**: `text/csv; charset=utf-8`

---

## 2. Raw Events Export Mode (Period Omitted)

When no `period` parameter is specified, the endpoint queries all recorded `PVP_BG_STATS` and `PVP_ARENA_STATS` match events (from both `web_events` and `web_events_archive`).

### Data Layout
- **Granularity**: Exactly **one row per player per game match event**.
- **No Averages**: Averages (`*_avg`) are omitted.
- **Sorting**: Ordered chronologically by database `eventId`.

### Raw Event CSV Headers

| Column Name | Type | Description |
| :--- | :--- | :--- |
| `eventId` | `number` | Unique web event ID |
| `kind` | `string` | Game mode type (`wsg`, `2v2`, or `3v3`) |
| `at` | `number` | Unix timestamp of match event in milliseconds |
| `playerGuid` | `string` | Character GUID |
| `name` | `string` | Character name |
| `team` | `number \| ""` | Team index/ID for the match |
| `winner` | `number \| ""` | Winning team index/ID |
| `won` | `1 \| 0 \| ""` | `1` if player's team won, `0` if lost, empty if draw/unresolved |
| `damageDone` | `number` | Match damage dealt |
| `healingDone` | `number` | Match healing done |
| `absorbsDone` | `number` | Match damage absorbed |
| `damageTaken` | `number` | Match damage taken |
| `killingBlows` | `number` | Match killing blows |
| `deaths` | `number` | Match deaths |
| `honorableKills` | `number` | Match honorable kills |
| `bonusHonor` | `number` | Match bonus honor |
| `arenaPoints` | `number` | Match arena points |
| `games` | `number` | Match game count increment |
| `wins` | `number` | Match win increment |
| `losses` | `number` | Match loss increment |
| `successfulInterrupts` | `number` | Successful interrupts |
| `fakeCastInterrupts` | `number` | Enemies baited into fake-casting |
| `hardCCCount` / `hardCCDuration` | `number` | Loss of control count & duration (seconds) |
| `softCCCount` / `softCCDuration` | `number` | Movement impairing count & duration (seconds) |
| `dispelsOffensive` | `number` | Offensive dispels performed |
| `dispelsDefensive` | `number` | Defensive dispels performed |
| `flagCaptures` | `number` | Flag captures (*wsg only*) |
| `flagReturns` | `number` | Flag returns (*wsg only*) |
| `flagCarryTime` | `number` | Time holding enemy flag in seconds (*wsg only*) |
| `attemptsOnFlag` | `number` | Flag pickups (*wsg only*) |
| `damageOnEFC` | `number` | Damage dealt to enemy flag carrier (*wsg only*) |
| `healsOnFC` | `number` | Healing done to friendly flag carrier (*wsg only*) |
| `deserted` | `1 \| 0` | Deserted status for match |
| `timePlayed` | `number` | Active combat duration in seconds for match |

---

## 3. Aggregated Period Export Mode (`?period=...`)

When `period={today|week|month|all}` is specified, player stats are aggregated across matches within the given timeframe.

### Data Layout
- **Granularity**: One summary row per player per game mode (`wsg`, `2v2`, `3v3`).
- **Headers**: Includes core player metadata, cumulative totals, plus `{metric}_avg` per-second rates.
- **Averages Formula**:
  $$\mathtt{metric\_avg} = \frac{\mathtt{metric}}{\mathtt{timePlayed}}$$
