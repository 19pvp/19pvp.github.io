import { brotliCompressSync } from 'node:zlib'
import { join } from '@std/path'
import WebTorrent from 'webtorrent'
import pageBytes from './page.html' with { type: 'bytes' }
import parseTorrent from './vendor/parse-torrent/index.js'
import { parsePatchDefinition } from './patch.ts'
import torrentBytes from './World of Warcraft 3.3.5a.torrent' with { type: 'bytes' }

const CLIENT_DIRECTORY_NAME = 'World of Warcraft 3.3.5a'
const downloadPath = Deno.cwd()
const defaultClientPath = join(downloadPath, CLIENT_DIRECTORY_NAME)
const TRACKER_URL = 'http://tracker.opentrackr.org:1337/announce'
const SERVICE_ORIGIN = Deno.env.get('LAUNCHER_SERVICE_ORIGIN') ?? 'https://19pvp.devazuka.com'
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
const SAVED_LAUNCHER_URL_KEY = 'launcherUrl'
const encoder = new TextEncoder()
const page = new TextDecoder().decode(pageBytes)
const startupTime = performance.now()

type LogEntry = { timestamp: string; message: string }

type Torrent = {
  on(event: string, listener: (...args: unknown[]) => void): void
  pause(): void
  preferWebSeed(): void
  skipVerify: boolean
  skipPieces: number[]
  done: boolean
  downloaded: number
  downloadSpeed: number
  files: { path: string; name: string; length: number }[]
  infoHash: string
  length: number
  name: string
  numPeers: number
  progress: number
}

const torrentMetadata = await parseTorrent(torrentBytes)
const torrentFiles = torrentMetadata.files as Torrent['files']

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
let clientRoot = defaultClientPath
let statusTimer: ReturnType<typeof setInterval> | null = null
let torrentReady = false
let webSeedFinalizationStarted = false
let recovering = false
let started = false
let stopped = false
let torrentStopped = true
let quickCheckPassed = false
let shutdownLauncher: (() => void) | null = null
let webseedUrl = ''
let realmlist = ''
let verificationHash = ''

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
  const unit = Math.max(
    0,
    Math.min(
      Math.floor(Math.log(value) / Math.log(1024)),
      units.length - 1,
    ),
  )
  return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown'
  seconds = Math.ceil(seconds)
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

async function loadLauncherConfig(): Promise<void> {
  if (!SERVICE_ORIGIN) throw new Error('missing LAUNCHER_SERVICE_ORIGIN')
  const response = await fetch(`${SERVICE_ORIGIN}/launcher/config`)
  if (!response.ok) throw new Error(`launcher config download failed: ${response.status}`)
  const config = await response.json() as Record<string, unknown>
  if (
    typeof config.webseedUrl !== 'string' || !config.webseedUrl ||
    typeof config.realmlist !== 'string' || !config.realmlist ||
    typeof config['verification-hash'] !== 'string' || !config['verification-hash']
  ) {
    throw new Error('launcher config is invalid')
  }
  webseedUrl = config.webseedUrl
  realmlist = config.realmlist
  verificationHash = config['verification-hash']
}

async function stopPreviousLauncher(previousUrl = localStorage.getItem(SAVED_LAUNCHER_URL_KEY)): Promise<void> {
  const url = previousUrl
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

function clientPath(): string {
  return clientRoot
}

function clientFilePath(root: string, path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  if (parts[0]?.toLowerCase() === CLIENT_DIRECTORY_NAME.toLowerCase()) parts.shift()
  return join(root, ...parts)
}

function quickCheckFiles(root: string, files: Torrent['files']): boolean {
  const mpqFiles = files.filter((file) => file.name.toLowerCase().endsWith('.mpq'))
  let present = 0
  for (const file of mpqFiles) {
    const filePath = clientFilePath(root, file.path)
    try {
      const stat = Deno.statSync(filePath)
      if (!stat.isFile) {
        log(`quick file check rejected: ${filePath}; not a regular file`)
      } else if (stat.size === file.length) {
        present++
      } else {
        log(`quick file check rejected: ${filePath}; size=${stat.size}, expected=${file.length}`)
      }
    } catch {
      log(`quick file check rejected: ${filePath}; missing or inaccessible`)
    }
  }
  log(`quick file check: ${present}/${mpqFiles.length} MPQ files have the right size`)
  return present === mpqFiles.length
}

function findExistingClient(): string | null {
  log(`checking existing client: ${defaultClientPath}`)
  if (quickCheckFiles(defaultClientPath, torrentFiles)) return defaultClientPath

  log(`checking launcher directory as client: ${downloadPath}`)
  if (quickCheckFiles(downloadPath, torrentFiles)) return downloadPath

  for (const entry of Deno.readDirSync(downloadPath)) {
    if (!entry.isDirectory || entry.name === CLIENT_DIRECTORY_NAME) continue
    const candidate = join(downloadPath, entry.name)
    try {
      if (!Deno.statSync(join(candidate, 'Data')).isDirectory) continue
    } catch {
      continue
    }
    log(`checking existing client directory: ${candidate}`)
    if (quickCheckFiles(candidate, torrentFiles)) return candidate
  }
  return null
}

export function isRealmlistFile(file: { name: string }): boolean {
  return file.name.toLowerCase() === 'realmlist.wtf'
}

export const addonToc = (version: string): string => `
## Interface: 30300
## Title: 19 PvP
## Notes: Companion Add On for 19PvP Server.
## Author: Clement
## Version: ${version}

PvP19.lua
`

async function patchRealmlist(): Promise<void> {
  log('configuring realmlist')
  const files = (activeTorrent?.files ?? torrentFiles).filter(isRealmlistFile)
  if (files.length === 0) {
    const error = new Error('no realmlist.wtf file found')
    log(`realmlist configuration failed: ${error.message}`)
    throw error
  }
  try {
    for (const file of files) {
      const path = clientFilePath(clientPath(), file.path)
      await Deno.writeTextFile(path, `set realmlist ${realmlist}\r\n`)
      log(`realmlist patched: ${path}`)
    }
  } catch (error) {
    log(`realmlist configuration failed: ${errorMessage(error)}`)
    throw error
  }
  log('realmlist updated successfully')
}

async function installAddon(): Promise<void> {
  const root = clientPath()
  if (!SERVICE_ORIGIN) {
    const error = new Error('missing launcher service URL')
    log(`companion addon installation failed: ${error.message}`)
    throw error
  }
  log('installing companion addon')
  try {
    const response = await fetch(`${SERVICE_ORIGIN}/launcher/addons/PvP19.lua`)
    if (!response.ok) throw new Error(`addon download failed: ${response.status}`)
    const version = response.headers.get('x-addon-version')
    if (!version) throw new Error('addon download missing x-addon-version header')
    const addonPath = join(root, 'Interface', 'AddOns', 'PvP19')
    await Deno.mkdir(addonPath, { recursive: true })
    await Deno.writeFile(join(addonPath, 'PvP19.lua'), new Uint8Array(await response.arrayBuffer()))
    await Deno.writeTextFile(join(addonPath, 'PvP19.toc'), addonToc(version))
    log(`companion addon installed successfully: PvP19 ${version}`)
  } catch (error) {
    log(`companion addon installation failed: ${errorMessage(error)}`)
    throw error
  }
}

async function fetchPatchDefinition() {
  const response = await fetch(`${SERVICE_ORIGIN}/launcher/patch`)
  if (!response.ok) throw new Error(`patch definition download failed: ${response.status}`)
  return parsePatchDefinition(await response.json())
}

async function fetchPatchFiles(paths: readonly string[]) {
  return await Promise.all(paths.map(async (path) => {
    const response = await fetch(
      `${SERVICE_ORIGIN}/launcher/patch-file/${path.split('/').map(encodeURIComponent).join('/')}`,
    )
    if (!response.ok) throw new Error(`patch file download failed: ${path}: ${response.status}`)
    return { path, bytes: new Uint8Array(await response.arrayBuffer()) }
  }))
}

async function generateClientPatch(): Promise<string> {
  try {
    log('generating client patch')
    const root = clientPath()
    const { edits, files: filePaths } = await fetchPatchDefinition()
    const files = await fetchPatchFiles(filePaths)
    log(`patch definition downloaded: ${edits.length} DBC edit(s), ${files.length} file(s)`)
    if (edits.length === 0 && files.length === 0) throw new Error('patch definition contains no edits or files')
    const outputPath = join(root, 'Data', 'patch-S.mpq')
    log(`generating client patch from ${edits.length} DBC edit(s), ${files.length} file(s)`)
    log('starting patch worker')
    const worker = new Worker(new URL('./patch_worker.ts', import.meta.url), { type: 'module' })
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.type === 'log') {
          log(`patch: ${event.data.message}`)
          return
        }
        worker.terminate()
        if (event.data.ok) {
          resolve()
        } else {
          reject(new Error(event.data.error))
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        worker.terminate()
        reject(new Error(event.message))
      }
      worker.postMessage({ edits, files, outputPath, root })
    })
    log(`client patch generated: ${outputPath}`)
    return outputPath
  } catch (error) {
    log(`client patch generation failed: ${errorMessage(error)}`)
    throw error
  }
}

async function finishSetup(): Promise<void> {
  try {
    await patchRealmlist()
    await installAddon()
    await generateClientPatch()
    log('completed')
  } catch (error) {
    log(`setup after download failed: ${errorMessage(error)}`)
    log('completed with errors')
  }
  await stopTorrent()
}

async function shareLogs(): Promise<Response> {
  if (!SERVICE_ORIGIN || !verificationHash) {
    const error = 'Missing launcher service URL or verification hash.'
    log(`log upload failed: ${error}`)
    return Response.json(
      { error },
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
  const response = await fetch(`${SERVICE_ORIGIN}/launcher/logs/${sha1}`, {
    method: 'POST',
    headers: {
      'content-encoding': 'br',
      'content-type': 'text/plain; charset=utf-8',
      'x-verification-hash': verificationHash,
    },
    body: compressed,
  })
  if (!response.ok) {
    const error = await response.text()
    log(`log upload failed: ${response.status} ${error}`)
    return Response.json({ error }, {
      status: response.status,
    })
  }

  return Response.json({
    bytes: compressed.byteLength,
    entries: tail.length,
    url: `${SERVICE_ORIGIN}/launcher/logs/${sha1}`,
  })
}

function formatLogs(entries: LogEntry[]): string {
  return entries.map((entry) => `[${entry.timestamp}] ${entry.message}`).join(
    '\n',
  ) + '\n'
}

function logStatus(): void {
  if (!activeTorrent) return
  if (torrentReady && !activeTorrent.done && !webSeedFinalizationStarted && activeTorrent.progress >= 0.99) {
    webSeedFinalizationStarted = true
    log('99% reached; finishing remaining pieces from webseed')
    activeTorrent.preferWebSeed()
  }
  const remaining = Math.max(0, activeTorrent.length - activeTorrent.downloaded)
  const progress = activeTorrent.done
    ? '100.0'
    : (Math.max(0, Math.min(0.999, activeTorrent.progress)) * 100).toFixed(1)
  const eta = activeTorrent.done
    ? 'complete'
    : !torrentReady
    ? `checking local files ${progress}%`
    : activeTorrent.progress >= 0.999
    ? 'checking final pieces'
    : activeTorrent.downloadSpeed > 0
    ? formatDuration(remaining / activeTorrent.downloadSpeed)
    : 'unknown'
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
  await stopTorrent()
  log('launcher stopped')
}

async function stopTorrent(): Promise<void> {
  if (torrentStopped) return
  torrentStopped = true
  if (statusTimer !== null) clearInterval(statusTimer)
  statusTimer = null
  if (activeTorrent) log('stopping torrent')

  const currentClient = client
  client = null
  if (currentClient) {
    await new Promise<void>((resolve) => currentClient.destroy(resolve))
  }
  if (activeTorrent) log('torrent stopped; not seeding')
}

function startTorrent(forceFullCheck = false): void {
  clientRoot = defaultClientPath
  if (statusTimer !== null) clearInterval(statusTimer)
  torrentReady = false
  quickCheckPassed = false
  webSeedFinalizationStarted = false

  log('loading embedded torrent')
  const existingClient = !forceFullCheck ? findExistingClient() : null
  if (existingClient) {
    clientRoot = existingClient
    log(`existing client found: ${clientPath()}`)
    quickCheckPassed = true
    torrentReady = true
    torrentStopped = true
    log(`torrent info hash: ${torrentMetadata.infoHash}`)
    log(`metadata received: ${torrentMetadata.name} (${formatBytes(torrentMetadata.length)})`)
    log('quick file check passed; full check skipped')
    log('quick file check passed; torrent not needed')
    log(`client files root: ${clientPath()}`)
    log('download completed')
    void finishSetup()
    return
  }

  torrentStopped = false

  logStep('creating WebTorrent client')
  client = new WebTorrent(WEBTORRENT_OPTIONS) as unknown as Client
  logStep('WebTorrent client created')
  client.on('error', (error) => {
    log(`client error: ${errorMessage(error)}`)
    recover(error)
  })
  logStep('adding torrent to client')
  activeTorrent = client.add(torrentBytes, {
    path: downloadPath,
    announce: [TRACKER_URL],
    urlList: [webseedUrl],
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
      if (!forceFullCheck && quickCheckFiles(clientPath(), activeTorrent!.files)) {
        quickCheckPassed = true
        activeTorrent!.skipVerify = true
        log('quick file check passed; full check skipped')
      } else if (forceFullCheck) {
        if (quickCheckFiles(clientPath(), activeTorrent!.files)) {
          activeTorrent!.skipPieces = [0]
          log('full file recheck requested; piece 0 skipped because its files are present')
        } else {
          log('full file recheck requested')
        }
      }
      log(`client files root: ${clientPath()}`)
      exists(clientPath()).then((found) => log(`client files root existed at startup: ${found ? 'yes' : 'no'}`))
      log(`first torrent file: ${activeTorrent!.files[0]?.path ?? 'none'}`)
    },
  )
  activeTorrent.on('ready', () => {
    torrentReady = true
    logStep('existing data check finished')
    log('torrent ready; existing data checked')
  })
  activeTorrent.on(
    'wire',
    (wire) =>
      log(
        `peer connected${(wire as { type?: string }).type === 'webSeed' ? ' (webseed)' : ''}: ${
          activeTorrent!.numPeers
        } peer(s)`,
      ),
  )
  activeTorrent.on('done', () => {
    log('download completed')
    logStatus()
    void finishSetup()
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

async function recheckFiles(): Promise<void> {
  if (!quickCheckPassed) throw new Error('full recheck is not available')
  quickCheckPassed = false
  await stopTorrent()
  if (!stopped) startTorrent(true)
}

function recover(error: unknown): void {
  if (stopped || torrentStopped || recovering) return
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
    try {
      return await shareLogs()
    } catch (error) {
      log(`log upload failed: ${errorMessage(error)}`)
      return Response.json({ error: errorMessage(error) }, { status: 500 })
    }
  }

  if (path === '/recheck') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      await recheckFiles()
      return Response.json({ ok: true })
    } catch (error) {
      log(`full file recheck failed: ${errorMessage(error)}`)
      return Response.json({ error: errorMessage(error) }, { status: 400 })
    }
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

  if (path === '/patch') {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const path = await generateClientPatch()
      return Response.json({ path })
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

  const previousLauncherUrl = localStorage.getItem(SAVED_LAUNCHER_URL_KEY)
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

  void (async () => {
    try {
      await loadLauncherConfig()
      started = true
      logStep('launcher started; configuration received')
      await stopPreviousLauncher(previousLauncherUrl)
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
      if (stopped) return
      startTorrent()
    } catch (error) {
      log(`launcher startup failed: ${errorMessage(error)}`)
    }
  })()

  await server.finished
  await shutdown()
}
