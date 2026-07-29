import { brotliCompressSync } from 'node:zlib'
import { copy } from '@std/fs/copy'
import { basename, dirname, join } from '@std/path'
import WebTorrent from 'webtorrent'
import pageBytes from './page.html' with { type: 'bytes' }
import torrent from './World of Warcraft 3.3.5a.torrent' with { type: 'bytes' }

const CLIENT_DIRECTORY_NAME = 'World of Warcraft 3.3.5a'
const OLD_DOWNLOAD_DIRECTORY = `${Deno.env.get('TEMP') ?? Deno.env.get('TMPDIR') ?? '/tmp'}/19pvp-launcher`
const DOWNLOAD_DIRECTORY = join(
  Deno.env.get(Deno.build.os === 'windows' ? 'USERPROFILE' : 'HOME') ?? Deno.cwd(),
  'Downloads',
  '19pvp-wow-client',
)
const TRACKER_URL = 'http://tracker.opentrackr.org:1337/announce'
const WEBSEED_URL = 'https://dl.devazuka.com/wow/'
const REALMLIST = Deno.env.get('LAUNCHER_REALMLIST') ?? 'logon.19pvp.com'
const LOG_UPLOAD_ORIGIN = Deno.env.get('LAUNCHER_LOG_ORIGIN') ?? ''
const SERVICE_ORIGIN = Deno.env.get('LAUNCHER_SERVICE_ORIGIN') ?? LOG_UPLOAD_ORIGIN
const LOG_UPLOAD_SECRET = Deno.env.get('LAUNCHER_LOG_SECRET') ?? ''
const LOG_UPLOAD_MAX_BYTES = 1024 * 1024
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
const SAVED_DOWNLOAD_PATH_KEY = 'downloadPath'
const SAVED_LAUNCHER_URL_KEY = 'launcherUrl'
const encoder = new TextEncoder()
const page = new TextDecoder().decode(pageBytes)
const startupTime = performance.now()

type LogEntry = { timestamp: string; message: string }

type Torrent = {
  on(event: string, listener: (...args: unknown[]) => void): void
  done: boolean
  downloaded: number
  downloadSpeed: number
  files: { path: string; name: string }[]
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
let torrentReady = false
let recovering = false
let started = false
let stopped = false
let changingPath = false
let shutdownLauncher: (() => void) | null = null

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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${secs}s`
  return `${secs}s`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCrossDeviceRename(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('Invalid cross-device link') || message.includes('EXDEV') || message.includes('os error 18')
}

async function stopPreviousLauncher(): Promise<void> {
  const url = localStorage.getItem(SAVED_LAUNCHER_URL_KEY)
  if (!url) return
  try {
    await fetch(`${url}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(500),
    })
    log(`previous launcher stopped: ${url}`)
  } catch {
    log(`no previous launcher running at: ${url}`)
  }
}

function exists(path: string): Promise<boolean> {
  return Deno.stat(path).then(() => true, (error) => {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  })
}

function clientPath(): string | null {
  return downloadPath ? join(downloadPath, CLIENT_DIRECTORY_NAME) : null
}

export function isRealmlistFile(file: { name: string }): boolean {
  return file.name.toLowerCase() === 'realmlist.wtf'
}

export function torrentDownloadPath(path: string): string {
  path = path.trim()
  while (basename(path) === CLIENT_DIRECTORY_NAME) path = dirname(path)
  return path
}

export function savedDownloadPath(path: string | null): string {
  const normalized = path ? torrentDownloadPath(path) : DOWNLOAD_DIRECTORY
  return normalized === OLD_DOWNLOAD_DIRECTORY ? DOWNLOAD_DIRECTORY : normalized
}

export const addonToc(version: string): string => `
## Interface: 30300
## Title: 19 PvP
## Notes: Companion Add On for 19PvP Server.
## Author: Clement
## Version: ${version}

PvP19.lua
`

async function recoverClientFiles(sourcePath: string | null, targetDownloadPath: string): Promise<void> {
  if (!sourcePath) return
  const source = join(torrentDownloadPath(sourcePath), CLIENT_DIRECTORY_NAME)
  const target = join(targetDownloadPath, CLIENT_DIRECTORY_NAME)
  if (source === target) return
  if (!await exists(source)) {
    log(`no client files to recover from: ${source}`)
    return
  }
  log(`recovering client files from: ${source}`)
  log(`recovering client files to: ${target}`)
  try {
    await Deno.rename(source, target)
    log('client files moved')
  } catch (error) {
    if (!isCrossDeviceRename(error)) throw error
    log('rename crossed devices; copying client files instead')
    await copy(source, target, { overwrite: true })
    await Deno.remove(source, { recursive: true })
    log('client files copied and old files removed')
  }
}

async function patchRealmlist(): Promise<void> {
  if (!activeTorrent || !downloadPath) return
  const files = activeTorrent.files.filter(isRealmlistFile)
  if (files.length === 0) {
    log('warning: no realmlist.wtf file found')
    return
  }
  for (const file of files) {
    const path = join(downloadPath, file.path)
    await Deno.writeTextFile(path, `set realmlist ${REALMLIST}\r\n`)
    log(`realmlist patched: ${path}`)
  }
}

async function installAddon(): Promise<void> {
  const root = clientPath()
  if (!root) return
  if (!SERVICE_ORIGIN) {
    log('warning: missing LAUNCHER_SERVICE_ORIGIN; addon not installed')
    return
  }
  const response = await fetch(`${SERVICE_ORIGIN}/launcher/addons/PvP19.lua`)
  if (!response.ok) throw new Error(`addon download failed: ${response.status}`)
  const version = response.headers.get('x-addon-version')
  if (!version) throw new Error('addon download missing x-addon-version header')
  const addonPath = join(root, 'Interface', 'AddOns', 'PvP19')
  await Deno.mkdir(addonPath, { recursive: true })
  await Deno.writeFile(join(addonPath, 'PvP19.lua'), new Uint8Array(await response.arrayBuffer()))
  await Deno.writeTextFile(join(addonPath, 'PvP19.toc'), addonToc(version))
  log(`addon installed: PvP19 ${version}`)
}

async function pickDownloadPath(): Promise<string | null> {
  const output = await (async () => {
    if (Deno.build.os === 'windows') {
      return await new Deno.Command('powershell', {
        args: [
          '-NoProfile',
          '-STA',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq "OK") { [Console]::Write($d.SelectedPath) }',
        ],
      }).output()
    }
    if (Deno.build.os === 'darwin') {
      return await new Deno.Command('osascript', {
        args: ['-e', 'POSIX path of (choose folder with prompt "Choose download folder")'],
      }).output()
    }
    try {
      return await new Deno.Command('zenity', {
        args: ['--file-selection', '--directory', '--title=Choose download folder'],
      }).output()
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      return await new Deno.Command('kdialog', {
        args: ['--getexistingdirectory'],
      }).output()
    }
  })()
  if (!output.success) return null
  return new TextDecoder().decode(output.stdout).trim() || null
}

async function shareLogs(): Promise<Response> {
  if (!LOG_UPLOAD_ORIGIN || !LOG_UPLOAD_SECRET) {
    return Response.json(
      { error: 'Missing LAUNCHER_LOG_ORIGIN or LAUNCHER_LOG_SECRET.' },
      { status: 500 },
    )
  }

  let tail = logs
  let compressed = Uint8Array.from(
    brotliCompressSync(encoder.encode(formatLogs(tail))),
  )
  while (compressed.byteLength > LOG_UPLOAD_MAX_BYTES && tail.length > 1) {
    tail = tail.slice(Math.max(1, Math.floor(tail.length / 4)))
    compressed = Uint8Array.from(
      brotliCompressSync(encoder.encode(formatLogs(tail))),
    )
  }
  if (compressed.byteLength > LOG_UPLOAD_MAX_BYTES) {
    return Response.json({ error: 'Logs are too large to upload.' }, {
      status: 413,
    })
  }

  const sha1 = new Uint8Array(await crypto.subtle.digest('SHA-1', compressed))
    .toHex()
  const response = await fetch(`${LOG_UPLOAD_ORIGIN}/launcher/logs/${sha1}`, {
    method: 'POST',
    headers: {
      'content-encoding': 'br',
      'content-type': 'text/plain; charset=utf-8',
      'x-launcher-log-secret': LOG_UPLOAD_SECRET,
    },
    body: compressed,
  })
  if (!response.ok) {
    return Response.json({ error: await response.text() }, {
      status: response.status,
    })
  }

  return Response.json({
    bytes: compressed.byteLength,
    entries: tail.length,
    url: `${LOG_UPLOAD_ORIGIN}/launcher/logs/${sha1}`,
  })
}

function formatLogs(entries: LogEntry[]): string {
  return entries.map((entry) => `[${entry.timestamp}] ${entry.message}`).join(
    '\n',
  ) + '\n'
}

function logStatus(): void {
  if (!activeTorrent) return
  const remaining = Math.max(0, activeTorrent.length - activeTorrent.downloaded)
  const progress = (Math.max(0, Math.min(1, activeTorrent.progress)) * 100).toFixed(1)
  const eta = torrentReady && activeTorrent.downloadSpeed > 0
    ? formatDuration(remaining / activeTorrent.downloadSpeed)
    : torrentReady
    ? 'unknown'
    : `checking local files ${progress}%`
  log(
    `status: peers=${activeTorrent.numPeers} speed=${formatBytes(activeTorrent.downloadSpeed)}/s ` +
      `progress=${progress}% ` +
      `downloaded=${formatBytes(activeTorrent.downloaded)}/${formatBytes(activeTorrent.length)} ` +
      `eta=${eta}`,
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

async function changeDownloadPath(path: string): Promise<boolean> {
  path = torrentDownloadPath(path)
  if (!path) throw new Error('missing download path')
  if (path.includes('\0') || path.includes('\n')) throw new Error('invalid download path')
  if (path === downloadPath) return false
  const previousDownloadPath = downloadPath
  if (changingPath) throw new Error('download path is already changing')
  changingPath = true
  try {
    log(`changing download directory to: ${path}`)
    if (statusTimer !== null) clearInterval(statusTimer)
    statusTimer = null
    activeTorrent = null

    const currentClient = client
    client = null
    if (currentClient) {
      log('stopping torrent for directory change')
      await new Promise<void>((resolve) => currentClient.destroy(resolve))
    }

    await Deno.mkdir(path, { recursive: true })
    await recoverClientFiles(previousDownloadPath, path)
    downloadPath = path
    localStorage.setItem(SAVED_DOWNLOAD_PATH_KEY, downloadPath)
    log(`download directory: ${downloadPath}`)
    if (started && !stopped) startTorrent()
    return true
  } finally {
    changingPath = false
  }
}

function startTorrent(): void {
  if (!downloadPath) throw new Error('missing download path')
  if (statusTimer !== null) clearInterval(statusTimer)
  torrentReady = false

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
        `metadata received: ${activeTorrent!.name} (${formatBytes(activeTorrent!.length)})`,
      )
      const clientRoot = join(downloadPath!, activeTorrent!.name)
      const nestedClientRoot = join(clientRoot, CLIENT_DIRECTORY_NAME)
      log(`client files root: ${clientRoot}`)
      exists(clientRoot).then((found) => log(`client files root existed at startup: ${found ? 'yes' : 'no'}`))
      exists(nestedClientRoot).then((found) => {
        if (found) log(`warning: nested client directory found: ${nestedClientRoot}`)
      })
      log(`first torrent file: ${activeTorrent!.files[0]?.path ?? 'none'}`)
      logStep('checking existing data')
    },
  )
  activeTorrent.on('ready', () => {
    torrentReady = true
    logStep('existing data check finished')
    log('torrent ready; existing data checked')
  })
  activeTorrent.on(
    'wire',
    () => log(`peer connected: ${activeTorrent!.numPeers} peer(s)`),
  )
  activeTorrent.on('done', () => {
    logStatus()
    Promise.all([patchRealmlist(), installAddon()]).then(
      () => log('completed'),
      (error) => {
        log(`setup after download failed: ${errorMessage(error)}`)
        log('completed')
      },
    )
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
  if (stopped || recovering || changingPath) return
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

export async function handler(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname

  if (path === '/') {
    return new Response(page, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (path === '/api') {
    return Response.json({
      downloadPath,
      clientPath: clientPath(),
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

  if (path === '/share-logs') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    return await shareLogs()
  }

  if (path === '/shutdown') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return new Response('Forbidden', { status: 403 })
    }
    log('shutdown requested')
    queueMicrotask(() => shutdownLauncher?.())
    return Response.json({ ok: true })
  }

  if (path === '/download-path') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const changed = await changeDownloadPath(await request.text())
      return Response.json({ changed, downloadPath, clientPath: clientPath() })
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 400 })
    }
  }

  if (path === '/pick-directory') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const selectedPath = await pickDownloadPath()
      if (!selectedPath) {
        return Response.json({ canceled: true, changed: false, downloadPath, clientPath: clientPath() })
      }
      const changed = await changeDownloadPath(selectedPath)
      return Response.json({ canceled: false, changed, downloadPath, clientPath: clientPath() })
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 500 })
    }
  }

  if (path === '/events') {
    // NOTE: this launcher has one browser client; a second stream replaces the first.
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
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
  await stopPreviousLauncher()
  const rawSavedDownloadPath = localStorage.getItem(SAVED_DOWNLOAD_PATH_KEY)
  downloadPath = savedDownloadPath(rawSavedDownloadPath)
  if (rawSavedDownloadPath && downloadPath !== rawSavedDownloadPath) {
    log(`saved download directory normalized: ${rawSavedDownloadPath} -> ${downloadPath}`)
  }
  localStorage.setItem(SAVED_DOWNLOAD_PATH_KEY, downloadPath)
  log(
    `download directory existed before startup: ${await exists(downloadPath) ? 'yes' : 'no'}`,
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
  let stopping: Promise<void> | null = null
  const shutdown = () => {
    stopping ??= (async () => {
      abort.abort()
      await stop()
    })()
    return stopping
  }
  shutdownLauncher = shutdown
  logStep('starting local HTTP server')
  const server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    signal: abort.signal,
  }, handler)
  const url = `http://127.0.0.1:${server.addr.port}`
  localStorage.setItem(SAVED_LAUNCHER_URL_KEY, url)
  logStep(`local HTTP server listening: ${url}`)
  const open = Deno.build.os === 'windows'
    ? new Deno.Command('cmd', { args: ['/c', 'start', '', url] })
    : new Deno.Command(Deno.build.os === 'darwin' ? 'open' : 'xdg-open', {
      args: [url],
    })
  logStep('opening browser')
  open.spawn()
  log(`opening ${url}`)
  Deno.addSignalListener('SIGINT', shutdown)
  Deno.addSignalListener('SIGTERM', shutdown)
  await server.finished
  await shutdown()
}
