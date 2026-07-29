import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './main.ts'

Deno.test('serves the launcher page', async () => {
  const response = await handler(new Request('http://localhost/'))
  assertEquals(response.status, 200)
  const body = await response.text()
  assertStringIncludes(body, '19PvP Launcher')
  assertStringIncludes(body, 'webkitdirectory')
  assertStringIncludes(body, '<details>')
  assertEquals(body.includes('<button'), false)
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
  const chunk = await reader.read()
  await reader.cancel()
  assertStringIncludes(new TextDecoder().decode(chunk.value), ': connected')
})
