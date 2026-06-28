import worldserverConfig from '../config/worldserver.json' with { type: 'json' }
import controlConfig from '../config/worldserver-control.json' with { type: 'json' }

const encoder = new TextEncoder()
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')
const json = (data: unknown) => Response.json(data, { headers: cors })
const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

const worldserverLogFile = () => {
  const logsDir = unquote(worldserverConfig.LogsDir) || '.'
  const appender = String(worldserverConfig['Appender.Server'] || '2,5,0,Server.log,w')
  const file = appender.split(',')[3] || 'Server.log'
  return `${logsDir.replace(/[\\/]$/, '')}/${file}`
}

const pidExists = (pid: number) => {
  if (!pid) return false

  try {
    Deno.kill(pid, 'SIGCONT')
    return true
  } catch {
    return false
  }
}

const readTail = async (path: string, bytes = 64 * 1024) => {
  try {
    using file = await Deno.open(path)
    const { size } = await file.stat()
    await file.seek(Math.max(0, size - bytes), Deno.SeekMode.Start)
    return (await new Response(file.readable).text()).split(/\r?\n/).filter(Boolean).slice(-300)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return []
    throw err
  }
}

export const logInfo = () => json({ path: worldserverLogFile() })

export const logSearch = async (req: Request) => {
  const query = new URL(req.url).searchParams.get('q') || ''
  if (!query) return json([])

  const rg = new Deno.Command('rg', {
    args: ['--line-number', '--color', 'never', '--max-count', '500', query, worldserverLogFile()],
    stdout: 'piped',
    stderr: 'null',
  })
  const { stdout } = await rg.output()

  return json(new TextDecoder().decode(stdout).split(/\r?\n/).filter(Boolean))
}

export const logEvents = () => {
  let timer: ReturnType<typeof setInterval>

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const path = worldserverLogFile()
        let position = 0

        for (const line of await readTail(path)) controller.enqueue(sse({ line }))

        try {
          position = (await Deno.stat(path)).size
        } catch {
          position = 0
        }

        timer = setInterval(async () => {
          try {
            using file = await Deno.open(path)
            const { size } = await file.stat()

            if (size < position) position = 0
            if (size === position) return

            await file.seek(position, Deno.SeekMode.Start)
            const buffer = new Uint8Array(size - position)
            const count = await file.read(buffer)
            position = size

            if (count) {
              const text = new TextDecoder().decode(buffer.slice(0, count))
              for (const line of text.split(/\r?\n/).filter(Boolean)) controller.enqueue(sse({ line }))
            }
          } catch (err) {
            if (!(err instanceof Deno.errors.NotFound)) controller.enqueue(sse({ error: String(err) }))
          }
        }, 1000)
      },
      cancel() {
        clearInterval(timer)
      },
    }),
    {
      headers: {
        ...cors,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    },
  )
}

export const worldserverStatus = async () => {
  const pid = Number(await Deno.readTextFile(controlConfig.pidFile).catch(() => 0))
  return json({ running: await pidExists(pid), pid: pid || null })
}

export const worldserverStart = async () => {
  const pid = Number(await Deno.readTextFile(controlConfig.pidFile).catch(() => 0))
  if (await pidExists(pid)) return json({ running: true, started: false, pid })

  const child = new Deno.Command(controlConfig.command, {
    args: controlConfig.args,
    cwd: controlConfig.cwd,
    stdout: 'null',
    stderr: 'null',
  }).spawn()

  await Deno.writeTextFile(controlConfig.pidFile, `${child.pid}\n`)
  return json({ running: true, started: true, pid: child.pid })
}

export const worldserverStop = async (signal: Deno.Signal = 'SIGTERM') => {
  const pid = Number(await Deno.readTextFile(controlConfig.pidFile).catch(() => 0))
  if (!pid) return json({ running: false, stopped: false, pid: null })

  try {
    Deno.kill(pid, signal)
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
  }

  if (signal === 'SIGKILL') await Deno.remove(controlConfig.pidFile).catch(() => {})
  return json({ running: await pidExists(pid), stopped: true, pid, signal })
}

export default {
  fetch(req: Request) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (url.pathname === '/logs/info') return logInfo()
    if (url.pathname === '/logs/events') return logEvents()
    if (url.pathname === '/logs/search') return logSearch(req)
    if (url.pathname === '/worldserver/status') return worldserverStatus()
    if (url.pathname === '/worldserver/start' && req.method === 'POST') return worldserverStart()
    if (url.pathname === '/worldserver/stop' && req.method === 'POST') return worldserverStop()
    if (url.pathname === '/worldserver/kill' && req.method === 'POST') return worldserverStop('SIGKILL')

    return json({ error: 'Not found' })
  },
}
