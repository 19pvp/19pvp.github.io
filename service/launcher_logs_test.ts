import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { assertEquals } from 'jsr:@std/assert'
import { handleLauncherLog } from './launcher_logs.ts'

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

Deno.test('stores and serves compressed launcher logs by sha1', async () => {
  const dir = await Deno.makeTempDir()
  const body = Uint8Array.from(brotliCompressSync(new TextEncoder().encode('hello\n')))
  const hash = sha1(body)
  const options = { dir, secret: 'secret' }

  const post = await handleLauncherLog(
    new Request(`https://example.test/launcher/logs/${hash}`, {
      method: 'POST',
      headers: {
        'content-encoding': 'br',
        'x-verification-hash': 'secret',
      },
      body,
    }),
    new URL(`https://example.test/launcher/logs/${hash}`),
    options,
  )

  assertEquals(post?.status, 201)
  assertEquals(await Deno.readFile(`${dir}/${hash.slice(0, 2)}/${hash.slice(2)}`), body)

  const get = await handleLauncherLog(
    new Request(`https://example.test/launcher/logs/${hash}`),
    new URL(`https://example.test/launcher/logs/${hash}`),
    options,
  )

  assertEquals(get?.headers.get('content-encoding'), 'br')
  assertEquals(new Uint8Array(await get!.arrayBuffer()), body)
})
