import { sql, type SqlRow } from './db.ts'

// tables
const worldId = Number(Deno.env.get('WORLD_ID')) || 1

const eventTypes = [
  'COMMAND', // { player, target?, map, x, y, z, o, command }
  'LOGIN', // { id } -- playerId
  'LOGOUT', // { id } -- playerId
  'STARTUP',
  'SHUTDOWN',
  'QUEUE_STATE',
  'BATTLEGROUND_JOIN',
  'BATTLEGROUND_LEAVE',
  'BATTLEGROUND_START',
  'BATTLEGROUND_END',
  'PLAYER_LOCATION',
  'PVP_KILL', // { player, victim, map, x, y, z }
  'LUCKY_FISHING_HAT_OBTAINED', // { player }
  'ARENA_GRAND_MASTER_OBTAINED', // { player }
  'GENERAL_CHANNEL_MESSAGE',
] as const

type WowEventType = typeof eventTypes[number]

type WebEvent = SqlRow & {
  id: number
  type: string
  at: Date | number
  data?: string | Record<string, unknown>
  start?: Date | number
  elapsed?: number
  purged?: boolean
}

type EventHandler = (event: WebEvent) => void | Promise<void>

const ONCE: Record<string, Set<EventHandler>> = {}
const ON: Record<string, Set<EventHandler>> = {}
export const wowEvents: {
  on: Record<WowEventType, (fn: EventHandler) => Set<EventHandler>>
  once: Record<WowEventType, () => Promise<WebEvent>>
} = { on: {}, once: {} } as {
  on: Record<WowEventType, (fn: EventHandler) => Set<EventHandler>>
  once: Record<WowEventType, () => Promise<WebEvent>>
}

for (const type of eventTypes) {
  const on = (ON[type] = new Set())
  const once = (ONCE[type] = new Set())
  const next = (fn: EventHandler) => once.add(fn)
  wowEvents.on[type] = (fn) => on.add(fn)
  wowEvents.once[type] = () => new Promise(next)
}

// await sql`DROP TABLE acore_auth.web_events;`
await sql`
CREATE TABLE IF NOT EXISTS acore_auth.web_events (
  id    INT  PRIMARY KEY AUTO_INCREMENT,
  type  TEXT NOT NULL,
  world INT  NOT NULL,
  at    TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
  data  JSON DEFAULT NULL,
  start TIMESTAMP(3) DEFAULT NULL,
  end   TIMESTAMP(3) DEFAULT NULL
);
`

await sql`
CREATE TABLE IF NOT EXISTS acore_auth.web_events_archive
LIKE acore_auth.web_events;
`

try {
  await sql`ALTER TABLE acore_auth.web_events ADD INDEX web_events_archive_idx (end, at);`
} catch (err) {
  if (!(err instanceof Error) || !/Duplicate key name|already exists/i.test(err.message)) throw err
}

try {
  await sql`
  CREATE EVENT IF NOT EXISTS acore_auth.archive_web_events
  ON SCHEDULE EVERY 1 HOUR
  DO
  BEGIN
    INSERT IGNORE INTO acore_auth.web_events_archive
    SELECT *
    FROM acore_auth.web_events
    WHERE at < NOW(3) - INTERVAL 7 DAY
      AND end IS NOT NULL;

    DELETE FROM acore_auth.web_events
    WHERE at < NOW(3) - INTERVAL 7 DAY
      AND end IS NOT NULL;
  END;
  `
} catch (err) {
  console.warn(
    'Unable to create acore_auth.archive_web_events. Enable event_scheduler and grant EVENT privilege if automatic archiving is needed.',
  )
  console.warn(err)
}

// Those events are not preserved in the database
const purgedEvents = new Set<string>([
  'GENERAL_CHANNEL_MESSAGE',
  'PLAYER_LOCATION',
  'BATTLEGROUND_QUEUE',
  'BATTLEGROUND_END',
  'ARENA_QUEUE',
  'ARENA_END',
])

let polling = false

const handleSingleEvent = async (event: WebEvent) => {
  try {
    event.start = Date.now()
    event.data = typeof event.data === 'string' && event.data ? JSON.parse(event.data) : {}
    event.at = event.at instanceof Date ? event.at.getTime() : event.at
    const on = ON[event.type]
    if (on) {
      for (const fn of on) await fn(event)
    }
    const once = ONCE[event.type]
    if (once) {
      for (const fn of once) await fn(event)
      once.clear()
    }
  } catch (err) {
    console.log('Unable to handle event')
    console.log(event)
    console.log(err)
  }
}

async function handleNewEvents() {
  if (polling) return
  polling = true

  try {
    const events = await sql`
      SELECT * FROM acore_auth.web_events WHERE start IS NULL AND world=${worldId} ORDER BY id
    `

    for (const event of events as WebEvent[]) {
      try {
        await sql`UPDATE acore_auth.web_events SET start=NOW(3) WHERE id=${event.id} AND start IS NULL`
        await handleSingleEvent(event)
        if (purgedEvents.has(event.type)) {
          await sql`DELETE FROM acore_auth.web_events WHERE id=${event.id}`
          event.purged = true
        } else {
          await sql`UPDATE acore_auth.web_events SET end=NOW(3) WHERE id=${event.id}`
        }
        event.elapsed = (Date.now() - Number(event.start)) / 1000
        console.log('acore_auth.web_events:', event)
      } catch (err) {
        console.error(err)
      }
    }
  } finally {
    polling = false
    setTimeout(handleNewEvents, 500)
  }
}

let initialStateStart: Date | number | undefined

export async function handleInitialStateEvents() {
  if (initialStateStart) return initialStateStart

  const [startup] = await sql`
    SELECT * FROM acore_auth.web_events
    WHERE type = ${'STARTUP'} AND world=${worldId}
    ORDER BY at DESC LIMIT 1
  ` as WebEvent[]
  const start = startup?.at || new Date()
  initialStateStart = start
  const events = await sql`
    SELECT * FROM acore_auth.web_events WHERE world=${worldId} AND at > ${start} ORDER BY id
  `

  startup && (await handleSingleEvent(startup))
  for (const event of events as WebEvent[]) {
    await handleSingleEvent(event)
  }
  handleNewEvents()
  return start
}
