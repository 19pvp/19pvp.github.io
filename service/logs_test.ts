import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { assertEquals } from 'jsr:@std/assert'
import { handleLog } from './logs.ts'
import { env } from './env.ts'

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

Deno.test('stores and serves compressed install logs by sha1 for authenticated session', async () => {
  const body = Uint8Array.from(brotliCompressSync(new TextEncoder().encode('hello\n')))
  const hash = sha1(body)
  const sessionId = 'test-session-id'
  localStorage.setItem(
    `session:${sessionId}`,
    JSON.stringify({
      user: { id: '123' },
      gmLevel: 0,
      discordId: '123',
      exp: Date.now() + 3600000,
    }),
  )

  const post = await handleLog(
    new Request(`https://example.test/logs/${hash}`, {
      method: 'POST',
      headers: { 'content-encoding': 'br', 'cookie': `logs_session=${sessionId}` },
      body,
    }),
    new URL(`https://example.test/logs/${hash}`),
  )

  assertEquals(post?.status, 201)
  assertEquals(await Deno.readFile(`${env.LOG_DIR}/${hash.slice(0, 2)}/${hash.slice(2)}`), body)

  const get = await handleLog(
    new Request(`https://example.test/logs/${hash}`, {
      headers: { cookie: `logs_session=${sessionId}` },
    }),
    new URL(`https://example.test/logs/${hash}`),
  )

  assertEquals(get?.headers.get('content-encoding'), 'br')
  assertEquals(new Uint8Array(await get!.arrayBuffer()), body)
})
