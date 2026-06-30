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

const journalSources = (log: string | null) => [
  ...(!log || log === 'all' || log === 'server'
    ? [{ file: 'server', path: worldserverJournalPath, args: ['-u', worldserverServiceName] }]
    : []),
  ...(!log || log === 'all' || log === 'service'
    ? [{ file: 'service', path: serviceJournalQuery, args: [serviceJournalQuery] }]
    : []),
]

const journalArgs = (
  sourceArgs: string[],
  options: {
    lines?: number | 'all'
    follow?: boolean
    grep?: string
    priority?: string
    since?: string
    output?: 'json' | 'cat'
  } = {},
) => [
  '--no-pager',
  `--output=${options.output || 'json'}`,
  ...(options.follow ? ['-f'] : []),
  ...(options.lines === undefined ? [] : ['-n', String(options.lines)]),
  ...(options.grep ? ['--grep', options.grep] : []),
  ...(options.priority ? ['--priority', options.priority] : []),
  ...(options.since ? ['--since', options.since] : []),
  ...sourceArgs,
]

type JournalEntry = {
  line: string
  at: number | null
  priority: number | null
  transport: string
}

const parseJournalEntry = (line: string): JournalEntry | null => {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }

  const message = entry.MESSAGE
  if (typeof message !== 'string') return null
  const realtime = Number(entry.__REALTIME_TIMESTAMP || 0)
  const priority = Number(entry.PRIORITY)
  return {
    line: message,
    at: realtime ? Math.floor(realtime / 1000) : null,
    priority: Number.isFinite(priority) ? priority : null,
    transport: String(entry._TRANSPORT || ''),
  }
}

class JournalLines implements AsyncIterable<JournalEntry>, Disposable {
  #closed = false
  #process: Deno.ChildProcess
  #lines: ReadableStream<JournalEntry>

  constructor(
    sourceArgs: string[],
    options: {
      lines?: number | 'all'
      follow?: boolean
      grep?: string
      priority?: string
      since?: string
    } = {},
  ) {
    this.#process = new Deno.Command('journalctl', {
      args: journalArgs(sourceArgs, options),
      stdout: 'piped',
      stderr: 'null',
    }).spawn()
    this.#lines = this.#process.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeThrough(
        new TransformStream<string, JournalEntry>({
          transform(line, controller) {
            if (!line) return
            const entry = parseJournalEntry(line)
            if (entry) controller.enqueue(entry)
          },
        }),
      )
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#process.kill('SIGTERM')
    } catch {
      // Process already exited.
    }
  }

  [Symbol.dispose]() {
    this.close()
  }

  [Symbol.asyncIterator]() {
    return this.#lines[Symbol.asyncIterator]()
  }
}

const journalctl = (
  sourceArgs: string[],
  options: {
    lines?: number | 'all'
    follow?: boolean
    grep?: string
    priority?: string
    since?: string
  } = {},
) => new JournalLines(sourceArgs, options)

const defaultLogLines = 10_000
const lineOptions = new Set(['100', '500', '1000', '5000', '10000', 'all'])
const priorities = new Set(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'])
const ranges = new Map([
  ['today', 'today'],
  ['week', 'this week'],
  ['month', 'this month'],
])
const isWorldserverPrompt = (entry: JournalEntry) => entry.line.trim() === 'AC>'

const logOptions = (url: URL) => {
  const linesParam = url.searchParams.get('lines') || String(defaultLogLines)
  const priority = url.searchParams.get('priority') || ''
  const range = url.searchParams.get('range') || ''
  return {
    lines: lineOptions.has(linesParam) ? linesParam === 'all' ? 'all' as const : Number(linesParam) : defaultLogLines,
    priority: priorities.has(priority) ? priority : undefined,
    since: ranges.get(range),
  }
}

const streamJournalSource = async (
  source: { args: string[]; file: string; path: string },
  options: {
    follow: boolean
    lines: number | 'all'
    priority?: string
    since?: string
    isClosed: () => boolean
    resources: Set<JournalLines>
    send: (event: unknown) => void
  },
) => {
  let lastEntry: JournalEntry | null = null
  let repeatCount = 0
  const flushRepeat = () => {
    if (repeatCount > 0 && lastEntry) {
      options.send({
        type: 'log',
        file: source.file,
        path: source.path,
        ...lastEntry,
        line: `... repeated ${repeatCount} times: ${lastEntry.line}`,
      })
      repeatCount = 0
    }
  }

  try {
    using lines = journalctl(source.args, {
      follow: options.follow,
      lines: options.lines,
      priority: options.priority,
      since: options.since,
    })
    options.resources.add(lines)

    try {
      for await (const entry of lines) {
        if (options.isClosed()) break
        if (isWorldserverPrompt(entry)) continue
        if (entry.line === lastEntry?.line) {
          repeatCount++
          continue
        }
        flushRepeat()
        lastEntry = entry
        options.send({ type: 'log', file: source.file, path: source.path, ...entry })
      }
      flushRepeat()
    } finally {
      options.resources.delete(lines)
    }
  } catch (err) {
    if (!options.isClosed() && !(err instanceof Deno.errors.NotFound)) {
      options.send({ type: 'watcher', error: String(err), source: 'journalctl' })
    }
  }
}

export const logInfo = () =>
  json({ path: worldserverJournalPath, files: { server: worldserverJournalPath, service: serviceJournalQuery } })

export const logFile = async (req: Request) => {
  const url = new URL(req.url)
  const log = url.searchParams.get('log') || 'server'
  const sources = journalSources(log)
  const options = { ...logOptions(url), lines: 'all' as const }
  const text = (await Promise.all(
    sources.map((source) =>
      runCommand('journalctl', journalArgs(source.args, { ...options, output: 'cat' }), {
        okCodes: [0, 1],
      })
    ),
  )).filter(Boolean).join('\n')
  return new Response(text, {
    headers: {
      ...cors,
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${log || 'server'}.log"`,
    },
  })
}

export const logSearch = async (req: Request) => {
  const url = new URL(req.url)
  const query = url.searchParams.get('q') || ''
  if (!query) return json([])
  const log = url.searchParams.get('log')
  const options = logOptions(url)
  const sources = journalSources(log)
  if (!sources.length) return json([])

  try {
    const lines: string[] = []

    for (const source of sources) {
      using output = journalctl(source.args, { ...options, grep: query })
      for await (const entry of output) {
        if (!isWorldserverPrompt(entry)) lines.push(entry.line)
      }
    }

    return json(lines)
  } catch (err) {
    return json([`Search failed: ${String(err)}`], { status: 500 })
  }
}

export const logEvents = (req: Request) => {
  const url = new URL(req.url)
  const log = url.searchParams.get('log')
  const options = logOptions(url)
  const follow = true
  const initialLines = follow && req.headers.get('last-event-id') ? 0 : follow ? options.lines : 'all'
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const resources = new Set<JournalLines>()
  let closed = false
  let eventId = Date.now()

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (closed) return

          try {
            controller.enqueue(sse(event, ++eventId))
          } catch {
            closed = true
          }
        }

        if (follow) heartbeat = setInterval(() => send({ type: 'heartbeat', at: Date.now() }), 15000)

        try {
          for (const source of journalSources(log)) {
            void streamJournalSource(source, {
              follow,
              lines: initialLines,
              priority: options.priority,
              since: options.since,
              isClosed: () => closed,
              resources,
              send,
            })
          }
        } catch (err) {
          send({ type: 'watcher', error: String(err), source: 'journalctl' })
        }
      },
      cancel() {
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        for (const resource of resources) resource[Symbol.dispose]()
        resources.clear()
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
