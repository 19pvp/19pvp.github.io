import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { assertEquals } from 'jsr:@std/assert'
import { handleLauncherLog } from './launcher_logs.ts'
import { env } from './env.ts'

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

// Helper to mock session token in auth test scope
import { handleAuth } from './auth.ts'

Deno.test('stores and serves compressed launcher logs by sha1 for authenticated session', async () => {
  const body = Uint8Array.from(brotliCompressSync(new TextEncoder().encode('hello\n')))
  const hash = sha1(body)
  const sessionId = 'test-session-id'
  localStorage.setItem(`session:${sessionId}`, JSON.stringify({
    user: { id: '123' },
    gmLevel: 0,
    discordId: '123',
    exp: Date.now() + 3600000,
  }))

  const post = await handleLauncherLog(
    new Request(`https://example.test/launcher/logs/${hash}`, {
      method: 'POST',
      headers: { 'content-encoding': 'br', 'cookie': `logs_session=${sessionId}` },
      body,
    }),
    new URL(`https://example.test/launcher/logs/${hash}`),
  )

  assertEquals(post?.status, 201)
  assertEquals(await Deno.readFile(`${env.LAUNCHER_LOG_DIR}/${hash.slice(0, 2)}/${hash.slice(2)}`), body)

  const get = await handleLauncherLog(
    new Request(`https://example.test/launcher/logs/${hash}`, {
      headers: { cookie: `logs_session=${sessionId}` },
    }),
    new URL(`https://example.test/launcher/logs/${hash}`),
  )

  assertEquals(get?.headers.get('content-encoding'), 'br')
  assertEquals(new Uint8Array(await get!.arrayBuffer()), body)
})
