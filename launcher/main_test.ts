import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler, isRealmlistFile } from './main.ts'

Deno.test('serves the launcher page', async () => {
  const response = await handler(new Request('http://localhost/'))
  assertEquals(response.status, 200)
  const body = await response.text()
  assertStringIncludes(body, '19PvP Launcher')
  assertStringIncludes(body, 'id="log-details"')
  assertStringIncludes(body, 'id="close-page"')
  assertStringIncludes(body, 'CONFIGURE REALMLIST')
  assertStringIncludes(body, 'INSTALL THE COMPANION ADDON')
  assertStringIncludes(body, 'GENERATE CLIENT PATCH')
  assertStringIncludes(body, '/shutdown')
})

Deno.test('accepts shutdown requests', async () => {
  const response = await handler(
    new Request('http://localhost/shutdown', { method: 'POST' }),
  )
  assertEquals(response.status, 200)
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
