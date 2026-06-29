import { TextLineStream } from '@std/streams'
import { cors, json, runCommand, sse } from './utils.ts'

const serviceJournalQuery = `_PID=${Deno.pid}`
const worldserverServiceName = Deno.env.get('WORLDSERVER_SERVICE_NAME') || '19pvp-worldserver'
const worldserverJournalPath = `journalctl -u ${worldserverServiceName}`

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

const journalArgs = (
  sourceArgs: string[],
  options: { lines?: number | 'all'; follow?: boolean; grep?: string } = {},
) => [
  '--no-pager',
  '--output=cat',
  ...(options.follow ? ['-f'] : []),
  ...(options.lines === undefined ? [] : ['-n', String(options.lines)]),
  ...(options.grep ? ['--grep', options.grep] : []),
  ...sourceArgs,
]

const readJournal = async (args: string[], lines: number | 'all' = 1000) => {
  try {
    const stdout = await runCommand('journalctl', journalArgs(args, { lines }))
    return stdout ? stdout.split(/\r?\n/) : []
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

const streamJournal = (
  args: string[],
  follow: boolean,
  onLine: (line: string) => void,
  isClosed: () => boolean,
) => {
  const process = new Deno.Command('journalctl', {
    args: journalArgs(args, follow ? { follow: true, lines: 1000 } : { lines: 'all' }),
    stdout: 'piped',
    stderr: 'null',
  }).spawn()

  const done = (async () => {
    const lines = process.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())

    for await (const line of lines) {
      if (isClosed()) break
      onLine(line)
    }
  })()

  return { process, done }
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
        journalArgs(source.args, { lines: 500, grep: query }),
        { okCodes: [0, 1] },
      )
      if (stdout) lines.push(...stdout.split(/\r?\n/))
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

        journalSources(log, run)
          .then((sources) => {
            for (const source of sources) {
              const stream = streamJournal(
                source.args,
                follow,
                (line) => send({ type: 'log', file: source.file, path: source.path, line }),
                () => closed,
              )
              processes.push(stream.process)
              stream.done.catch((err) => {
                if (!closed && !(err instanceof Deno.errors.NotFound)) {
                  send({ type: 'watcher', error: String(err), source: 'journalctl' })
                }
              })
            }
          })
          .catch((err) => send({ type: 'watcher', error: String(err), source: 'journalctl' }))
      },
      cancel() {
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        for (const process of processes) process.kill('SIGTERM')
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
