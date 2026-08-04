import { auth, characters, type SqlRow } from './db.ts'
import { type WebEvent, wowEvents } from './wow-events.ts'
import {
  isLeaderboardArenaType,
  isLeaderboardPeriod,
  isLeaderboardSortMetric,
  isLeaderboardValueMode,
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

export const getLeaderboards = async (
  metricParam: string,
  periodParam: string,
  modeParam = 'absolute',
  kindParam = 'battleground',
  arenaTypeParam = 'all',
) => {
  await leaderboardReady
  if (!isLeaderboardSortMetric(metricParam)) throw new Error('Unknown leaderboard metric')
  if (!isLeaderboardPeriod(periodParam)) throw new Error('Unknown leaderboard period')
  if (!isLeaderboardValueMode(modeParam)) throw new Error('Unknown leaderboard mode')
  if (!isLeaderboardKind(kindParam)) throw new Error('Unknown leaderboard kind')
  if (!isLeaderboardArenaType(arenaTypeParam)) throw new Error('Unknown leaderboard arena type')

  const definition = metricsByKey[metricParam]
  const store = kindParam === 'arena' ? arenaStores.get(arenaTypeParam)! : battlegroundStore
  const rows = store.getLeaderboardData(
    periodParam as LeaderboardPeriod,
    metricParam as LeaderboardSortMetric,
    modeParam as LeaderboardValueMode,
  )
  return {
    metric: definition,
    period: periodParam,
    arenaType: arenaTypeParam,
    rows,
  }
}

export { battlegroundStore as leaderboardStore }
