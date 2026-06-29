export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const encoder = new TextEncoder()

export const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')

export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, {
    ...init,
    headers: { ...cors, ...init?.headers },
  })

export const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

export const isAbsolutePath = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

export const projectPath = (path: string) => isAbsolutePath(path) ? path : `${import.meta.dirname}/../${path}`

export const normalizePath = (path: string) => path.replaceAll('\\', '/')

export const parentDir = (path: string) => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '.' : path.slice(0, index)
}
