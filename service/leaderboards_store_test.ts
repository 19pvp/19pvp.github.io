import { isLeaderboardMetric, isLeaderboardPeriod, LeaderboardStore } from './leaderboards_store.ts'

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
  const today = dateAt(2026, 8, 2)
  store.addMatch(match('1', 'Alice', { damageDone: 100, deserted: false }), today)
  store.addMatch(match('1', 'Alice Renamed', { damageDone: 50, deserted: 37 }), dateAt(2026, 8, 1))
  store.addMatch(match('2', 'Bob', { damageDone: 120 }), dateAt(2026, 7, 1))

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

Deno.test('does not give a win to an invited player who did not enter', () => {
  const store = new LeaderboardStore()
  store.addMatch({
    winner: 0,
    players: {
      '1': { playerGuid: '1', name: 'Winner', team: 0, deserted: false, timePlayed: 0 },
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
