import { applySqlFile } from './sql_utils.ts'

const dry = Deno.args.includes('--dry')
const force = Deno.args.includes('--force')
const requestedFiles = Deno.args.filter((arg) => !arg.startsWith('--'))
const generatedSqlDir = 'sql'
const hashPrefix = 'generated-sql:sha1:'
const worldDb = Deno.env.get('WORLD_DB') || '19pvp_world'
if (!/^[a-zA-Z0-9_]+$/.test(worldDb)) throw Error(`invalid WORLD_DB ${worldDb}`)

const sha1 = async (text: string) => {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const managedSqlFiles = async () => {
  const files: string[] = []
  for await (const entry of Deno.readDir(generatedSqlDir)) {
    if (
      entry.isFile &&
      entry.name.endsWith('.sql') &&
      (entry.name.startsWith('generated-') || entry.name === 'starting-info.sql' ||
        entry.name === 'random-enchant-npc.sql')
    ) {
      files.push(`${generatedSqlDir}/${entry.name}`)
    }
  }
  return files.sort()
}

const normalizeRequestedFile = (file: string) => {
  if (file.includes('/')) return file
  return `${generatedSqlDir}/${file}`
}

const selectedSqlFiles = async () => {
  if (requestedFiles.length) return requestedFiles.map(normalizeRequestedFile).sort()
  return await managedSqlFiles()
}

const storageKey = (file: string) => `${hashPrefix}${file}`

let checked = 0
let skipped = 0
let ran = 0

for (const file of await selectedSqlFiles()) {
  checked++
  const text = await Deno.readTextFile(file)
  const hash = await sha1(text)
  const previousHash = localStorage.getItem(storageKey(file))

  if (!force && previousHash === hash) {
    skipped++
    console.log(`skipped ${file}; unchanged`)
    continue
  }

  const statements = await applySqlFile(file, !dry, { database: worldDb })
  if (!dry) localStorage.setItem(storageKey(file), hash)
  ran++
  console.log(`${dry ? 'validated' : 'executed'} ${statements} SQL statement(s) from ${file}`)
}

console.log(`${dry ? 'validated' : 'applied'} ${ran}/${checked} managed SQL file(s); skipped ${skipped}`)
