import { parse, stringify } from 'jsr:@std/yaml'

const targets = {
  ale: {
    conf: 'mod_ale.conf',
    json: 'ale.json',
    label: 'ALE Config',
    reload: 'reload ale',
    url: 'https://raw.githubusercontent.com/azerothcore/mod-ale/refs/heads/master/conf/mod_ale.conf.dist',
  },
  playerbots: {
    conf: 'playerbots.conf',
    json: 'playerbots.json',
    label: 'Playerbots Config',
    reload: 'reload config',
    url: 'https://raw.githubusercontent.com/mod-playerbots/mod-playerbots/refs/heads/master/conf/playerbots.conf.dist',
  },
  worldserver: {
    conf: 'worldserver.conf',
    json: 'worldserver.json',
    label: 'WorldServer Config',
    reload: 'reload config',
    url:
      'https://raw.githubusercontent.com/mod-playerbots/azerothcore-wotlk/refs/heads/Playerbot/src/server/apps/worldserver/worldserver.conf.dist',
  },
} as const

type TargetName = keyof typeof targets

const names = Object.keys(targets) as TargetName[]
const [command, targetArg, outputArg] = Deno.args

const target = (name = targetArg) => {
  if (name && name in targets) return targets[name as TargetName]
  throw new Error(`Expected target: ${names.join('|')}`)
}

const fetchText = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return await res.text()
}

const typeOfLine = (line: string) => {
  if (line[0] !== '#' && line[0] !== '[') return 'property'
  if (/# \S/.test(line)) return 'category'
  if (/# {4}\S/.test(line)) return 'key'
  if (/# {5,}\S/.test(line)) return 'message'
  return ''
}

const parseConf = (text: string) => {
  const conf: Record<string, { key: string; value: string; cat?: string; description?: string }> = {}
  let prev = ''
  let cat = ''
  let descriptions: Array<{ key?: string; msg?: string }> = []
  let desc: { key?: string; msg?: string } = {}

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const type = typeOfLine(line)
    if (!type || !line) continue

    if (type !== 'message' && prev === 'message') {
      descriptions.push(desc)
      desc = {}
    }

    if (type === 'property') {
      const [key, ...valueParts] = line.split('=')
      const name = key.trim()
      const match = descriptions.find((item) => item.key === name.toLowerCase())
      conf[name] = { key: name, value: valueParts.join('=').trim(), cat, description: match?.msg }
    } else if (type === 'category') {
      cat = line.slice(1).split(/ +#$/)[0].trim()
      descriptions = []
    } else if (type === 'key') {
      desc.key = line.slice(5).split(' ')[0].toLowerCase()
    } else if (type === 'message') {
      desc.msg = desc.msg ? `${desc.msg}\n${line.slice(9)}` : line.slice(9)
    }

    prev = type
  }

  return conf
}

const label = (key: string) =>
  key
    .replaceAll('.', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const fields = (conf: ReturnType<typeof parseConf>) =>
  Object.values(conf).map((item) => ({
    name: item.key,
    label: label(item.key),
    type: 'string',
    ...(item.description || item.cat ? { description: item.description || item.cat } : {}),
    default: item.value,
  }))

const defaults = (conf: ReturnType<typeof parseConf>) =>
  Object.fromEntries(Object.values(conf).map((item) => [item.key, item.value]))

const writeJson = async (name: TargetName) => {
  const t = targets[name]
  const conf = parseConf(await fetchText(t.url))
  await Deno.writeTextFile(t.json, `${JSON.stringify(defaults(conf), null, 2)}\n`)
  console.log(`Wrote ${t.json}`)
}

const writeConf = async (name: TargetName, output: string = targets[name].conf) => {
  const values = JSON.parse(await Deno.readTextFile(targets[name].json)) as Record<string, unknown>
  const conf = Object.entries(values).map(([key, value]) => `${key} = ${String(value)}`).join('\n') + '\n'
  await Deno.writeTextFile(output, conf)
  console.log(`Wrote ${output}`)
}

const updatePages = async () => {
  const page = parse(await Deno.readTextFile('.pages.yml')) as { content?: Array<Record<string, unknown>> }
  page.content ||= []

  for (const name of names) {
    const t = targets[name]
    let item = page.content.find((entry) => entry.name === name || entry.path === t.json)
    if (!item) page.content.push(item = {})

    Object.assign(item, {
      name,
      label: t.label,
      type: 'file',
      path: t.json,
      fields: fields(parseConf(await fetchText(t.url))),
    })
    console.log(`Updated ${name} fields`)
  }

  await Deno.writeTextFile('.pages.yml', stringify(page))
}

const readIfExists = async (path: string) => {
  try {
    return await Deno.readTextFile(path)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return ''
    throw err
  }
}

const reload = async (name: TargetName) => {
  if (!Deno.env.get('PASSWORD')) throw new Error('PASSWORD is required for SOAP reloads')
  const { ac } = await import('../service/soap.js')
  const result = await ac`${targets[name].reload}`
  if (!('success' in result)) throw new Error(`${name} reload failed: ${JSON.stringify(result)}`)
  console.log(`${name} reloaded with .${targets[name].reload}`)
}

const processChanged = async (changed: Set<TargetName>) => {
  for (const name of [...changed]) {
    changed.delete(name)
    const t = targets[name]
    const previous = await readIfExists(t.conf)

    if (!await readIfExists(t.json)) {
      console.log(`${t.json} missing; skipped`)
      continue
    }

    await writeConf(name)

    if (await readIfExists(t.conf) !== previous) {
      await reload(name)
    } else {
      console.log(`${t.conf} unchanged`)
    }
  }
}

const watch = async () => {
  const changed = new Set<TargetName>()
  let timer: ReturnType<typeof setTimeout> | undefined
  console.log(`Watching ${names.map((name) => targets[name].json).join(', ')}`)

  for await (const event of Deno.watchFs(names.map((name) => targets[name].json))) {
    for (const path of event.paths) {
      const name = names.find((entry) => path.endsWith(targets[entry].json))
      if (!name) continue

      changed.add(name)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => processChanged(changed), 250)
    }
  }
}

if (command === 'json') {
  await writeJson(targetArg as TargetName)
} else if (command === 'fields') {
  console.log(stringify(fields(parseConf(await fetchText(target().url)))))
} else if (command === 'pages') {
  await updatePages()
} else if (command === 'conf') {
  await writeConf(targetArg as TargetName, outputArg)
} else if (command === 'watch') {
  await watch()
} else {
  throw new Error(
    'Usage: deno run --allow-net --allow-read --allow-write --allow-env tasks/config.ts json|fields|pages|conf|watch [target] [output]',
  )
}
