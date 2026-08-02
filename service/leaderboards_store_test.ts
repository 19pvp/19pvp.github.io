import { isLeaderboardMetric, isLeaderboardPeriod, LeaderboardStore } from './leaderboards_store.ts'

const dateAt = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime()

const match = (playerGuid: string, name: string, stats: Record<string, unknown>) => ({
  players: { [playerGuid]: { playerGuid, name, ...stats } },
})

Deno.test('validates the supported leaderboard dimensions', () => {
  if (!isLeaderboardMetric('damageDone') || isLeaderboardMetric('not-a-metric')) throw Error('metric validation failed')
  if (!isLeaderboardPeriod('week') || isLeaderboardPeriod('year')) throw Error('period validation failed')
})

Deno.test('aggregates all-time and rolling periods by stable player guid', () => {
  const store = new LeaderboardStore()
  const today = dateAt(2026, 8, 2)
  store.addMatch(match('1', 'Alice', { damageDone: 100, deserted: false }), today)
  store.addMatch(match('1', 'Alice Renamed', { damageDone: 50, deserted: true }), dateAt(2026, 8, 1))
  store.addMatch(match('2', 'Bob', { damageDone: 120 }), dateAt(2026, 7, 1))

  const all = store.getLeaderboard('damageDone', 'all')
  if (all[0]?.name !== 'Alice Renamed' || all[0]?.value !== 150 || all[0]?.matches !== 2) {
    throw Error(`unexpected all-time result: ${JSON.stringify(all)}`)
  }
  if (store.getLeaderboard('damageDone', 'week')[0]?.value !== 150) throw Error('week aggregation failed')
  if (store.getLeaderboard('damageDone', 'month')[0]?.value !== 150) throw Error('month aggregation failed')
  if (store.getLeaderboard('deserted', 'all')[0]?.value !== 1) throw Error('deserted aggregation failed')
  const data = store.getLeaderboardData('all').find((row) => row.playerGuid === '1')
  if (data?.stats.damageDone !== 150 || data?.timePlayed !== 0) throw Error('client leaderboard data failed')
})

Deno.test('keeps the daily window bounded while retaining all-time totals', () => {
  const store = new LeaderboardStore()
  store.addMatch(match('1', 'Alice', { damageDone: 10 }), dateAt(2026, 7, 1))
  store.addMatch(match('1', 'Alice', { damageDone: 20 }), dateAt(2026, 8, 2))

  if (store.getLeaderboard('damageDone', 'all')[0]?.value !== 30) throw Error('all-time total was lost')
  if (store.getLeaderboard('damageDone', 'month')[0]?.value !== 20) throw Error('old daily bucket was retained')
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
