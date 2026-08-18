import { auth, characters, type SqlRow } from './db.ts'
import { type WebEvent, wowEvents } from './wow-events.ts'
import { stringify } from '@std/csv'
import {
  isLeaderboardArenaType,
  isLeaderboardPeriod,
  isLeaderboardSortMetric,
  isLeaderboardValueMode,
  LEADERBOARD_METRICS,
  type LeaderboardArenaType,
  type LeaderboardPeriod,
  type LeaderboardSortMetric,
  LeaderboardStore,
  type LeaderboardValueMode,
  metricsByKey,
} from './leaderboards_store.ts'
import { env } from './env.ts'

const BATCH_SIZE = 1_000
const battlegroundStore = new LeaderboardStore()
const arenaStores = new Map<LeaderboardArenaType, LeaderboardStore>([
  ['all', new LeaderboardStore()],
  ['2v2', new LeaderboardStore()],
  ['3v3', new LeaderboardStore()],
])
const stores = [battlegroundStore, ...arenaStores.values()]
let replayedThrough = 0

type LeaderboardKind = 'battleground' | 'arena'

const isLeaderboardKind = (value: string): value is LeaderboardKind => value === 'battleground' || value === 'arena'

const eventTimestamp = (event: Pick<WebEvent, 'at'> | SqlRow) => {
  const value = event.at
  return value instanceof Date ? value.getTime() : Number(value) || Date.now()
}

const eventData = (data: unknown) => {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

const applyEvent = (event: Pick<WebEvent, 'id' | 'at' | 'data' | 'type'> | SqlRow) => {
  const payload = eventData(event.data)
  const timestamp = eventTimestamp(event)
  if (event.type !== 'PVP_ARENA_STATS') {
    battlegroundStore.addMatch(payload, timestamp)
    return
  }

  arenaStores.get('all')!.addMatch(payload, timestamp)
  arenaStores.get('2v2')!.addMatch(payload, timestamp, 2)
  arenaStores.get('3v3')!.addMatch(payload, timestamp, 3)
}

const missingClassGuids = new Set<string>()

const synchronizeMissingCharacters = async () => {
  for (const store of stores) {
    for (const guid of store.players.keys()) {
      const player = store.players.get(guid)
      if (player && player.class === undefined && /^\d+$/.test(guid)) missingClassGuids.add(guid)
    }
  }

  const guids = [...missingClassGuids]
  const foundGuids = new Set<string>()
  for (let offset = 0; offset < guids.length; offset += BATCH_SIZE) {
    const classes = await characters.raw.sql`
      SELECT guid, class FROM characters WHERE guid IN (${guids.slice(offset, offset + BATCH_SIZE).join(',')})
    `
    for (const row of classes) {
      const guid = String(row.guid)
      foundGuids.add(guid)
      const classId = Number(row.class)
      if (!Number.isInteger(classId) || classId <= 0) continue

      missingClassGuids.delete(guid)
      for (const store of stores) {
        const player = store.players.get(guid)
        if (player) player.class = classId
      }
    }
  }

  for (const guid of guids) {
    if (!foundGuids.has(guid)) {
      for (const store of stores) store.removePlayer(guid)
      missingClassGuids.delete(guid)
    }
  }
}

const replay = async () => {
  let cursor = 0
  while (true) {
    const events = await auth.sql`
      SELECT id, type, at, data FROM web_events
      WHERE world=${env.WORLD_ID} AND type IN ('PVP_BG_STATS', 'PVP_ARENA_STATS') AND id > ${cursor}
      UNION ALL
      SELECT id, type, at, data FROM web_events_archive
      WHERE world=${env.WORLD_ID} AND type IN ('PVP_BG_STATS', 'PVP_ARENA_STATS') AND id > ${cursor}
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `
    if (!events.length) break

    for (const event of events) {
      applyEvent(event)
      cursor = Math.max(cursor, Number(event.id) || cursor)
    }
  }

  await synchronizeMissingCharacters()

  replayedThrough = cursor
}

export const leaderboardReady = replay().catch((error) => {
  console.error('Failed to hydrate battleground leaderboards', error)
  throw error
})

const handleMatchEvent = async (event: WebEvent) => {
  await leaderboardReady
  if (Number(event.id) <= replayedThrough) return
  applyEvent(event)
  await synchronizeMissingCharacters()
  replayedThrough = Math.max(replayedThrough, Number(event.id) || replayedThrough)
}

wowEvents.on.PVP_BG_STATS(handleMatchEvent)
wowEvents.on.PVP_ARENA_STATS(handleMatchEvent)

export type LeaderboardParams = {
  metric: LeaderboardSortMetric
  period: LeaderboardPeriod
  mode: LeaderboardValueMode
  kind: LeaderboardKind
  arenaType: LeaderboardArenaType
}

export const assertLeaderboardParams = (
  metricParam: string,
  periodParam: string,
  modeParam: string,
  kindParam: string,
  arenaTypeParam: string,
): LeaderboardParams => {
  if (!isLeaderboardSortMetric(metricParam)) throw Error('Unknown leaderboard metric')
  if (!isLeaderboardPeriod(periodParam)) throw Error('Unknown leaderboard period')
  if (!isLeaderboardValueMode(modeParam)) throw Error('Unknown leaderboard mode')
  if (!isLeaderboardKind(kindParam)) throw Error('Unknown leaderboard kind')
  if (!isLeaderboardArenaType(arenaTypeParam)) throw Error('Unknown leaderboard arena type')

  return {
    metric: metricParam,
    period: periodParam,
    mode: modeParam,
    kind: kindParam,
    arenaType: arenaTypeParam,
  }
}

export const getLeaderboards = async (params: LeaderboardParams) => {
  await leaderboardReady
  const { metric, period, mode, kind, arenaType } = params
  const definition = metricsByKey[metric]
  const store = kind === 'arena' ? arenaStores.get(arenaType)! : battlegroundStore
  const rows = store.getLeaderboardData(period, metric, mode)
  return {
    metric: definition,
    period,
    arenaType,
    rows,
  }
}

export const getLeaderboardsCsv = async (periodParam?: string) => {
  await leaderboardReady

  if (!periodParam) {
    const columns = [
      'eventId',
      'kind',
      'at',
      'playerGuid',
      'name',
      'team',
      'winner',
      'won',
      ...LEADERBOARD_METRICS.map(([key]) => key),
    ]

    const csvRows: Record<string, string | number>[] = []
    let cursor = 0

    while (true) {
      const events = await auth.sql`
        SELECT id, type, at, data FROM web_events
        WHERE world=${env.WORLD_ID} AND type IN ('PVP_BG_STATS', 'PVP_ARENA_STATS') AND id > ${cursor}
        UNION ALL
        SELECT id, type, at, data FROM web_events_archive
        WHERE world=${env.WORLD_ID} AND type IN ('PVP_BG_STATS', 'PVP_ARENA_STATS') AND id > ${cursor}
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      `
      if (!events.length) break

      for (const event of events) {
        cursor = Math.max(cursor, Number(event.id) || cursor)
        const payload = eventData(event.data) as Record<string, unknown> | null
        if (!payload) continue
        const players = payload.players as Record<string, Record<string, unknown>> | undefined
        if (!players || typeof players !== 'object') continue

        const isArena = event.type === 'PVP_ARENA_STATS'
        const arenaType = payload.arenaType || payload.type
        const kindLabel = isArena ? (arenaType === 2 || arenaType === '2v2' ? '2v2' : '3v3') : 'wsg'
        const at = eventTimestamp(event)
        const winner = payload.winner

        for (const [guidKey, rawStats] of Object.entries(players)) {
          if (!rawStats || typeof rawStats !== 'object') continue
          const playerGuid = String(rawStats.playerGuid || guidKey)
          const name = String(rawStats.name || playerGuid)
          const team = rawStats.team
          const won = typeof winner === 'number' && typeof team === 'number' ? (String(team) === String(winner) ? 1 : 0) : ''

          const record: Record<string, string | number> = {
            eventId: Number(event.id),
            kind: kindLabel,
            at,
            playerGuid,
            name,
            team: typeof team === 'number' ? team : '',
            winner: typeof winner === 'number' ? winner : '',
            won,
          }

          for (const [key] of LEADERBOARD_METRICS) {
            const val = rawStats[key]
            if (key === 'deserted') {
              record[key] = val ? 1 : 0
            } else {
              const num = Number(val)
              record[key] = Number.isFinite(num) && num > 0 ? num : 0
            }
          }

          csvRows.push(record)
        }
      }
    }

    return stringify(csvRows, { columns })
  }

  if (!isLeaderboardPeriod(periodParam)) throw Error('Unknown leaderboard period')

  const storeEntries: Array<['wsg' | '2v2' | '3v3', LeaderboardStore]> = [
    ['wsg', battlegroundStore],
    ['2v2', arenaStores.get('2v2')!],
    ['3v3', arenaStores.get('3v3')!],
  ]

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

  const csvRows = storeEntries.flatMap(([kindLabel, store]) => {
    const players = store.getRawPlayerData(periodParam as LeaderboardPeriod)
    return players.map((row) => {
      const record: Record<string, string | number> = {
        kind: kindLabel,
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
  })

  return stringify(csvRows, { columns })
}

export { battlegroundStore as leaderboardStore }
