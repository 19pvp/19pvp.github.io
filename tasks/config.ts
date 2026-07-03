import { parse, stringify } from '@std/yaml'
import { bin, etc, type TargetName, targets } from '../env.ts'
import { runCommand } from '../service/utils.ts'

const names = Object.keys(targets) as TargetName[]
const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')
const databaseName = (info: unknown) => {
  const parts = unquote(info).split(';')
  const name = parts[4]
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) throw Error(`Invalid database info: ${String(info)}`)
  return name
}

const target = (name?: string) => {
  if (name && name in targets) return targets[name as TargetName]
  throw Error(`Expected target: ${names.join('|')}`)
}

const fetchText = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return res.text()
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
  await Deno.mkdir('config', { recursive: true })
  await Deno.writeTextFile(`config/${name}.json`, `${JSON.stringify(defaults(conf), null, 2)}\n`)
  console.log(`Wrote ${name}`)
}

const writeConf = async (name: TargetName) => {
  const t = targets[name]
  const conf = Object.entries(t.config).map(([key, value]) => `${key} = ${String(value)}\n`).join('')
  const output = etc(t.url.split('/').at(-1)!.replace('.conf.dist', '.conf'))
  await Deno.writeTextFile(output, conf)
  console.log(`Wrote ${output}`)
}

export const installLuaScripts = async () => {
  const output = bin('lua_scripts')
  for await (const entry of Deno.readDir(output)) {
    if (entry.isFile && (entry.name.endsWith('.lua') || entry.name.endsWith('.sql'))) {
      await Deno.remove(`${output}/${entry.name}`)
    }
  }

  for await (const entry of Deno.readDir('core_scripts')) {
    if (!entry.isFile) continue
    if (!entry.name.endsWith('.lua') && !entry.name.endsWith('.sql')) continue
    await Deno.copyFile(`core_scripts/${entry.name}`, `${output}/${entry.name}`)
  }

  console.log(`Installed Lua scripts to ${output}`)
}

export const installConf = async () => {
  for (const name of names) {
    await writeConf(name)
  }
  await installLuaScripts()
}

const installWorldserverService = async () => {
  // TODO: derive name from repository name
  const serviceName = Deno.env.get('WORLDSERVER_SERVICE_NAME') || '19pvp-worldserver'
  const unitPath = `/etc/systemd/system/${serviceName}.service`
  const unit = `[Unit]
Description=19 PvP worldserver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${await Deno.realPath(bin(''))}
ExecStart=${await Deno.realPath(bin('worldserver'))}
StandardInput=null
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`

  await Deno.writeTextFile(unitPath, unit)
  await runCommand('systemctl', ['daemon-reload'])
  await runCommand('systemctl', ['enable', serviceName])
  await runCommand('systemctl', ['start', serviceName])
  console.log(`Installed ${unitPath}`)
}

const ensureDefaultGuild = async () => {
  if (!Deno.env.get('PASSWORD')) {
    console.log('PASSWORD missing; skipped default guild install')
    return
  }

  const { sqlRaw } = await import('../service/db.ts')
  const db = databaseName(targets.worldserver.config.CharacterDatabaseInfo)
  const guildName = Deno.env.get('DEFAULT_GUILD_NAME') || '19 PvP'
  const [existing] = await sqlRaw(`SELECT COUNT(*) AS count FROM ${db}.guild`)
  if (Number(existing.count)) {
    console.log('Guild table is not empty; skipped default guild install')
    return
  }

  const [leader] = await sqlRaw(`SELECT guid FROM ${db}.characters ORDER BY guid LIMIT 1`)
  const leaderGuid = Number(leader?.guid)
  if (!leaderGuid) {
    console.log('No characters found; skipped default guild install')
    return
  }

  const guildId = 1
  await sqlRaw('START TRANSACTION')
  try {
    await sqlRaw(
      `
    INSERT INTO ${db}.guild
      (guildid, name, leaderguid, EmblemStyle, EmblemColor, BorderStyle, BorderColor, BackgroundColor, info, motd, createdate, BankMoney)
    VALUES
      (?, ?, ?, 0, 0, 0, 0, 0, '', '', UNIX_TIMESTAMP(), 0)
  `,
      [guildId, guildName, leaderGuid],
    )

    await sqlRaw(
      `
    INSERT INTO ${db}.guild_rank
      (guildid, rid, rname, rights, BankMoneyPerDay)
    VALUES
      (?, 0, 'Guild Master', 8358321, 0),
      (?, 1, 'Officer', 1041904, 0),
      (?, 2, 'Veteran', 1041904, 0),
      (?, 3, 'Member', 1041904, 0),
      (?, 4, 'Initiate', 1041904, 0)
  `,
      [guildId, guildId, guildId, guildId, guildId],
    )

    await sqlRaw(
      `
    INSERT INTO ${db}.guild_member
      (guildid, guid, rank, pnote, offnote)
    VALUES
      (?, ?, 0, '', '')
  `,
      [guildId, leaderGuid],
    )
    await sqlRaw('COMMIT')
  } catch (err) {
    await sqlRaw('ROLLBACK').catch(() => {})
    throw err
  }

  console.log(`Created default guild "${guildName}" with leader ${leaderGuid}`)
}

const updatePages = async () => {
  const page = parse(await Deno.readTextFile('.pages.yml')) as { content?: Array<Record<string, unknown>> }
  page.content ||= []

  for (const name of names) {
    const t = targets[name]
    const path = `config/${name}.json`
    let item = page.content.find((entry) => entry.name === name || entry.path === path)
    if (!item) page.content.push(item = {})
    Object.assign(item, {
      name,
      label: t.label,
      type: 'file',
      path,
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
  if (!Deno.env.get('PASSWORD')) throw Error('PASSWORD is required for SOAP reloads')
  const { ac } = await import('../service/soap.ts')
  const result = await ac`${targets[name].reload}`
  if (!('success' in result)) throw Error(`${name} reload failed: ${JSON.stringify(result)}`)
  console.log(`${name} reloaded with .${targets[name].reload}`)
}

const changed = new Set<TargetName>()
let luaScriptsChanged = false
const processChanged = async () => {
  for (const name of [...changed]) {
    changed.delete(name)
    const t = targets[name]
    const conf = etc(t.url.split('/').at(-1)!.replace('.conf.dist', '.conf'))
    const previous = await readIfExists(conf)

    await writeConf(name)
    if (await readIfExists(conf) !== previous) {
      try {
        await reload(name)
      } catch (err) {
        console.warn('unable to reload', name, err)
      }
    } else {
      console.log(`${name} unchanged`)
    }
  }

  if (luaScriptsChanged) {
    luaScriptsChanged = false
    await installLuaScripts()
    try {
      await reload('ale')
    } catch (err) {
      console.warn('unable to reload ale', err)
    }
  }
}

export const watch = async () => {
  await installConf()
  let timer: ReturnType<typeof setTimeout> | undefined
  const files = names.map((name) => `config/${name}.json`)
  const luaScriptsPath = 'core_scripts'
  console.log(`Watching ${[...files, luaScriptsPath].join(', ')}`)
  for await (const event of Deno.watchFs([...files, luaScriptsPath])) {
    for (const path of event.paths) {
      const name = names.find((n) => path.endsWith(`config/${n}.json`))
      if (name) {
        changed.add(name)
      } else if (path.endsWith('.lua') && path.includes(luaScriptsPath)) {
        luaScriptsChanged = true
      } else {
        continue
      }

      timer && clearTimeout(timer)
      timer = setTimeout(processChanged, 250)
    }
  }
}

if (import.meta.main) {
  const [command, targetArg] = Deno.args
  if (command === 'json') {
    await writeJson(targetArg as TargetName)
  } else if (command === 'fields') {
    console.log(stringify(fields(parseConf(await fetchText(target(targetArg).url)))))
  } else if (command === 'pages') {
    await updatePages()
  } else if (command === 'conf') {
    await writeConf(targetArg as TargetName)
  } else if (command === 'lua') {
    await installLuaScripts()
  } else if (command === 'install') {
    await installConf()
    await installWorldserverService()
    await ensureDefaultGuild()
  } else if (command === 'watch') {
    await watch()
  } else {
    throw Error(
      'Usage: deno run --allow-net --allow-read --allow-write --allow-env tasks/config.ts json|fields|pages|conf|lua|install|watch [target] [output]',
    )
  }
}
