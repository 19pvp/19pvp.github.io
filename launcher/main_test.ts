import { assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import { handler, isRealmlistFile, torrentDownloadPath } from './main.ts'

Deno.test('serves the launcher page', async () => {
  const response = await handler(new Request('http://localhost/'))
  assertEquals(response.status, 200)
  const body = await response.text()
  assertStringIncludes(body, '19PvP Launcher')
  assertStringIncludes(body, 'id="choose-directory"')
  assertStringIncludes(body, 'id="log-details"')
  assertStringIncludes(body, 'id="close-page"')
  assertStringIncludes(body, 'CONFIGURE REALMLIST')
  assertStringIncludes(body, 'INSTALL THE COMPANION ADDON')
  assertStringIncludes(body, 'GENERATE CLIENT PATCH')
  assertStringIncludes(body, 'FIND EXISTING CLIENT')
  assertStringIncludes(body, '/shutdown')
})

Deno.test('accepts shutdown requests', async () => {
  const response = await handler(
    new Request('http://localhost/shutdown', { method: 'POST' }),
  )
  assertEquals(response.status, 200)
})

Deno.test('changes the download path', async () => {
  localStorage.removeItem('downloadPath')
  const path = await Deno.makeTempDir()
  const response = await handler(
    new Request('http://localhost/download-path', {
      method: 'POST',
      body: path,
    }),
  )
  assertEquals(response.status, 200)
  const status = await response.json()
  assertEquals(status.downloadPath, path)
  assertEquals(status.clientPath, `${path}/World of Warcraft 3.3.5a`)
  assertEquals(status.changed, true)
  assertEquals(localStorage.getItem('downloadPath'), path)

  const samePath = await handler(
    new Request('http://localhost/download-path', {
      method: 'POST',
      body: `${path}/World of Warcraft 3.3.5a`,
    }),
  )
  assertEquals(samePath.status, 200)
  assertEquals((await samePath.json()).changed, false)

  const oldClientPath = join(path, 'World of Warcraft 3.3.5a')
  await Deno.mkdir(oldClientPath, { recursive: true })
  await Deno.writeTextFile(join(oldClientPath, 'realmlist.wtf'), 'set realmlist logon.19pvp.com')

  const nextPath = await Deno.makeTempDir()
  const moved = await handler(
    new Request('http://localhost/download-path', {
      method: 'POST',
      body: join(nextPath, 'World of Warcraft 3.3.5a'),
    }),
  )
  assertEquals(moved.status, 200)
  assertEquals((await moved.json()).changed, true)
  assertEquals(
    await Deno.readTextFile(join(nextPath, 'World of Warcraft 3.3.5a', 'realmlist.wtf')),
    'set realmlist logon.19pvp.com',
  )
  assertEquals(await Deno.stat(oldClientPath).then(() => true, () => false), false)
})

Deno.test('normalizes selected client directory to torrent parent', () => {
  assertEquals(
    torrentDownloadPath('/tmp/World of Warcraft 3.3.5a'),
    '/tmp',
  )
  assertEquals(
    torrentDownloadPath('/tmp/World of Warcraft 3.3.5a/World of Warcraft 3.3.5a'),
    '/tmp',
  )
})

Deno.test('finds realmlist files', () => {
  assertEquals(isRealmlistFile({ name: 'realmlist.wtf' }), true)
  assertEquals(isRealmlistFile({ name: 'README.txt' }), false)
})

Deno.test('serves status and an SSE stream', async () => {
  const status = await (await handler(new Request('http://localhost/api')))
    .json()
  assertEquals(status.started, false)

  const response = await handler(new Request('http://localhost/events'))
  assertEquals(
    response.headers.get('content-type'),
    'text/event-stream; charset=utf-8',
  )
  const reader = response.body!.getReader()
  let body = ''
  while (!body.includes(': connected')) {
    const chunk = await reader.read()
    body += new TextDecoder().decode(chunk.value)
  }
  await reader.cancel()
  assertStringIncludes(body, ': connected')
})
