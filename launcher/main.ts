import WebTorrent from 'webtorrent'
import pageBytes from './page.html' with { type: 'bytes' }
import torrent from './World of Warcraft 3.3.5a.torrent' with { type: 'bytes' }

const DOWNLOAD_DIRECTORY = `${
  Deno.env.get('TEMP') ?? Deno.env.get('TMPDIR') ?? '/tmp'
}/19pvp-launcher`
const TRACKER_URL = 'http://tracker.opentrackr.org:1337/announce'
const WEBSEED_URL = 'https://dl.devazuka.com/wow/'
const TRACKER_RETRY_MS = 30_000
const RECOVERY_RESTART_MS = 2_000
const WEBTORRENT_OPTIONS = {
  natPmp: false,
  natUpnp: false,
  tracker: { intervalMs: TRACKER_RETRY_MS },
  utp: false,
}
const LOG_LIMIT = 500
const STATUS_INTERVAL_MS = 1000
const encoder = new TextEncoder()
const page = new TextDecoder().decode(pageBytes)
const startupTime = performance.now()

type LogEntry = { timestamp: string; message: string }

type Torrent = {
  on(event: string, listener: (...args: unknown[]) => void): void
  done: boolean
  downloaded: number
  downloadSpeed: number
  files: { path: string }[]
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
    options: { path: string; announce: string[]; urlList: string[] },
  ): Torrent
  destroy(callback: () => void): void
}

const logs: LogEntry[] = []
let events: ReadableStreamDefaultController<Uint8Array> | null = null
let client: Client | null = null
let activeTorrent: Torrent | null = null
let downloadPath: string | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null
let recovering = false
let started = false
let stopped = false

function log(message: string): void {
  const entry = { timestamp: new Date().toISOString(), message }
  console.log(`[${entry.timestamp}] ${entry.message}`)
  logs.push(entry)
  if (logs.length > LOG_LIMIT) logs.shift()
  try {
    events?.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
  } catch {
    events = null
  }
}

function logStep(message: string): void {
  log(`startup +${Math.round(performance.now() - startupTime)}ms: ${message}`)
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

function exists(path: string): Promise<boolean> {
  return Deno.stat(path).then(() => true, (error) => {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  })
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

function startTorrent(): void {
  if (!downloadPath) throw new Error('missing download path')
  if (statusTimer !== null) clearInterval(statusTimer)

  logStep('creating WebTorrent client')
  client = new WebTorrent(WEBTORRENT_OPTIONS) as unknown as Client
  logStep('WebTorrent client created')
  client.on('error', (error) => {
    log(`client error: ${errorMessage(error)}`)
    recover(error)
  })
  log('loading embedded torrent')
  logStep('adding torrent to client')
  activeTorrent = client.add(torrent, {
    path: downloadPath,
    announce: [TRACKER_URL],
    urlList: [WEBSEED_URL],
  })
  logStep('torrent add returned')
  activeTorrent.on(
    'infoHash',
    (infoHash) => log(`torrent info hash: ${infoHash}`),
  )
  activeTorrent.on(
    'metadata',
    () => {
      log(
        `metadata received: ${activeTorrent!.name} (${
          formatBytes(activeTorrent!.length)
        })`,
      )
      const clientRoot = `${downloadPath}/${activeTorrent!.name}`
      log(`client files root: ${clientRoot}`)
      exists(clientRoot).then((found) =>
        log(`client files root existed at startup: ${found ? 'yes' : 'no'}`)
      )
      log(`first torrent file: ${activeTorrent!.files[0]?.path ?? 'none'}`)
      logStep('checking existing data')
    },
  )
  activeTorrent.on('ready', () => {
    logStep('existing data check finished')
    log('torrent ready; existing data checked')
  })
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
  activeTorrent.on('error', (error) => {
    log(`torrent error: ${errorMessage(error)}`)
    recover(error)
  })
  logStep('torrent listeners attached')
  statusTimer = setInterval(logStatus, STATUS_INTERVAL_MS)
  logStep('status timer started')
  log('torrent loaded')
}

function recover(error: unknown): void {
  if (stopped || recovering) return
  recovering = true
  log(`recovering torrent: ${errorMessage(error)}`)
  if (statusTimer !== null) clearInterval(statusTimer)
  statusTimer = null
  activeTorrent = null

  const currentClient = client
  client = null
  let restarted = false
  const restart = () => {
    if (stopped || restarted) return
    restarted = true
    recovering = false
    startTorrent()
  }
  setTimeout(restart, RECOVERY_RESTART_MS)
  currentClient?.destroy(restart)
}

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
  logStep('launcher started')
  downloadPath = DOWNLOAD_DIRECTORY
  log(
    `download directory existed before startup: ${
      await exists(downloadPath) ? 'yes' : 'no'
    }`,
  )
  logStep('creating download directory')
  await Deno.mkdir(downloadPath, { recursive: true })
  log(`download directory: ${downloadPath}`)
  logStep('download directory ready')

  logStep('installing recovery handlers')
  globalThis.addEventListener('error', (event) => {
    log(`uncaught error: ${event.message}`)
    event.preventDefault()
    recover(event.error ?? event.message)
  })
  globalThis.addEventListener('unhandledrejection', (event) => {
    log(`unhandled rejection: ${errorMessage(event.reason)}`)
    event.preventDefault()
    recover(event.reason)
  })
  logStep('recovery handlers installed')
  startTorrent()

  const abort = new AbortController()
  logStep('starting local HTTP server')
  const server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    signal: abort.signal,
  }, handler)
  const url = `http://127.0.0.1:${server.addr.port}`
  logStep(`local HTTP server listening: ${url}`)
  const open = Deno.build.os === 'windows'
    ? new Deno.Command('cmd', { args: ['/c', 'start', '', url] })
    : new Deno.Command(Deno.build.os === 'darwin' ? 'open' : 'xdg-open', {
      args: [url],
    })
  logStep('opening browser')
  open.spawn()
  log(`opening ${url}`)
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
