import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './main.ts'

Deno.test('serves the launcher page', async () => {
  const response = await handler(new Request('http://localhost/'))
  assertEquals(response.status, 200)
  const body = await response.text()
  assertStringIncludes(body, '19PvP Launcher')
  assertStringIncludes(body, 'id="choose-directory"')
  assertStringIncludes(body, 'id="log-details"')
  assertStringIncludes(body, 'id="close-page"')
})

Deno.test('changes the download path', async () => {
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

  const samePath = await handler(
    new Request('http://localhost/download-path', {
      method: 'POST',
      body: `${path}/World of Warcraft 3.3.5a`,
    }),
  )
  assertEquals(samePath.status, 200)
  assertEquals((await samePath.json()).changed, false)
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
