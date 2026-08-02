import { auth, characters, type SqlRow } from './db.ts'
import { type WebEvent, wowEvents } from './wow-events.ts'
import {
  isLeaderboardSortMetric,
  isLeaderboardPeriod,
  isLeaderboardValueMode,
  metricsByKey,
  type LeaderboardSortMetric,
  type LeaderboardPeriod,
  type LeaderboardValueMode,
  LeaderboardStore,
} from './leaderboards_store.ts'
import { env } from './env.ts'

const BATCH_SIZE = 1_000
const store = new LeaderboardStore()
let replayedThrough = 0

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

const applyEvent = (event: Pick<WebEvent, 'id' | 'at' | 'data'> | SqlRow) => {
  store.addMatch(eventData(event.data), eventTimestamp(event))
}

const replay = async () => {
  let cursor = 0
  while (true) {
    const events = await auth.sql`
      SELECT id, at, data FROM web_events
      WHERE world=${env.WORLD_ID} AND type='PVP_BG_STATS' AND id > ${cursor}
      UNION ALL
      SELECT id, at, data FROM web_events_archive
      WHERE world=${env.WORLD_ID} AND type='PVP_BG_STATS' AND id > ${cursor}
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `
    if (!events.length) break

    for (const event of events) {
      applyEvent(event)
      cursor = Math.max(cursor, Number(event.id) || cursor)
    }
  }

  const guids = [...store.players.keys()].filter((guid) => /^\d+$/.test(guid))
  const existingGuids = new Set<string>()
  for (let offset = 0; offset < guids.length; offset += BATCH_SIZE) {
    const classes = await characters.raw.sql`
      SELECT guid, class FROM characters WHERE guid IN (${guids.slice(offset, offset + BATCH_SIZE).join(',')})
    `
    for (const row of classes) {
      const guid = String(row.guid)
      existingGuids.add(guid)
      const player = store.players.get(guid)
      const classId = Number(row.class)
      if (player && Number.isInteger(classId) && classId > 0) player.class = classId
    }
  }
  for (const guid of guids) {
    if (!existingGuids.has(guid)) store.players.delete(guid)
  }

  replayedThrough = cursor
}

export const leaderboardReady = replay().catch((error) => {
  console.error('Failed to hydrate battleground leaderboards', error)
  throw error
})

wowEvents.on.PVP_BG_STATS(async (event) => {
  await leaderboardReady
  if (Number(event.id) <= replayedThrough) return
  applyEvent(event)
  replayedThrough = Math.max(replayedThrough, Number(event.id) || replayedThrough)
})

export const getLeaderboards = async (metricParam: string, periodParam: string, modeParam = 'absolute') => {
  await leaderboardReady
  if (!isLeaderboardSortMetric(metricParam)) throw new Error('Unknown leaderboard metric')
  if (!isLeaderboardPeriod(periodParam)) throw new Error('Unknown leaderboard period')
  if (!isLeaderboardValueMode(modeParam)) throw new Error('Unknown leaderboard mode')

  const definition = metricsByKey[metricParam]
  const rows = store.getLeaderboardData(
    periodParam as LeaderboardPeriod,
    metricParam as LeaderboardSortMetric,
    modeParam as LeaderboardValueMode,
  )
  return {
    metric: definition,
    period: periodParam,
    rows,
  }
}

export { store as leaderboardStore }
