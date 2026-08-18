import { stringify } from '@std/csv'
import { isLeaderboardMetric, isLeaderboardPeriod, LeaderboardStore, LEADERBOARD_METRICS } from './leaderboards_store.ts'

const dateAt = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime()

const match = (playerGuid: string, name: string, stats: Record<string, unknown>, result: Record<string, unknown> = {}) => ({
  ...result,
  players: { [playerGuid]: { playerGuid, name, ...stats } },
})

Deno.test('validates the supported leaderboard dimensions', () => {
  if (!isLeaderboardMetric('damageDone') || isLeaderboardMetric('not-a-metric')) throw Error('metric validation failed')
  if (!isLeaderboardPeriod('week') || isLeaderboardPeriod('year')) throw Error('period validation failed')
})

Deno.test('aggregates all-time and rolling periods by stable player guid', () => {
  const store = new LeaderboardStore()
  const today = Date.now()
  store.addMatch(match('1', 'Alice', { damageDone: 100 }), today)
  store.addMatch(match('1', 'Alice Renamed', { damageDone: 50, deserted: 37 }), today - 86_400_000)
  store.addMatch(match('2', 'Bob', { damageDone: 120 }), today - 40 * 86_400_000)

  const all = store.getLeaderboard('damageDone', 'all')
  if (all[0]?.name !== 'Alice Renamed' || Math.floor(all[0]?.value || 0) !== Math.round(Math.log1p(150) * 100_000) || all[0]?.matches !== 2) {
    throw Error(`unexpected all-time result: ${JSON.stringify(all)}`)
  }
  if (Math.floor(store.getLeaderboard('damageDone', 'week')[0]?.value || 0) !== Math.round(Math.log1p(150) * 100_000)) throw Error('week aggregation failed')
  if (Math.floor(store.getLeaderboard('damageDone', 'month')[0]?.value || 0) !== Math.round(Math.log1p(150) * 100_000)) throw Error('month aggregation failed')
  if (Math.floor(store.getLeaderboard('deserted', 'all')[0]?.value || 0) !== Math.round(Math.log1p(1) * 100_000)) throw Error('deserted aggregation failed')
  if (Math.floor(store.getLeaderboard('healingDamageAbsorbs', 'all')[0]?.value || 0) !== Math.round(Math.log1p(150) * 100_000)) throw Error('derived aggregation failed')
  const data = store.getLeaderboardData('all').find((row) => row.playerGuid === '1')
  if (data?.stats.damageDone !== 150 || data?.timePlayed !== 0) throw Error('client leaderboard data failed')
})

Deno.test('aggregates arena metrics without flag metrics', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { arenaPoints: 10, damageDone: 150, team: 0 }, { winner: 0 }), Date.now())
  store.addMatch(match('1', 'Alice', { arenaPoints: 5, damageDone: 100, team: 0 }, { winner: 1 }), Date.now())

  const data = store.getLeaderboardData('all', 'record')
  if (
    data[0]?.stats.arenaPoints !== 15 || data[0]?.stats.damageDone !== 250 || data[0]?.stats.flagCaptures !== 0 ||
    data[0]?.stats.games !== 2 || data[0]?.stats.wins !== 1 || data[0]?.stats.losses !== 1
  ) {
    throw Error('arena metrics aggregation failed')
  }
})

Deno.test('filters arena metrics by arena type', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { damageDone: 100 }, { arenaType: 2 }), Date.now(), 2)
  store.addMatch(match('1', 'Alice', { damageDone: 200 }, { arenaType: 3 }), Date.now(), 2)

  const data = store.getLeaderboardData('all', 'damageDone')
  if (data.length !== 1 || data[0]?.stats.damageDone !== 100) throw Error('arena type filtering failed')
})

Deno.test('does not give a win to an invited player who did not enter', () => {
  const store = new LeaderboardStore()
  store.addMatch({
    winner: 0,
    players: {
      '1': { playerGuid: '1', name: 'Winner', team: 0, timePlayed: 0 },
      '2': { playerGuid: '2', name: 'Invited winner', team: 0, deserted: -1, timePlayed: 0 },
      '3': { playerGuid: '3', name: 'No-show loser', team: 1, deserted: -1, timePlayed: 0 },
    },
  }, Date.now())

  const data = store.getLeaderboardData('all', 'record')
  const winner = data.find((row) => row.playerGuid === '1')
  const invitedWinner = data.find((row) => row.playerGuid === '2')
  const noShowLoser = data.find((row) => row.playerGuid === '3')
  if (
    !winner || winner.stats.games !== 1 || winner.stats.wins !== 1 || winner.stats.losses !== 0 ||
    invitedWinner ||
    !noShowLoser || noShowLoser.stats.games !== 1 || noShowLoser.stats.wins !== 0 || noShowLoser.stats.losses !== 1
  ) {
    throw Error('non-entered arena result aggregation failed')
  }
})

Deno.test('keeps the daily window bounded while retaining all-time totals', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { damageDone: 10 }), dateAt(2026, 7, 1))
  store.addMatch(match('1', 'Alice', { damageDone: 20 }), dateAt(2026, 8, 2))

  if (Math.floor(store.getLeaderboard('damageDone', 'all')[0]?.value || 0) !== Math.round(Math.log1p(30) * 100_000)) throw Error('all-time total was lost')
  if (Math.floor(store.getLeaderboard('damageDone', 'month')[0]?.value || 0) !== Math.round(Math.log1p(20) * 100_000)) throw Error('old daily bucket was retained')
})

Deno.test('sorts ties deterministically', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('2', 'Bob', { damageDone: 10 }), Date.now())
  store.addMatch(match('1', 'Alice', { damageDone: 10 }), Date.now())
  const rows = store.getLeaderboard('damageDone', 'all')
  if (rows[0]?.name !== 'Alice' || rows[1]?.name !== 'Bob') throw Error('tie sorting failed')
})

Deno.test('sorts by maintained averages', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { damageDone: 100, timePlayed: 100 }), Date.now())
  store.addMatch(match('2', 'Bob', { damageDone: 200, timePlayed: 1_000 }), Date.now())

  if (store.getLeaderboardData('all', 'damageDone')[0]?.name !== 'Bob') throw Error('total sorting failed')
  if (store.getLeaderboardData('all', 'damageDone', 'average')[0]?.name !== 'Alice') throw Error('average sorting failed')
})

Deno.test('falls back to the next metric in the selected group', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { successfulInterrupts: 0, fakeCastInterrupts: 5 }), Date.now())
  store.addMatch(match('2', 'Bob', { successfulInterrupts: 2 }), Date.now())
  store.addMatch(match('3', 'Cara', { successfulInterrupts: 0, fakeCastInterrupts: 0 }), Date.now())

  const rows = store.getLeaderboard('successfulInterrupts', 'all')
  if (rows.length !== 2 || rows[0]?.name !== 'Bob' || rows[1]?.name !== 'Alice' || rows[1]?.value <= 0 || rows[1]?.value >= 1) {
    throw Error(`group fallback sorting failed: ${JSON.stringify(rows)}`)
  }
})

Deno.test('supports custom limit in getLeaderboardData', () => {
  const store = new LeaderboardStore()
  const today = Date.now()
  for (let index = 0; index < 105; index++) {
    store.addMatch({ id: `m${index}`, players: { [`p${index}`]: { name: `Player ${index}`, damageDone: (index + 1) * 10 } } }, today)
  }
  const defaultList = store.getLeaderboardData('all', 'damageDone', 'absolute')
  if (defaultList.length !== 100) throw Error(`Expected default limit 100, got ${defaultList.length}`)

  const fullList = store.getLeaderboardData('all', 'damageDone', 'absolute', Infinity)
  if (fullList.length !== 105) throw Error(`Expected full list 105, got ${fullList.length}`)
})

Deno.test('CSV export generates valid CSV header and rows', () => {
  const store = new LeaderboardStore()
  store.addMatch({ id: 'csv1', players: { 'guid-1': { name: 'Tester', damageDone: 500, healingDone: 200 } } }, Date.now())
  const players = store.getRawPlayerData('all')
  const columns = [
    'kind',
    'playerGuid',
    'name',
    'class',
    'matches',
    'timePlayed',
    ...LEADERBOARD_METRICS.map(([key]) => key),
    ...LEADERBOARD_METRICS.map(([key]) => `${key}_avg`),
  ]
  const csvRows = players.map((row) => {
    const record: Record<string, string | number> = {
      kind: 'wsg',
      playerGuid: row.playerGuid,
      name: row.name,
      class: row.class ?? '',
      matches: row.matches,
      timePlayed: row.timePlayed,
    }
    for (const [key] of LEADERBOARD_METRICS) {
      record[key] = row.stats[key] ?? 0
      record[`${key}_avg`] = row.averages[key] ?? 0
    }
    return record
  })
  const csv = stringify(csvRows, { columns })
  const lines = csv.trim().split('\n')
  if (lines.length !== 2) throw Error(`Expected CSV header and 1 data row, got ${lines.length} lines`)
  const header = lines[0].split(',')
  if (!header.includes('kind') || !header.includes('playerGuid') || !header.includes('name') || !header.includes('damageDone') || !header.includes('damageDone_avg')) {
    throw Error(`CSV header missing expected columns: ${lines[0]}`)
  }
})

Deno.test('keeps the other dispel type when the selected type is empty', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Offensive', { dispelsOffensive: 5 }), Date.now())
  store.addMatch(match('2', 'Defensive', { dispelsDefensive: 5 }), Date.now())

  const offensiveRows = store.getLeaderboard('dispelsOffensive', 'all')
  const defensiveRows = store.getLeaderboard('dispelsDefensive', 'all')
  if (!offensiveRows.some(({ name }) => name === 'Defensive') || !defensiveRows.some(({ name }) => name === 'Offensive')) {
    throw Error('dispel fallback sorting failed')
  }
})
