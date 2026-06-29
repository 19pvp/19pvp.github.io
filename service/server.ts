import worldserverConfig from '../config/worldserver.json' with { type: 'json' }
import controlConfig from '../config/worldserver-control.json' with { type: 'json' }
import { cors, json, projectPath, runCommand, sse, unquote } from './utils.ts'

type EventController = ReadableStreamDefaultController<Uint8Array>
const eventClients = new Set<EventController>()
const serviceJournalQuery = `_PID=${Deno.pid}`
const worldserverServiceName = Deno.env.get('WORLDSERVER_SERVICE_NAME') || '19pvp-worldserver'
const worldserverJournalQuery = `-u ${worldserverServiceName}`
let journalProcesses: Deno.ChildProcess[] = []

const emitEvent = (event: unknown) => {
  for (const client of [...eventClients]) {
    try {
      client.enqueue(sse(event))
    } catch {
      eventClients.delete(client)
    }
  }
}

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
const systemctl = (...args: string[]) => runCommand('systemctl', args)
const systemctlStatus = async () => {
  const active = await systemctl('is-active', worldserverServiceName).catch(() => 'inactive')
  const pidText = await systemctl('show', worldserverServiceName, '--property=MainPID', '--value').catch(() => '0')
  const pid = Number(pidText) || null
  return { running: active === 'active', active, pid, service: worldserverServiceName }
}

emitEvent({ type: 'api', action: 'started', at: Date.now(), message: 'API server started' })

const isLogLine = (line: string) => {
  const text = line.trim()
  return text !== ''
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  try {
    Deno.addSignalListener(signal, () => {
      emitEvent({ type: 'api', action: 'stopping', signal, at: Date.now(), message: `API server stopping (${signal})` })
      for (const process of journalProcesses) process.kill('SIGTERM')
      Deno.exit(0)
    })
  } catch {
    // Some local platforms do not expose every Unix signal Deno supports on Linux.
  }
}

const readTail = async (path: string, bytes = 64 * 1024) => {
  try {
    using file = await Deno.open(path)
    const { size } = await file.stat()
    await file.seek(Math.max(0, size - bytes), Deno.SeekMode.Start)
    return (await new Response(file.readable).text()).split(/\r?\n/).filter(isLogLine).slice(-300)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

const readJournalTail = async (args: string[], lines = 300) => {
  try {
    const stdout = await runCommand('journalctl', ['--no-pager', '--output=cat', '-n', String(lines), ...args])
    return stdout.split(/\r?\n/).filter(isLogLine)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

export const logInfo = () => json({ path: worldserverLogFile(), files: logFiles() })

export const logFile = async (req: Request) => {
  const log = new URL(req.url).searchParams.get('log') || 'server'
  const files = logFiles()
  const path = log in files && log !== 'service' && log !== 'all' ? files[log as keyof typeof files] : files.server

  try {
    const file = await Deno.open(path)
    return new Response(file.readable, {
      headers: {
        ...cors,
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `inline; filename="${path.split(/[\\/]/).pop() || 'log.txt'}"`,
      },
    })
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return json({ error: 'Log file not found', path }, { status: 404 })
    throw err
  }
}

const selectedLogFiles = (log: string | null) => {
  const files = logFiles()
  if (!log || log === 'all') return Object.entries(files).filter(([name]) => name !== 'service' && name !== 'server')
  if (log in files && log !== 'service' && log !== 'server') return [[log, files[log as keyof typeof files]]]
  return []
}

export const logTail = async (req: Request) => {
  const log = new URL(req.url).searchParams.get('log')
  const lines = []

  if (!log || log === 'all' || log === 'server') {
    for (const line of await readJournalTail(['-u', worldserverServiceName])) {
      lines.push({ type: 'log', file: 'server', path: worldserverJournalQuery, line })
    }
  }

  if (!log || log === 'all' || log === 'service') {
    for (const line of await readJournalTail([serviceJournalQuery])) {
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
  const journalQueries = [
    ...(!log || log === 'all' || log === 'server' ? [['-u', worldserverServiceName]] : []),
    ...(!log || log === 'all' || log === 'service' ? [[serviceJournalQuery]] : []),
  ]
  if (!fileQueries.length && !journalQueries.length) return json([])

  try {
    const lines: string[] = []

    if (fileQueries.length) {
      const stdout = await runCommand(
        'rg',
        ['--line-number', '--color', 'never', '--max-count', '500', query, ...fileQueries],
        { okCodes: [0, 1] },
      )
      lines.push(...stdout.split(/\r?\n/).filter(isLogLine))
    }

    for (const journalQuery of journalQueries) {
      const stdout = await runCommand(
        'journalctl',
        ['--no-pager', '--output=cat', '--lines', '500', '--grep', query, ...journalQuery],
        { okCodes: [0, 1] },
      )
      lines.push(...stdout.split(/\r?\n/).filter(isLogLine))
    }

    return json(lines)
  } catch (err) {
    return json([`Search failed: ${String(err)}`], { status: 500 })
  }
}

export const logEvents = () => {
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let streamController: EventController | undefined
  const processes: Deno.ChildProcess[] = []
  let closed = false

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
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

        heartbeat = setInterval(() => send({ type: 'heartbeat', at: Date.now() }), 15000)
        const followJournal = (args: string[], file: string, path: string) => {
          ;(async () => {
            try {
              const process = new Deno.Command('journalctl', {
                args: ['--no-pager', '--output=cat', '-f', '-n', '0', ...args],
                stdout: 'piped',
                stderr: 'null',
              }).spawn()
              processes.push(process)
              journalProcesses.push(process)

              const reader = process.stdout.getReader()
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
                  if (isLogLine(line)) send({ type: 'log', file, path, line })
                  newline = buffer.indexOf('\n')
                }
              }

              const tail = buffer.trim()
              if (isLogLine(tail)) send({ type: 'log', file, path, line: tail })
            } catch (err) {
              if (!closed && !(err instanceof Deno.errors.NotFound)) {
                send({ type: 'watcher', error: String(err), source: 'journalctl' })
              }
            }
          })()
        }

        followJournal(['-u', worldserverServiceName], 'server', worldserverJournalQuery)
        followJournal([serviceJournalQuery], 'service', serviceJournalQuery)
      },
      cancel() {
        closed = true
        if (streamController) eventClients.delete(streamController)
        if (heartbeat) clearInterval(heartbeat)
        for (const process of processes) process.kill('SIGTERM')
        journalProcesses = journalProcesses.filter((process) => !processes.includes(process))
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
  return json(await systemctlStatus())
}

export const worldserverStart = async () => {
  const status = await systemctlStatus()
  if (status.running) {
    const result = { ...status, started: false }
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

  await systemctl('start', worldserverServiceName)
  const result = { ...await systemctlStatus(), started: true }
  emitEvent({ type: 'worldserver', action: 'started', at: Date.now(), message: 'Worldserver started', ...result })
  return json(result)
}

export const worldserverStop = async (signal: Deno.Signal = 'SIGTERM') => {
  const status = await systemctlStatus()
  if (!status.running) {
    const result = { ...status, stopped: false }
    emitEvent({
      type: 'worldserver',
      action: 'stop_skipped',
      at: Date.now(),
      message: 'Worldserver already stopped',
      ...result,
    })
    return json(result)
  }

  emitEvent({
    type: 'worldserver',
    action: 'stopping',
    signal,
    pid: status.pid,
    at: Date.now(),
    message: `Worldserver stopping (${signal})`,
  })

  if (signal === 'SIGKILL') {
    await systemctl('kill', '--signal=SIGKILL', worldserverServiceName)
  } else {
    await systemctl('stop', worldserverServiceName)
  }

  const result = { ...await systemctlStatus(), stopped: true, signal }
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
      if (url.pathname === '/logs/file') return await logFile(req)
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
