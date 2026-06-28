import { sql } from './db.js'

// tables
const worldId = Number(Deno.env.get('WORLD_ID')) || 1

const ONCE = {}
const ON = {}
export const wowEvents = { on: {}, once: {} }
for (const type of [
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
]) {
  const on = (ON[type] = new Set())
  const once = (ONCE[type] = new Set())
  const next = (fn) => once.add(fn)
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
  if (!/Duplicate key name|already exists/i.test(err.message)) throw err
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
  console.warn('Unable to create acore_auth.archive_web_events. Enable event_scheduler and grant EVENT privilege if automatic archiving is needed.')
  console.warn(err)
}

// Those events are not preserved in the database
const purgedEvents = new Set([
  'GENERAL_CHANNEL_MESSAGE',
  'PLAYER_LOCATION',
  'BATTLEGROUND_QUEUE',
  'BATTLEGROUND_END',
  'ARENA_QUEUE',
  'ARENA_END',
])

const handleSingleEvent = async event => {
  try {
    event.start = Date.now()
    event.data = event.data ? JSON.parse(event.data) : {}
    event.at = event.at.getTime()
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
  const events = await sql`
    SELECT * FROM acore_auth.web_events WHERE start IS NULL AND world=${worldId}
  `

  for (const event of events) {
    try {
      await sql`UPDATE acore_auth.web_events SET start=NOW(3) WHERE id=${event.id}`
      await handleSingleEvent(event)
      if (purgedEvents.has(event.type)) {
        await sql`DELETE FROM acore_auth.web_events WHERE id=${event.id}`
        event.purged = true
      } else {
        await sql`UPDATE acore_auth.web_events SET end=NOW(3) WHERE id=${event.id}`
      }
      event.elapsed = (Date.now() - event.start) / 1000
      console.log('acore_auth.web_events:', event)
    } catch (err) {
      console.error(err)
    }
  }
  setTimeout(handleNewEvents, 500)
}

export async function handleInitialStateEvents() {
  const [startup] = await sql`
    SELECT * FROM acore_auth.web_events
    WHERE type = "STARTUP" AND world=${worldId}
    ORDER BY at DESC LIMIT 1
  `
  const start = startup?.at || Math.floor(Date.now() / 1000)
  const events = await sql`
    SELECT * FROM acore_auth.web_events WHERE world=${worldId} AND at > ${start}
  `

  startup && (await handleSingleEvent(startup))
  for (const event of events) {
    await handleSingleEvent(event)
  }
  handleNewEvents()
  return start
}
