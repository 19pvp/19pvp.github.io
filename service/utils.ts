export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type,last-event-id',
}

const encoder = new TextEncoder()

export const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')

export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, {
    ...init,
    headers: { ...cors, ...init?.headers },
  })

export const sse = (data: unknown, id?: string | number) =>
  encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`)

export const isAbsolutePath = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

export const projectPath = (path: string) => isAbsolutePath(path) ? path : `${import.meta.dirname}/../${path}`

export const normalizePath = (path: string) => path.replaceAll('\\', '/')

export const parentDir = (path: string) => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '.' : path.slice(0, index)
}

export const runCommand = async (
  command: string,
  args: string[],
  options: Omit<Deno.CommandOptions, 'args'> & { okCodes?: number[] } = {},
) => {
  const { okCodes = [0], ...commandOptions } = options
  const result = await new Deno.Command(command, {
    ...commandOptions,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  const stdout = new TextDecoder().decode(result.stdout).trim()
  const stderr = new TextDecoder().decode(result.stderr).trim()
  if (!okCodes.includes(result.code)) {
    throw Error(`${command} ${args.join(' ')} failed${stderr || stdout ? `: ${stderr || stdout}` : ''}`)
  }
  return stdout
}
