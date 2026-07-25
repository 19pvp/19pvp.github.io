import WebTorrent from 'webtorrent'
import torrent from './World of Warcraft 3.3.5a.torrent' with { type: 'bytes' }

const DOWNLOAD_DIRECTORY_PREFIX = '19pvp-launcher-'
const TRACKER_URL = 'http://tracker.opentrackr.org:1337/announce'
const WEBTORRENT_OPTIONS = { natPmp: false, natUpnp: false, utp: false }
const LOG_LIMIT = 500
const STATUS_INTERVAL_MS = 1000
const encoder = new TextEncoder()

type LogEntry = { timestamp: string; message: string }

type Torrent = {
  on(event: string, listener: (...args: unknown[]) => void): void
  done: boolean
  downloaded: number
  downloadSpeed: number
  infoHash: string
  length: number
  name: string
  numPeers: number
  progress: number
}

type Client = {
  on(event: string, listener: (...args: unknown[]) => void): void
  add(
    torrent: Uint8Array,
    options: { path: string; announce: string[] },
  ): Torrent
  destroy(callback: () => void): void
}

const logs: LogEntry[] = []
let events: ReadableStreamDefaultController<Uint8Array> | null = null
let client: Client | null = null
let activeTorrent: Torrent | null = null
let downloadPath: string | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null
let started = false
let stopped = false

function log(message: string): void {
  const entry = { timestamp: new Date().toISOString(), message }
  logs.push(entry)
  if (logs.length > LOG_LIMIT) logs.shift()
  // TODO: a closed browser stream can make enqueue fail; handle reconnects later.
  events?.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  )
  return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logStatus(): void {
  if (!activeTorrent) return
  log(
    `status: peers=${activeTorrent.numPeers} speed=${
      formatBytes(activeTorrent.downloadSpeed)
    }/s ` +
      `progress=${
        (Math.max(0, Math.min(1, activeTorrent.progress)) * 100).toFixed(1)
      }% ` +
      `downloaded=${formatBytes(activeTorrent.downloaded)}/${
        formatBytes(activeTorrent.length)
      }`,
  )
}

async function stop(): Promise<void> {
  if (stopped) return
  stopped = true
  if (statusTimer !== null) clearInterval(statusTimer)
  statusTimer = null
  if (activeTorrent) log('stopping torrent')
  activeTorrent = null

  const currentClient = client
  client = null
  if (currentClient) {
    await new Promise<void>((resolve) => currentClient.destroy(resolve))
  }
  log('launcher stopped')
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>19PvP Launcher</title>
  <style>
    :root { color-scheme: dark; font: 15px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    body { margin: 0; padding: 24px; background: #111827; color: #d1d5db; }
    main { max-width: 1000px; margin: auto; }
    h1 { color: #f9fafb; font: 600 20px/1.2 system-ui, sans-serif; }
    #logs { height: 70vh; margin: 0; overflow: auto; padding: 16px; border: 1px solid #374151; border-radius: 8px; background: #030712; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <h1>19PvP Launcher · Phase 1</h1>
    <pre id="logs" role="log" aria-live="polite">Connecting to launcher…</pre>
  </main>
  <script>
    const logView = document.querySelector('#logs')
    const append = (entry) => {
      if (logView.textContent === 'Connecting to launcher…') logView.textContent = ''
      logView.textContent += '[' + entry.timestamp + '] ' + entry.message + '\\n'
      logView.scrollTop = logView.scrollHeight
    }
    const stream = new EventSource('/events')
    stream.onmessage = (event) => append(JSON.parse(event.data))
    stream.onerror = () => append({ timestamp: new Date().toISOString(), message: 'event stream disconnected' })
  </script>
</body>
</html>`

export function handler(request: Request): Response {
  const path = new URL(request.url).pathname

  if (path === '/') {
    return new Response(page, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (path === '/api') {
    return Response.json({
      downloadPath,
      done: activeTorrent?.done ?? false,
      downloaded: activeTorrent?.downloaded ?? 0,
      downloadSpeed: activeTorrent?.downloadSpeed ?? 0,
      infoHash: activeTorrent?.infoHash ?? null,
      length: activeTorrent?.length ?? 0,
      numPeers: activeTorrent?.numPeers ?? 0,
      progress: activeTorrent?.progress ?? 0,
      started: started && !stopped,
    })
  }

  if (path === '/events') {
    // NOTE: this launcher has one browser client; a second stream replaces the first.
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller
        events = controller
        for (const entry of logs) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(entry)}\n\n`),
          )
        }
        controller.enqueue(encoder.encode(': connected\n\n'))
      },
      cancel() {
        if (events === streamController) events = null
      },
    })
    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
      },
    })
  }

  return new Response('Not found', { status: 404 })
}

if (import.meta.main) {
  started = true
  downloadPath = await Deno.makeTempDir({ prefix: DOWNLOAD_DIRECTORY_PREFIX })
  log(`download directory: ${downloadPath}`)

  client = new WebTorrent(WEBTORRENT_OPTIONS) as unknown as Client
  client.on('error', (error) => log(`client error: ${errorMessage(error)}`))
  log('loading embedded torrent')
  activeTorrent = client.add(torrent, {
    path: downloadPath,
    announce: [TRACKER_URL],
  })
  activeTorrent.on(
    'infoHash',
    (infoHash) => log(`torrent info hash: ${infoHash}`),
  )
  activeTorrent.on(
    'metadata',
    () =>
      log(
        `metadata received: ${activeTorrent!.name} (${
          formatBytes(activeTorrent!.length)
        })`,
      ),
  )
  activeTorrent.on('ready', () => log('torrent ready; existing data checked'))
  activeTorrent.on(
    'wire',
    () => log(`peer connected: ${activeTorrent!.numPeers} peer(s)`),
  )
  activeTorrent.on('done', () => {
    logStatus()
    log('completed')
  })
  activeTorrent.on(
    'warning',
    (warning) => log(`warning: ${errorMessage(warning)}`),
  )
  activeTorrent.on(
    'error',
    (error) => log(`torrent error: ${errorMessage(error)}`),
  )
  statusTimer = setInterval(logStatus, STATUS_INTERVAL_MS)
  log('torrent loaded')

  const abort = new AbortController()
  const server = Deno.serve({ signal: abort.signal }, handler)
  let stopping: Promise<void> | null = null
  const shutdown = () => {
    stopping ??= (async () => {
      abort.abort()
      await stop()
    })()
    return stopping
  }
  Deno.addSignalListener('SIGINT', shutdown)
  Deno.addSignalListener('SIGTERM', shutdown)
  await server.finished
  await shutdown()
}
