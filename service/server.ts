import { TextLineStream } from '@std/streams'
import { cors, json, runCommand, sse } from './utils.ts'
import { watch } from '../tasks/config.ts'
import { ac } from './soap.ts'
import { checkAuth, getSession, handleAuth } from './auth.ts'
import { getAccountDetails, setOrCreateAccount } from './account.ts'
import { auth } from './db.ts'
import { env } from './env.ts'
import { handleLauncherLog } from './launcher_logs.ts'

import indexHTML from '../web/index.html' with { type: 'bytes' }
import installHTMLRaw from '../web/install.html' with { type: 'text' }
import eventsHTML from '../web/events.html' with { type: 'bytes' }
import pvp19Lua from '../addons/PvP19/PvP19.lua' with { type: 'bytes' }
import pvp19Toc from '../addons/PvP19/PvP19.toc' with { type: 'text' }
import launcherPatch from '../launcher/patch.json' with { type: 'json' }
import manifestJSON from './manifest.json' with { type: 'json' }

void import('./world-chat.ts').catch((err) => {
  console.error('Discord bridge failed to start', err)
})

const pvp19AddonVersion = pvp19Toc.match(/^## Version:\s*(.+)$/m)?.[1]?.trim()
if (!pvp19AddonVersion) throw Error('missing PvP19 addon version in toc')
const [realm] = await auth.sql`SELECT address FROM realmlist WHERE id = ${env.WORLD_ID}`
const launcherRealmlist = String(realm?.address ?? '')
if (!launcherRealmlist) throw Error(`realm not found: ${env.WORLD_ID}`)

const installHTMLBytes = new TextEncoder().encode(
  installHTMLRaw
    .replace('MANIFEST_PLACEHOLDER', JSON.stringify(manifestJSON))
    .replace('REALMLIST_PLACEHOLDER', JSON.stringify(launcherRealmlist)),
)

void watch()

export default {
  async fetch(req: Request) {
    try {
      const url = new URL(req.url)
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
      if (url.pathname === '/') {
        return new Response(indexHTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      if (url.pathname === '/install') {
        const session = await getSession(req)
        if (!session) return new Response(null, { status: 302, headers: { location: '/' } })
        return new Response(installHTMLBytes, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      if (url.pathname === '/events') {
        return new Response(eventsHTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      if (url.pathname === '/addons/PvP19.lua') {
        return new Response(pvp19Lua, {
          headers: {
            'cache-control': 'public, max-age=60',
            'content-type': 'text/x-lua; charset=utf-8',
            'x-addon-version': pvp19AddonVersion,
          },
        })
      }
      if (url.pathname.startsWith('/launcher/client-file/')) {
        if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
        const session = await getSession(req)
        if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
        let path: string
        try {
          path = decodeURIComponent(url.pathname.slice('/launcher/client-file/'.length))
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
          const file = await Deno.open(`${env.CLIENT_DIR}/${parts.join('/')}`, { read: true })
          const stat = await file.stat()
          return new Response(file.readable, {
            headers: {
              ...cors,
              'content-length': String(stat.size),
              'content-type': 'application/octet-stream',
              'cache-control': 'public, max-age=31536000, immutable',
              'etag': `W/"${stat.size}-${stat.mtime?.getTime() || 0}"`,
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

      const launcherLog = await handleLauncherLog(req, url)
      if (launcherLog) return launcherLog

      return json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      console.error(err)
      return json({ error: String(err) }, { status: 500 })
    }
  },
}
