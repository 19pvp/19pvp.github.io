import { cors, json, runCommand, sse } from './utils.ts'

const serviceJournalQuery = `_PID=${Deno.pid}`
const worldserverServiceName = Deno.env.get('WORLDSERVER_SERVICE_NAME') || '19pvp-worldserver'
const worldserverJournalPath = `journalctl -u ${worldserverServiceName}`
let journalProcesses: Deno.ChildProcess[] = []

const systemctl = (...args: string[]) => runCommand('systemctl', args)
const systemctlStatus = async () => {
  const active = await systemctl('is-active', worldserverServiceName).catch(() => 'inactive')
  const pidText = await systemctl('show', worldserverServiceName, '--property=MainPID', '--value').catch(() => '0')
  const pid = Number(pidText) || null
  return { running: active === 'active', active, pid, service: worldserverServiceName }
}

const worldserverJournalArgs = async (run: string | null = null) => {
  if (run && run !== 'current') return [`_SYSTEMD_INVOCATION_ID=${run}`]
  const invocationId = await systemctl('show', worldserverServiceName, '--property=InvocationID', '--value').catch(() =>
    ''
  )
  return invocationId ? [`_SYSTEMD_INVOCATION_ID=${invocationId}`] : ['-u', worldserverServiceName]
}

const journalSources = async (log: string | null, run: string | null = null) => [
  ...(!log || log === 'all' || log === 'server'
    ? [{ file: 'server', path: worldserverJournalPath, args: await worldserverJournalArgs(run) }]
    : []),
  ...(!log || log === 'all' || log === 'service'
    ? [{ file: 'service', path: serviceJournalQuery, args: [serviceJournalQuery] }]
    : []),
]

const isLogLine = (line: string) => {
  const text = line.trim()
  return text !== '' && !/^AC>\s*$/.test(text)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  try {
    Deno.addSignalListener(signal, () => {
      for (const process of journalProcesses) process.kill('SIGTERM')
      Deno.exit(0)
    })
  } catch {
    // Some local platforms do not expose every Unix signal Deno supports on Linux.
  }
}

const readJournal = async (args: string[], lines: number | 'all' = 1000) => {
  try {
    const stdout = await runCommand('journalctl', ['--no-pager', '--output=cat', '-n', String(lines), ...args])
    return stdout.split(/\r?\n/).filter(isLogLine)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

const journalEntries = async (log: string | null, lines: number | 'all' = 1000, run: string | null = null) => {
  const entries = []
  for (const source of await journalSources(log, run)) {
    for (const line of await readJournal(source.args, lines)) {
      entries.push({ type: 'log', file: source.file, path: source.path, line })
    }
  }
  return entries
}

export const logInfo = () =>
  json({ path: worldserverJournalPath, files: { server: worldserverJournalPath, service: serviceJournalQuery } })

export const logRuns = async () => {
  const current =
    (await worldserverJournalArgs()).find((arg) => arg.startsWith('_SYSTEMD_INVOCATION_ID='))?.split('=')[1] ||
    ''
  const stdout = await runCommand('journalctl', [
    '--no-pager',
    '--output=json',
    '--reverse',
    '-n',
    '5000',
    '-u',
    worldserverServiceName,
  ], { okCodes: [0, 1] })
  const runs = new Map<string, { id: string; startedAt: number; lastAt: number; current: boolean; lines: number }>()

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line)
    const id = String(entry._SYSTEMD_INVOCATION_ID || '')
    const at = Math.floor(Number(entry.__REALTIME_TIMESTAMP || 0) / 1000)
    if (!id || !at) continue
    const run = runs.get(id) || { id, startedAt: at, lastAt: at, current: id === current, lines: 0 }
    run.startedAt = Math.min(run.startedAt, at)
    run.lastAt = Math.max(run.lastAt, at)
    run.lines++
    runs.set(id, run)
  }

  return json([...runs.values()])
}

export const logFile = async (req: Request) => {
  const url = new URL(req.url)
  const log = url.searchParams.get('log') || 'server'
  const run = url.searchParams.get('run')
  const text = (await journalEntries(log, 'all', run)).map((entry) => entry.line).join('\n') + '\n'
  const suffix = run && run !== 'current' ? `-${run.slice(0, 8)}` : ''
  return new Response(text, {
    headers: {
      ...cors,
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${log || 'server'}${suffix}.log"`,
    },
  })
}

export const logSearch = async (req: Request) => {
  const query = new URL(req.url).searchParams.get('q') || ''
  if (!query) return json([])
  const log = new URL(req.url).searchParams.get('log')
  const run = new URL(req.url).searchParams.get('run')
  const sources = await journalSources(log, run)
  if (!sources.length) return json([])

  try {
    const lines: string[] = []

    for (const source of sources) {
      const stdout = await runCommand(
        'journalctl',
        ['--no-pager', '--output=cat', '--lines', '500', '--grep', query, ...source.args],
        { okCodes: [0, 1] },
      )
      lines.push(...stdout.split(/\r?\n/).filter(isLogLine))
    }

    return json(lines)
  } catch (err) {
    return json([`Search failed: ${String(err)}`], { status: 500 })
  }
}

export const logEvents = (req: Request) => {
  const url = new URL(req.url)
  const log = url.searchParams.get('log')
  const run = url.searchParams.get('run')
  const follow = !run || run === 'current'
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const processes: Deno.ChildProcess[] = []
  let closed = false

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (closed) return

          try {
            controller.enqueue(sse(event))
          } catch {
            closed = true
          }
        }

        if (follow) heartbeat = setInterval(() => send({ type: 'heartbeat', at: Date.now() }), 15000)
        const followJournal = (args: string[], file: string, path: string) => {
          ;(async () => {
            try {
              const process = new Deno.Command('journalctl', {
                args: ['--no-pager', '--output=cat', ...(follow ? ['-f', '-n', '1000'] : ['-n', 'all']), ...args],
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

        journalSources(log, run)
          .then((sources) => {
            for (const source of sources) followJournal(source.args, source.file, source.path)
          })
          .catch((err) => send({ type: 'watcher', error: String(err), source: 'journalctl' }))
      },
      cancel() {
        closed = true
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
    return json(result)
  }

  await systemctl('start', worldserverServiceName)
  const result = { ...await systemctlStatus(), started: true }
  return json(result)
}

export const worldserverStop = async (signal: Deno.Signal = 'SIGTERM') => {
  const status = await systemctlStatus()
  if (!status.running) {
    const result = { ...status, stopped: false }
    return json(result)
  }

  if (signal === 'SIGKILL') {
    await systemctl('kill', '--signal=SIGKILL', worldserverServiceName)
  } else {
    await systemctl('stop', worldserverServiceName)
  }

  const result = { ...await systemctlStatus(), stopped: true, signal }
  return json(result)
}

export default {
  async fetch(req: Request) {
    try {
      const url = new URL(req.url)

      if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
      if (url.pathname === '/logs/info') return logInfo()
      if (url.pathname === '/logs/runs') return await logRuns()
      if (url.pathname === '/logs/file') return await logFile(req)
      if (url.pathname === '/logs/events') return logEvents(req)
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
