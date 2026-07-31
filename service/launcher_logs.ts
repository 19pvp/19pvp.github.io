import { createHash } from 'node:crypto'
import { getSession } from './auth.ts'
import { env } from './env.ts'

const maxBytes = 1024 * 1024
const route = /^\/launcher\/logs\/([a-f0-9]{40})$/
const logDir = env.LAUNCHER_LOG_DIR

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init)

const logPath = (sha1: string) => `${logDir}/${sha1.slice(0, 2)}/${sha1.slice(2)}`

export const handleLauncherLog = async (
  req: Request,
  url: URL,
) => {
  const match = url.pathname.match(route)
  if (!match) return null

  const session = await getSession(req)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const sha1 = match[1]
  if (req.method === 'POST') return await save(req, sha1, url)
  if (req.method === 'GET') return await get(sha1)
  return new Response('Method not allowed', { status: 405 })
}

const save = async (req: Request, sha1: string, url: URL) => {
  if (req.headers.get('content-encoding') !== 'br') {
    return json({ error: 'Only Brotli logs are accepted.' }, { status: 415 })
  }
  if (!req.body) {
    return json({ error: 'Missing request body.' }, { status: 400 })
  }

  const dir = `${logDir}/${sha1.slice(0, 2)}`
  await Deno.mkdir(dir, { recursive: true })
  const tempPath = `${dir}/.${crypto.randomUUID()}.tmp`
  const file = await Deno.open(tempPath, { createNew: true, write: true })
  const hash = createHash('sha1')
  let size = 0

  try {
    for await (const chunk of req.body) {
      size += chunk.byteLength
      if (size > maxBytes) {
        return json({ error: 'Log upload is too large.' }, { status: 413 })
      }
      hash.update(chunk)
      await file.write(chunk)
    }
  } finally {
    file.close()
    if (size > maxBytes) await Deno.remove(tempPath).catch(() => {})
  }

  const actualSha1 = hash.digest('hex')
  if (actualSha1 !== sha1) {
    await Deno.remove(tempPath).catch(() => {})
    return json({ error: 'SHA-1 mismatch.' }, { status: 400 })
  }

  await Deno.rename(tempPath, logPath(sha1))
  return json({ url: `${url.origin}/launcher/logs/${sha1}` }, { status: 201 })
}

const get = async (sha1: string) => {
  try {
    const file = await Deno.open(logPath(sha1), { read: true })
    return new Response(file.readable, {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-encoding': 'br',
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return json({ error: 'Not found' }, { status: 404 })
    }
    throw err
  }
}
