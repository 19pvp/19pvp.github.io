import worldserverConfig from '../config/worldserver.json' with { type: 'json' }
import controlConfig from '../config/worldserver-control.json' with { type: 'json' }

const encoder = new TextEncoder()
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')
const json = (data: unknown) => Response.json(data, { headers: cors })
const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
type EventController = ReadableStreamDefaultController<Uint8Array>
const eventClients = new Set<EventController>()
const eventHistory: unknown[] = []

const emitEvent = (event: unknown) => {
  eventHistory.push(event)
  eventHistory.splice(0, Math.max(0, eventHistory.length - 100))

  for (const client of eventClients) client.enqueue(sse(event))
}

const projectPath = (path: string) =>
  path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : `${import.meta.dirname}/../${path}`

const controlPidFile = () => projectPath(controlConfig.pidFile)

const defaultWorldserverLogFile = () => {
  const logsDir = unquote(worldserverConfig.LogsDir) || '.'
  const appender = String(worldserverConfig['Appender.Server'] || '2,5,0,Server.log,w')
  const file = appender.split(',')[3] || 'Server.log'
  return projectPath(`${logsDir.replace(/[\\/]$/, '')}/${file}`)
}

const logFiles = () => ({
  server: projectPath(controlConfig.files?.serverLog || defaultWorldserverLogFile()),
  error: projectPath(controlConfig.files?.errorLog || 'core/env/dist/bin/Error.log'),
  playerbots: projectPath(controlConfig.files?.playerbotsLog || 'core/env/dist/bin/Playerbots.log'),
})

const worldserverLogFile = () => logFiles().server

emitEvent({ type: 'api', action: 'started', at: Date.now(), message: 'API server started' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  Deno.addSignalListener(signal, () => {
    emitEvent({ type: 'api', action: 'stopping', signal, at: Date.now(), message: `API server stopping (${signal})` })
  })
}

const pidExists = (pid: number) => {
  if (!pid) return false

  try {
    Deno.kill(pid, 'SIGCONT')
    return true
  } catch {
    return false
  }
}

const readTail = async (path: string, bytes = 64 * 1024) => {
  try {
    using file = await Deno.open(path)
    const { size } = await file.stat()
    await file.seek(Math.max(0, size - bytes), Deno.SeekMode.Start)
    return (await new Response(file.readable).text()).split(/\r?\n/).filter(Boolean).slice(-300)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

export const logInfo = () => json({ path: worldserverLogFile(), files: logFiles() })

export const logSearch = async (req: Request) => {
  const query = new URL(req.url).searchParams.get('q') || ''
  if (!query) return json([])

  const rg = new Deno.Command('rg', {
    args: ['--line-number', '--color', 'never', '--max-count', '500', query, worldserverLogFile()],
    stdout: 'piped',
    stderr: 'null',
  })
  const { stdout } = await rg.output()

  return json(new TextDecoder().decode(stdout).split(/\r?\n/).filter(Boolean))
}

export const logEvents = () => {
  let watcher: Deno.FsWatcher | undefined
  let streamController: EventController | undefined

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        streamController = controller
        eventClients.add(controller)
        for (const event of eventHistory) controller.enqueue(sse(event))

        const files = logFiles()
        const positions = new Map<string, number>()

        const sendTail = async (name: string, path: string) => {
          for (const line of await readTail(path)) controller.enqueue(sse({ type: 'log', file: name, path, line }))

          try {
            positions.set(path, (await Deno.stat(path)).size)
          } catch {
            positions.set(path, 0)
          }
        }

        const sendUpdates = async (name: string, path: string) => {
          try {
            using file = await Deno.open(path)
            const { size } = await file.stat()
            let position = positions.get(path) || 0

            if (size < position) position = 0
            if (size === position) return

            await file.seek(position, Deno.SeekMode.Start)
            const buffer = new Uint8Array(size - position)
            const count = await file.read(buffer)
            positions.set(path, size)

            if (count) {
              const text = new TextDecoder().decode(buffer.slice(0, count))
              for (const line of text.split(/\r?\n/).filter(Boolean)) {
                controller.enqueue(sse({ type: 'log', file: name, path, line }))
              }
            }
          } catch (err) {
            if (!(err instanceof Deno.errors.NotFound)) {
              controller.enqueue(sse({ type: 'log', file: name, path, error: String(err) }))
            }
          }
        }

        for (const [name, path] of Object.entries(files)) await sendTail(name, path)

        watcher = Deno.watchFs(Object.values(files))
        ;(async () => {
          try {
            for await (const event of watcher) {
              const changed = new Set(event.paths)

              for (const [name, path] of Object.entries(files)) {
                if (changed.has(path)) await sendUpdates(name, path)
              }
            }
          } catch (err) {
            if (!(err instanceof Deno.errors.BadResource)) {
              controller.enqueue(sse({ type: 'watcher', error: String(err) }))
            }
          }
        })()
      },
      cancel() {
        if (streamController) eventClients.delete(streamController)
        watcher?.close()
      },
    }),
    {
      headers: {
        ...cors,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    },
  )
}

export const worldserverStatus = async () => {
  const pid = Number(await Deno.readTextFile(controlPidFile()).catch(() => 0))
  return json({ running: await pidExists(pid), pid: pid || null })
}

export const worldserverStart = async () => {
  const pid = Number(await Deno.readTextFile(controlPidFile()).catch(() => 0))
  if (await pidExists(pid)) {
    const result = { running: true, started: false, pid }
    emitEvent({
      type: 'worldserver',
      action: 'start_skipped',
      at: Date.now(),
      message: 'Worldserver already running',
      ...result,
    })
    return json(result)
  }

  emitEvent({ type: 'worldserver', action: 'starting', at: Date.now(), message: 'Worldserver starting' })

  const child = new Deno.Command(controlConfig.command, {
    args: controlConfig.args,
    cwd: projectPath(controlConfig.cwd),
    stdout: 'null',
    stderr: 'null',
  }).spawn()

  await Deno.writeTextFile(controlPidFile(), `${child.pid}\n`)
  const result = { running: true, started: true, pid: child.pid }
  emitEvent({ type: 'worldserver', action: 'started', at: Date.now(), message: 'Worldserver started', ...result })
  return json(result)
}

export const worldserverStop = async (signal: Deno.Signal = 'SIGTERM') => {
  const pid = Number(await Deno.readTextFile(controlPidFile()).catch(() => 0))
  if (!pid) {
    const result = { running: false, stopped: false, pid: null }
    emitEvent({
      type: 'worldserver',
      action: 'stop_skipped',
      at: Date.now(),
      message: 'Worldserver pid file missing',
      ...result,
    })
    return json(result)
  }

  emitEvent({
    type: 'worldserver',
    action: 'stopping',
    signal,
    pid,
    at: Date.now(),
    message: `Worldserver stopping (${signal})`,
  })

  try {
    Deno.kill(pid, signal)
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
  }

  if (signal === 'SIGKILL') await Deno.remove(controlPidFile()).catch(() => {})
  const result = { running: await pidExists(pid), stopped: true, pid, signal }
  emitEvent({
    type: 'worldserver',
    action: 'stopped',
    at: Date.now(),
    message: `Worldserver stop signal sent (${signal})`,
    ...result,
  })
  return json(result)
}

export default {
  fetch(req: Request) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (url.pathname === '/logs/info') return logInfo()
    if (url.pathname === '/logs/events') return logEvents()
    if (url.pathname === '/logs/search') return logSearch(req)
    if (url.pathname === '/worldserver/status') return worldserverStatus()
    if (url.pathname === '/worldserver/start' && req.method === 'POST') return worldserverStart()
    if (url.pathname === '/worldserver/stop' && req.method === 'POST') return worldserverStop()
    if (url.pathname === '/worldserver/kill' && req.method === 'POST') return worldserverStop('SIGKILL')

    return json({ error: 'Not found' })
  },
}
