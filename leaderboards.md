# Leaderboard CSV Export Documentation

The Leaderboard CSV export is available via `GET /api/leaderboards/csv?period={period}`. It provides complete, un-paginated player statistics across all PvP match types for a given timeframe.

---

## 1. Route & Filename Format

- **Endpoint**: `GET /api/leaderboards/csv?period={today|week|month|all}`
- **Default Period**: `all`
- **Filename**: `leaderboard-{period}-{YYYY-MM-DDTHH-mm-ss-sssZ}.csv`
- **Content-Type**: `text/csv; charset=utf-8`

---

## 2. Data Layout & Aggregation

### Aggregation Rules
- **Period Windows**:
  - `today`: Daily bucket (past 24h reset at 05:00 local time).
  - `week`: Rolling past 7 daily buckets.
  - `month`: Rolling past 30 daily buckets.
  - `all`: Cumulative total across all recorded matches.
- **Game Types**: Every export includes entries grouped by `kind`:
  - `wsg` (Warsong Gulch battlegrounds)
  - `2v2` (2v2 Arena matches)
  - `3v3` (3v3 Arena matches)
- **Player Filtering**: Only players with at least 1 played match or active metric accumulation in the selected period are exported.
- **Sorting**: Rows are ordered alphabetically by player `name` within each `kind`.

---

## 3. CSV Field Specifications

### Core Metadata Fields

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `kind` | `string` | Game mode type: `wsg`, `2v2`, or `3v3` |
| `playerGuid` | `string` | Unique character GUID |
| `name` | `string` | Character name |
| `class` | `number \| ""` | Character class ID (empty string if unassigned) |
| `matches` | `number` | Total finished matches played in period |
| `timePlayed` | `number` | Total active combat time played in seconds |

### Cumulative Metric Fields

Each raw stat is reported as a total cumulative integer/number for the selected period:

| Metric Field | Description |
| :--- | :--- |
| `damageDone` | Total damage dealt |
| `healingDone` | Total healing done |
| `absorbsDone` | Total damage absorbed |
| `damageTaken` | Total damage received |
| `killingBlows` | Total killing blows |
| `deaths` | Total player deaths |
| `honorableKills` | Total honorable kills |
| `bonusHonor` | Total bonus honor earned |
| `arenaPoints` | Total arena points earned |
| `games` | Games played count |
| `wins` | Games won |
| `losses` | Games lost |
| `successfulInterrupts` | Successful spell interrupts |
| `fakeCastInterrupts` | Enemies baited into fake-casting |
| `hardCCCount` / `hardCCDuration` | Loss of control count & total duration (seconds) |
| `softCCCount` / `softCCDuration` | Movement impairing count & total duration (seconds) |
| `dispelsOffensive` | Offensive dispels performed |
| `dispelsDefensive` | Defensive dispels performed |
| `flagCaptures` | Flag captures (*wsg only*) |
| `flagReturns` | Flag returns (*wsg only*) |
| `flagCarryTime` | Total time holding enemy flag in seconds (*wsg only*) |
| `attemptsOnFlag` | Total flag pickups (*wsg only*) |
| `damageOnEFC` | Damage dealt to enemy flag carrier (*wsg only*) |
| `healsOnFC` | Healing done to friendly flag carrier (*wsg only*) |
| `deserted` | Number of deserted battlegrounds |

### Per-Second Average Fields (`*_avg`)

For every cumulative metric above, an equivalent `{metric}_avg` field is exported representing the per-second rate over `timePlayed`:

$$\mathtt{metric\_avg} = \frac{\mathtt{metric}}{\mathtt{timePlayed}}$$

*(Examples: `damageDone_avg`, `healingDone_avg`, `killingBlows_avg`, `dispelsDefensive_avg`)*
