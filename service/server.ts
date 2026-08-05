import { closeDbConnections } from './db.ts'

const handleShutdown = async () => {
  console.log('\nShutting down server...')
  const timeout = setTimeout(() => {
    console.warn('Forcing exit after 1s shutdown timeout.')
    Deno.exit(0)
  }, 1000)

  await closeDbConnections().catch(() => {})
  clearTimeout(timeout)
  Deno.exit(0)
}

if (typeof Deno.addSignalListener === 'function') {
  try {
    Deno.addSignalListener('SIGINT', handleShutdown)
    Deno.addSignalListener('SIGTERM', handleShutdown)
  } catch {}
}
import { cors, json, runCommand, sse } from './utils.ts'
import { watch } from '../tasks/config.ts'
import { ac } from './soap.ts'
import { checkAuth, getSession, handleAuth } from './auth.ts'
import { getAccountDetails, setOrCreateAccount } from './account.ts'
import { auth } from './db.ts'
import { env } from './env.ts'
import { handleLog } from './logs.ts'
import { getLeaderboards } from './leaderboards.ts'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

import indexHTMLRaw from '../web/index.html' with { type: 'text' }
import templateHTMLRaw from '../web/template.html' with { type: 'text' }
import leaderboardsHTMLRaw from '../web/leaderboards.html' with { type: 'text' }
import accountHTMLRaw from '../web/account.html' with { type: 'text' }
import installHTMLRaw from '../web/install.html' with { type: 'text' }
import eventsHTMLRaw from '../web/events.html' with { type: 'text' }
import aboutHTMLRaw from '../web/about.html' with { type: 'text' }
import styleCSSRaw from '../web/style.css' with { type: 'text' }
import scriptJSRaw from '../web/script.js' with { type: 'text' }
import tooltipJSRaw from '../web/tooltip.js' with { type: 'text' }
import pvp19Toc from '../addons/PvP19/PvP19.toc' with { type: 'text' }
import manifestJSON from './manifest.json' with { type: 'json' }

void import('./world-chat.ts').catch((err) => {
  console.error('Discord bridge failed to start', err)
})

const pvp19AddonVersion = pvp19Toc.match(/^## Version:\s*(.+)$/m)?.[1]?.trim()
if (!pvp19AddonVersion) throw Error('missing PvP19 addon version in toc')
const [realm] = await auth.sql`SELECT address FROM realmlist WHERE id = ${env.WORLD_ID}`
const launcherRealmlist = String(realm?.address ?? '')
if (!launcherRealmlist) throw Error(`realm not found: ${env.WORLD_ID}`)

const patchPath = `${import.meta.dirname}/../patch-files/patch-S.mpq`
let patchSha1 = ''
try {
  const file = await Deno.open(patchPath, { read: true })
  const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB blocks
  const blockHashes: Uint8Array[] = []
  const buf = new Uint8Array(CHUNK_SIZE)

  while (true) {
    const bytesRead = await file.read(buf)
    if (bytesRead === null || bytesRead === 0) break
    const chunk = buf.subarray(0, bytesRead)
    const blockHash = new Uint8Array(await crypto.subtle.digest('SHA-256', chunk))
    blockHashes.push(blockHash)
  }
  file.close()

  // Concat all block hashes and compute Merkle root hash
  const totalLength = blockHashes.reduce((acc, h) => acc + h.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const h of blockHashes) {
    combined.set(h, offset)
    offset += h.length
  }
  const rootBuffer = await crypto.subtle.digest('SHA-256', combined)
  patchSha1 = Array.from(new Uint8Array(rootBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
} catch {}

type StaticOptions = {
  type: string
  cache?: string
  headers?: HeadersInit
}

const staticFile = (filePath: string, options: StaticOptions) => {
  const resource = (async () => {
    const path = new URL(filePath, import.meta.url)
    const [body, file] = await Promise.all([Deno.readFile(path), Deno.stat(path)])
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
    const etag = `"${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}"`
    const brotli = brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    })
    const gzip = gzipSync(body, { level: 9 })
    return {
      body,
      brotli: brotli.length < body.length ? brotli : undefined,
      gzip: gzip.length < body.length ? gzip : undefined,
      etag,
      lastModified: file.mtime?.toUTCString(),
    }
  })()

  return async (request: Request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    const asset = await resource
    const headers = new Headers(options.headers)
    headers.set('cache-control', options.cache ?? 'public, max-age=3600')
    headers.set('content-type', options.type)
    headers.set('etag', asset.etag)
    headers.set('vary', 'Accept-Encoding')
    if (asset.lastModified) headers.set('last-modified', asset.lastModified)

    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === '*' || ifNoneMatch?.split(',').some((tag) => tag.trim() === asset.etag)) {
      return new Response(null, { status: 304, headers })
    }

    const accepted = new Map(
      (request.headers.get('accept-encoding') ?? '')
        .toLowerCase()
        .split(',')
        .map((value) => {
          const [encoding, ...parameters] = value.trim().split(';')
          const quality = parameters.find((parameter) => parameter.trim().startsWith('q='))?.trim().slice(2)
          return [encoding, quality === undefined ? 1 : Number(quality)]
        })
        .filter(([encoding, quality]) => encoding && Number.isFinite(quality)) as [string, number][],
    )
    const quality = (encoding: string) => accepted.get(encoding) ?? accepted.get('*') ?? 0
    const brotliQuality = asset.brotli ? quality('br') : 0
    const gzipQuality = asset.gzip ? quality('gzip') : 0
    const encoding = brotliQuality >= gzipQuality && brotliQuality > 0 ? 'br' : gzipQuality > 0 ? 'gzip' : undefined
    const body = encoding === 'br'
      ? asset.brotli ?? asset.body
      : encoding === 'gzip'
      ? asset.gzip ?? asset.body
      : asset.body
    const bodyBytes = new Uint8Array(body)
    if (encoding) headers.set('content-encoding', encoding)
    headers.set('content-length', String(bodyBytes.length))

    return new Response(request.method === 'HEAD' ? null : bodyBytes, { headers })
  }
}

const inlineAssets = (html: string) => {
  return html
    .replace(/<link rel="stylesheet" href="\/style\.css(\?v=\d+)?"\s*\/?>/, `<style>${styleCSSRaw}</style>`)
    .replace('</head>', `<script type="module">\n${scriptJSRaw}\n${tooltipJSRaw}\n</script>\n</head>`)
}

const composePage = (content: string, title: string, prefetch = '', containerClass = '') => {
  return templateHTMLRaw
    .replace('<!--@TITLE@-->', title)
    .replace('<!--@PREFETCH@-->', prefetch)
    .replace('<!--@CONTAINER_CLASS@-->', containerClass)
    .replace('<!--@PAGE_CONTENT@-->', content.match(/<main [\s\S]*?<\/main>/)?.[0] || '')
    .replace(
      '<!--@PAGE_STYLE@-->',
      `<style data-page-style>${content.match(/<style data-page-style>([\s\S]*?)<\/style>/)?.[1] || ''}</style>`,
    )
    .replace(
      '<!--@PAGE_SCRIPT@-->',
      `<script type="module" data-page-script>${
        content.match(/<script type="module" data-page-script>([\s\S]*?)<\/script>/)?.[1] || ''
      }</script>`,
    )
}

const indexHTMLBytes = new TextEncoder().encode(inlineAssets(indexHTMLRaw))
const leaderboardsHTMLBytes = new TextEncoder().encode(inlineAssets(composePage(
  leaderboardsHTMLRaw,
  '19 PvP - Leaderboards',
  '<link rel="prefetch" href="/install" as="document">',
)))
const accountHTMLBytes = new TextEncoder().encode(inlineAssets(composePage(
  accountHTMLRaw,
  '19 PvP - Account',
  '<link rel="prefetch" href="/leaderboards" as="document">',
)))
const eventsHTMLBytes = new TextEncoder().encode(inlineAssets(composePage(
  eventsHTMLRaw,
  '19 PvP – Event Audit',
  '',
  ' events-shell',
)))
const aboutHTMLBytes = new TextEncoder().encode(inlineAssets(composePage(
  aboutHTMLRaw,
  '19 PvP - About the Server',
)))
const installHTMLBytes = new TextEncoder().encode(
  inlineAssets(
    composePage(
      installHTMLRaw,
      '19 PvP - Client Installer & Patcher',
      '<link rel="prefetch" href="/leaderboards" as="document">',
    )
      .replace('MANIFEST_PLACEHOLDER', JSON.stringify(manifestJSON))
      .replace('REALMLIST_PLACEHOLDER', JSON.stringify(launcherRealmlist)),
  ),
)
const respondText = (content: string | Uint8Array<ArrayBuffer>, type = 'text/html') =>
  new Response(content, { headers: { 'content-type': `${type}; charset=utf-8` } })

const staticStyle = staticFile('../web/style.css', { type: 'text/css' })
const staticScript = staticFile('../web/script.js', { type: 'text/javascript', cache: 'no-cache' })
const staticTooltip = staticFile('../web/tooltip.js', { type: 'text/javascript', cache: 'no-cache' })
const staticTooltipTest = staticFile('../web/tooltip-test.html', { type: 'text/html', cache: 'no-cache' })
const staticDatabase = staticFile('../web/db.json', { type: 'application/json' })
const staticIconsAVIF = staticFile('../web/assets/icons.avif', {
  type: 'image/avif',
  cache: 'public, max-age=31536000, immutable',
})
const staticIconsJPG = staticFile('../web/assets/icons.jpg', {
  type: 'image/jpeg',
  cache: 'public, max-age=31536000, immutable',
})
const staticLogo = staticFile('../web/logo.png', { type: 'image/png', cache: 'public, max-age=31536000, immutable' })
const staticAddon = staticFile('../addons/PvP19/PvP19.lua', {
  type: 'text/x-lua; charset=utf-8',
  cache: 'public, max-age=60',
  headers: { 'x-addon-version': pvp19AddonVersion },
})

void watch()

export default {
  async fetch(req: Request) {
    try {
      const url = new URL(req.url)
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
      if (url.pathname === '/') return respondText(indexHTMLBytes, 'text/html')
      if (url.pathname === '/leaderboards') return respondText(leaderboardsHTMLBytes, 'text/html')
      if (url.pathname === '/account') return respondText(accountHTMLBytes, 'text/html')
      if (url.pathname === '/install') {
        const session = await getSession(req)
        if (!session) return new Response(null, { status: 302, headers: { location: '/' } })
        return respondText(installHTMLBytes, 'text/html')
      }
      if (url.pathname === '/events') return respondText(eventsHTMLBytes, 'text/html')
      if (url.pathname === '/about' || url.pathname === '/about.html') return respondText(aboutHTMLBytes, 'text/html')
      if (url.pathname === '/tooltip-test' || url.pathname === '/tooltip-test.html') return staticTooltipTest(req)
      if (url.pathname === '/style.css') return staticStyle(req)
      if (url.pathname === '/script.js') return staticScript(req)
      if (url.pathname === '/tooltip.js') return staticTooltip(req)
      if (url.pathname === '/db.json') return staticDatabase(req)
      if (url.pathname === '/assets/icons.avif') return staticIconsAVIF(req)
      if (url.pathname === '/assets/icons.jpg') return staticIconsJPG(req)
      if (url.pathname === '/logo.png') return staticLogo(req)
      if (url.pathname === '/addons/PvP19.lua') return staticAddon(req)
      if (url.pathname === '/patch-S.mpq') {
        const session = await getSession(req)
        if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
        try {
          const file = await Deno.open(patchPath, { read: true })
          const stat = await file.stat()
          const etag = `"${patchSha1 || stat.size}"`
          const clientIfNoneMatch = req.headers.get('if-none-match')

          if (clientIfNoneMatch === etag) {
            file.close()
            return new Response(null, {
              status: 304,
              headers: {
                ...cors,
                'etag': etag,
                'cache-control': 'public, max-age=3600',
              },
            })
          }

          return new Response(file.readable, {
            headers: {
              ...cors,
              'content-length': String(stat.size),
              'content-type': 'application/octet-stream',
              'cache-control': 'public, max-age=3600',
              'etag': etag,
            },
          })
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return new Response('Not found', { status: 404 })
          throw error
        }
      }
      if (url.pathname.startsWith('/client-file/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
        const session = await getSession(req)
        if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
        let path: string
        try {
          path = decodeURIComponent(url.pathname.slice('/client-file/'.length))
        } catch {
          return new Response('Not found', { status: 404 })
        }
        const parts = path.split('/')
        if (
          parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))
        ) {
          return new Response('Not found', { status: 404 })
        }
        try {
          const filePath = `${env.CLIENT_DIR}/${parts.join('/')}`
          const file = await Deno.open(filePath, { read: true })
          const stat = await file.stat()
          const etag = `W/"${stat.size}-${stat.mtime?.getTime() || 0}"`

          const rangeHeader = req.headers.get('range')
          if (rangeHeader) {
            const match = rangeHeader.match(/^bytes=(\d+)-(\d+)?$/)
            if (match) {
              const start = parseInt(match[1], 10)
              const end = match[2] ? parseInt(match[2], 10) : stat.size - 1

              if (start >= stat.size || end >= stat.size || start > end) {
                file.close()
                return new Response('Range Not Satisfiable', {
                  status: 416,
                  headers: { ...cors, 'content-range': `bytes */${stat.size}` },
                })
              }

              await file.seek(start, Deno.SeekMode.Start)
              const chunkLength = end - start + 1

              // Create bounded readable stream for range
              let bytesRead = 0
              const stream = file.readable.pipeThrough(
                new TransformStream({
                  transform(chunk, controller) {
                    const remaining = chunkLength - bytesRead
                    if (remaining <= 0) {
                      controller.terminate()
                      return
                    }
                    if (chunk.byteLength > remaining) {
                      controller.enqueue(chunk.subarray(0, remaining))
                      bytesRead += remaining
                      controller.terminate()
                    } else {
                      controller.enqueue(chunk)
                      bytesRead += chunk.byteLength
                    }
                  },
                }),
              )

              return new Response(stream, {
                status: 206,
                headers: {
                  ...cors,
                  'content-range': `bytes ${start}-${end}/${stat.size}`,
                  'accept-ranges': 'bytes',
                  'content-length': String(chunkLength),
                  'content-type': 'application/octet-stream',
                  'cache-control': 'public, max-age=31536000, immutable',
                  'etag': etag,
                },
              })
            }
          }

          return new Response(file.readable, {
            headers: {
              ...cors,
              'accept-ranges': 'bytes',
              'content-length': String(stat.size),
              'content-type': 'application/octet-stream',
              'cache-control': 'public, max-age=31536000, immutable',
              'etag': etag,
            },
          })
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return new Response('Not found', { status: 404 })
          throw error
        }
      }

      if (url.pathname === '/api/account') {
        const session = await getSession(req)
        if (!session) {
          return json({ error: 'Unauthorized' }, {
            status: 401,
            headers: { 'access-control-allow-origin': env.PUBLIC_BASE_URL, 'access-control-allow-credentials': 'true' },
          })
        }

        const corsHeaders = {
          'access-control-allow-origin': env.PUBLIC_BASE_URL,
          'access-control-allow-credentials': 'true',
        }

        if (req.method === 'GET') {
          const details = await getAccountDetails(session.discordId)
          return json({
            authenticated: true,
            user: session.user,
            gmLevel: session.gmLevel,
            ...details,
          }, { headers: corsHeaders })
        }

        if (req.method === 'POST') {
          try {
            const body = await req.json()
            const { username, password } = body
            if (!username || !password) {
              return json({ error: 'Username and password are required.' }, { status: 400, headers: corsHeaders })
            }
            const discordUser = session.user as { username?: string }
            const discordUsername = discordUser?.username || 'Unknown'
            const res = await setOrCreateAccount(
              session.discordId,
              discordUsername,
              username,
              password,
              session.gmLevel,
            )
            if (!res.success) {
              const outputObj = res.output as { message?: string } | undefined
              return json({ error: outputObj?.message || 'Failed to update account.' }, {
                status: 400,
                headers: corsHeaders,
              })
            }
            return json(res, { headers: corsHeaders })
          } catch (err) {
            return json({ error: String(err) }, { status: 400, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/leaderboards') {
        if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
        const metric = url.searchParams.get('metric') || 'damageDone'
        const period = url.searchParams.get('period') || 'all'
        const mode = url.searchParams.get('mode') || 'absolute'
        const kind = url.searchParams.get('kind') || 'battleground'
        const arenaType = url.searchParams.get('arenaType') || 'all'
        try {
          return json(await getLeaderboards(metric, period, mode, kind, arenaType))
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Unknown leaderboard')) {
            return json({ error: error.message }, { status: 400 })
          }
          throw error
        }
      }

      if (url.pathname === '/api/events') {
        if (!(await checkAuth(req))) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        if (req.method === 'GET') {
          const table = url.searchParams.get('table') === 'archive' ? 'web_events_archive' : 'web_events'
          const type = url.searchParams.get('type') || ''
          const search = url.searchParams.get('search') || ''
          const sortParam = url.searchParams.get('sort') || 'id'
          const dirParam = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC'
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
          const col = ['id', 'type', 'at', 'end'].includes(sortParam) ? sortParam : 'id'

          const typeFilter = type ? `AND type = ${JSON.stringify(type)}` : ''
          const searchFilter = search
            ? `AND (type LIKE ${JSON.stringify('%' + search + '%')} OR JSON_UNQUOTE(data) LIKE ${
              JSON.stringify('%' + search + '%')
            })`
            : ''

          const events = await auth.raw.sql`
            SELECT id, type, at, end, data
            FROM ${table}
            WHERE 1=1 ${typeFilter} ${searchFilter}
            ORDER BY ${col} ${dirParam}
            LIMIT ${limit} OFFSET ${offset}
          `

          const [{ total }] = await auth.raw.sql`
            SELECT COUNT(*) AS total FROM ${table}
            WHERE 1=1 ${typeFilter} ${searchFilter}
          `

          const types = (await auth.raw.sql`
            SELECT DISTINCT type FROM web_events
            UNION SELECT DISTINCT type FROM web_events_archive
            ORDER BY type
          `).map((r) => String(r.type))

          const eventsOut = events.map((r) => ({
            id: Number(r.id),
            type: String(r.type),
            at: r.at instanceof Date ? r.at.getTime() : Number(r.at),
            end: r.end instanceof Date ? r.end.getTime() : (r.end ? Number(r.end) : null),
            data: r.data ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : null,
          }))

          return json({ events: eventsOut, total: Number(total), types })
        }
      }

      const authRes = await handleAuth(req)
      if (authRes) return authRes

      const logResponse = await handleLog(req, url)
      if (logResponse) return logResponse
      if (url.pathname.endsWith('.html')) {
        return new Response(null, { status: 308, headers: { location: url.pathname.slice(0, -5) } })
      }
      return json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      console.error(err)
      return json({ error: String(err) }, { status: 500 })
    }
  },
}
