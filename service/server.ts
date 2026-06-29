import worldserverConfig from '../config/worldserver.json' with { type: 'json' }
import controlConfig from '../config/worldserver-control.json' with { type: 'json' }
import { cors, json, normalizePath, parentDir, projectPath, sse, unquote } from './utils.ts'

type EventController = ReadableStreamDefaultController<Uint8Array>
const eventClients = new Set<EventController>()
const eventHistory: unknown[] = []
const serviceJournalQuery = `_PID=${Deno.pid}`
let serviceJournalProcess: Deno.ChildProcess | undefined

const emitEvent = (event: unknown) => {
  eventHistory.push(event)
  eventHistory.splice(0, Math.max(0, eventHistory.length - 100))

  for (const client of [...eventClients]) {
    try {
      client.enqueue(sse(event))
    } catch {
      eventClients.delete(client)
    }
  }
}

const controlPidFile = () => projectPath(controlConfig.pidFile)
const controlCommand = () => projectPath(controlConfig.command)

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
  service: serviceJournalQuery,
})

const worldserverLogFile = () => logFiles().server

emitEvent({ type: 'api', action: 'started', at: Date.now(), message: 'API server started' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  try {
    Deno.addSignalListener(signal, () => {
      emitEvent({ type: 'api', action: 'stopping', signal, at: Date.now(), message: `API server stopping (${signal})` })
    })
  } catch {
    // Some local platforms do not expose every Unix signal Deno supports on Linux.
  }
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

const readJournalTail = async (query = serviceJournalQuery, lines = 300) => {
  try {
    const journal = new Deno.Command('journalctl', {
      args: ['--no-pager', '--output=cat', '-n', String(lines), query],
      stdout: 'piped',
      stderr: 'null',
    })
    const { stdout } = await journal.output()
    return new TextDecoder().decode(stdout).split(/\r?\n/).filter(Boolean)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

const forwardProcessOutput = async (
  process: Deno.ChildProcess,
  file: string,
  path: string,
  stream: 'stdout' | 'stderr',
) => {
  try {
    const reader = stream === 'stdout' ? process.stdout.getReader() : process.stderr.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (!closed) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trimEnd()
        buffer = buffer.slice(newline + 1)
        if (line) sendEventLine(file, path, line, stream)
        newline = buffer.indexOf('\n')
      }
    }

    const tail = buffer.trim()
    if (tail) sendEventLine(file, path, tail, stream)
  } catch (err) {
    if (!closed) {
      emitEvent({ type: 'log', file, path, stream, error: String(err) })
    }
  }
}

const sendEventLine = (file: string, path: string, line: string, stream?: 'stdout' | 'stderr') => {
  emitEvent({ type: 'log', file, path, line, ...(stream ? { stream } : {}) })
}

export const logInfo = () => json({ path: worldserverLogFile(), files: logFiles() })

const selectedLogFiles = (log: string | null) => {
  const files = logFiles()
  if (!log || log === 'all') return Object.entries(files).filter(([name]) => name !== 'service')
  if (log in files && log !== 'service') return [[log, files[log as keyof typeof files]]]
  return []
}

export const logTail = async (req: Request) => {
  const log = new URL(req.url).searchParams.get('log')
  const lines = []

  if (!log || log === 'all' || log === 'service') {
    for (const line of await readJournalTail()) {
      lines.push({ type: 'log', file: 'service', path: serviceJournalQuery, line })
    }
  }

  const files = selectedLogFiles(log)
  for (const [file, path] of files) {
    for (const line of await readTail(path)) lines.push({ type: 'log', file, path, line })
  }

  return json(lines)
}

export const logSearch = async (req: Request) => {
  const query = new URL(req.url).searchParams.get('q') || ''
  if (!query) return json([])
  const log = new URL(req.url).searchParams.get('log')
  const fileQueries = selectedLogFiles(log).map(([, path]) => path)
  const journalQueries = !log || log === 'all' || log === 'service' ? [serviceJournalQuery] : []
  if (!fileQueries.length && !journalQueries.length) return json([])

  try {
    const lines: string[] = []

    if (fileQueries.length) {
      const rg = new Deno.Command('rg', {
        args: ['--line-number', '--color', 'never', '--max-count', '500', query, ...fileQueries],
        stdout: 'piped',
        stderr: 'null',
      })
      const { stdout } = await rg.output()
      lines.push(...new TextDecoder().decode(stdout).split(/\r?\n/).filter(Boolean))
    }

    if (journalQueries.length) {
      const journal = new Deno.Command('journalctl', {
        args: ['--no-pager', '--output=cat', '--lines', '500', '--grep', query, ...journalQueries],
        stdout: 'piped',
        stderr: 'null',
      })
      const { stdout } = await journal.output()
      lines.push(...new TextDecoder().decode(stdout).split(/\r?\n/).filter(Boolean))
    }

    return json(lines)
  } catch (err) {
    return json([`Search failed: ${String(err)}`], { status: 500 })
  }
}

export const logEvents = () => {
  let watcher: Deno.FsWatcher | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let poller: ReturnType<typeof setInterval> | undefined
  let streamController: EventController | undefined
  let closed = false

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        streamController = controller
        eventClients.add(controller)

        const send = (event: unknown) => {
          if (closed) return

          try {
            controller.enqueue(sse(event))
          } catch {
            closed = true
            eventClients.delete(controller)
          }
        }

        for (const event of eventHistory) send(event)

        const files = logFiles()
        const fileEntries = Object.entries(files).filter(([name]) => name !== 'service')
        const positions = new Map<string, number>()
        const logDirs = [...new Set(fileEntries.map(([, path]) => parentDir(path)))]
        const logPaths = new Set(fileEntries.map(([, path]) => normalizePath(path)))

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
                send({ type: 'log', file: name, path, line })
              }
            }
          } catch (err) {
            if (!(err instanceof Deno.errors.NotFound)) {
              send({ type: 'log', file: name, path, error: String(err) })
            }
          }
        }

        for (const path of Object.values(files)) {
          try {
            positions.set(path, (await Deno.stat(path)).size)
          } catch {
            positions.set(path, 0)
          }
        }

        let updating = false
        const sendAllUpdates = async () => {
          if (updating) return
          updating = true

          try {
            for (const [name, path] of fileEntries) await sendUpdates(name, path)
          } finally {
            updating = false
          }
        }

        heartbeat = setInterval(() => send({ type: 'heartbeat', at: Date.now() }), 15000)
        poller = setInterval(() => sendAllUpdates(), 1000)

        try {
          watcher = Deno.watchFs(logDirs)
          ;(async () => {
            try {
              for await (const event of watcher) {
                if (event.paths.some((path) => logPaths.has(normalizePath(path)))) await sendAllUpdates()
              }
            } catch (err) {
              if (!(err instanceof Deno.errors.BadResource)) {
                send({ type: 'watcher', error: String(err) })
              }
            }
          })()
        } catch (err) {
          send({ type: 'watcher', error: String(err), fallback: 'poll' })
        }

        ;(async () => {
          try {
            serviceJournalProcess = new Deno.Command('journalctl', {
              args: ['--no-pager', '--output=cat', '-f', '-n', '0', serviceJournalQuery],
              stdout: 'piped',
              stderr: 'null',
            }).spawn()

            const reader = serviceJournalProcess.stdout.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (!closed) {
              const { value, done } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              let newline = buffer.indexOf('\n')
              while (newline !== -1) {
                const line = buffer.slice(0, newline).trimEnd()
                buffer = buffer.slice(newline + 1)
                if (line) send({ type: 'log', file: 'service', path: serviceJournalQuery, line })
                newline = buffer.indexOf('\n')
              }
            }

            const tail = buffer.trim()
            if (tail) send({ type: 'log', file: 'service', path: serviceJournalQuery, line: tail })
          } catch (err) {
            if (!closed && !(err instanceof Deno.errors.NotFound)) {
              send({ type: 'watcher', error: String(err), source: 'journalctl' })
            }
          }
        })()
      },
      cancel() {
        closed = true
        if (streamController) eventClients.delete(streamController)
        if (heartbeat) clearInterval(heartbeat)
        if (poller) clearInterval(poller)
        watcher?.close()
        serviceJournalProcess?.kill('SIGTERM')
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

  const child = new Deno.Command(controlCommand(), {
    args: controlConfig.args,
    cwd: projectPath(controlConfig.cwd),
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()

  void forwardProcessOutput(child, 'server', worldserverLogFile(), 'stdout')
  void forwardProcessOutput(child, 'server', worldserverLogFile(), 'stderr')
  void (async () => {
    const status = await child.status.catch((err) => ({ success: false, code: -1, signal: null, error: err }))
    emitEvent({
      type: 'worldserver',
      action: 'exited',
      at: Date.now(),
      message: 'Worldserver process exited',
      pid: child.pid,
      status,
    })
  })()

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
  async fetch(req: Request) {
    try {
      const url = new URL(req.url)

      if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
      if (url.pathname === '/logs/info') return logInfo()
      if (url.pathname === '/logs/tail') return await logTail(req)
      if (url.pathname === '/logs/events') return logEvents()
      if (url.pathname === '/logs/search') return await logSearch(req)
      if (url.pathname === '/worldserver/status') return await worldserverStatus()
      if (url.pathname === '/worldserver/start' && req.method === 'POST') return await worldserverStart()
      if (url.pathname === '/worldserver/stop' && req.method === 'POST') return await worldserverStop()
      if (url.pathname === '/worldserver/kill' && req.method === 'POST') return await worldserverStop('SIGKILL')

      return json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      console.error(err)
      return json({ error: String(err) }, { status: 500 })
    }
  },
}
