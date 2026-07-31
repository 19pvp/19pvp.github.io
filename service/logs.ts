import { createHash } from 'node:crypto'
import { getSession } from './auth.ts'
import { env } from './env.ts'
import { discord } from './discord.ts'

const maxBytes = 1024 * 1024
const route = /^\/logs(?:\/([a-f0-9]{40}))?$/
const logDir = env.LOG_DIR

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init)
const logPath = (sha1: string) => `${logDir}/${sha1.slice(0, 2)}/${sha1.slice(2)}`

export const handleLog = async (req: Request, url: URL) => {
  const match = url.pathname.match(route)
  if (!match) return null

  const session = await getSession(req)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  if (req.method === 'POST') return save(req, match[1], url, session.discordId)
  if (req.method === 'GET' && match[1]) return get(match[1])
  return new Response('Method not allowed', { status: 405 })
}

const save = async (
  req: Request,
  expectedSha1: string | undefined,
  url: URL,
  discordId: string,
) => {
  const encoding = req.headers.get('content-encoding')
  if (encoding !== 'br' && encoding !== 'gzip') {
    return json({ error: 'Only Brotli or gzip logs are accepted.' }, { status: 415 })
  }
  if (!req.body) return json({ error: 'Missing request body.' }, { status: 400 })

  await Deno.mkdir(logDir, { recursive: true })
  const tempPath = `${logDir}/.${crypto.randomUUID()}.tmp`
  const file = await Deno.open(tempPath, { createNew: true, write: true })
  const hash = createHash('sha1')
  let size = 0
  let complete = false

  try {
    for await (const value of req.body) {
      size += value.byteLength
      if (size > maxBytes) return json({ error: 'Log upload is too large.' }, { status: 413 })
      hash.update(value)
      await file.write(value)
    }

    const sha1 = hash.digest('hex')
    if (expectedSha1 && sha1 !== expectedSha1) {
      return json({ error: 'SHA-1 mismatch.' }, { status: 400 })
    }

    const path = logPath(sha1)
    await Deno.mkdir(`${logDir}/${sha1.slice(0, 2)}`, { recursive: true })
    await Deno.rename(tempPath, path)
    complete = true

    const logUrl = `${url.origin}/logs/${sha1}`
    await notifyDiscord(logUrl, discordId)
    return json({ url: logUrl }, { status: 201 })
  } finally {
    file.close()
    if (!complete) await Deno.remove(tempPath).catch(() => {})
  }
}

const notifyDiscord = async (logUrl: string, discordId: string) => {
  if (!env.DISCORD_TOKEN || !env.DISCORD_LOG_CHANNEL_ID) return
  try {
    await discord.rest.POST_CHANNEL_MESSAGE({
      channel: env.DISCORD_LOG_CHANNEL_ID,
      content: `${discordId ? `<@${discordId}> ` : ''}uploaded logs: ${logUrl}`,
    })
  } catch (error) {
    console.error('Failed to send Discord log notification', error)
  }
}

const get = async (sha1: string) => {
  try {
    const path = logPath(sha1)
    const bytes = await Deno.readFile(path)
    const file = await Deno.open(path, { read: true })
    const contentEncoding = bytes[0] === 0x1f && bytes[1] === 0x8b ? 'gzip' : 'br'
    return new Response(file.readable, {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-encoding': contentEncoding,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return json({ error: 'Not found' }, { status: 404 })
    throw error
  }
}
