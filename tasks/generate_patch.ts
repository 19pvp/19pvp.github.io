import { loadStormLib, ArchiveFlags, Compression } from '../launcher/stormlib.ts'
import { parsePatchDefinition, generatePatch, type DBCEdit } from '../launcher/patch.ts'
import launcherPatch from '../launcher/patch.json' with { type: 'json' }
import { env } from '../service/env.ts'

const outputPath = `${import.meta.dirname}/../patch-files/patch-S.mpq`

console.log('Loading StormLib...')
const storm = await loadStormLib()

let clientDir = env.CLIENT_DIR
try {
  await Deno.stat(clientDir)
} catch {
  clientDir = `${import.meta.dirname}/../launcher/client`
}

console.log(`Using client directory: ${clientDir}`)
const patchDef = parsePatchDefinition(launcherPatch)

console.log(`Generating MPQ patch-S.mpq at ${outputPath}...`)
const archive = storm.createArchive()

for (const edit of patchDef.edits) {
  console.log(`Processing edit: ${edit.filename}`)
}

// Write compressed MPQ file using ZLIB compression
await generatePatch(
  storm,
  clientDir,
  patchDef.edits,
  [],
  outputPath,
  (msg) => console.log(`[Patch] ${msg}`),
)

console.log(`Successfully generated compressed patch-S.mpq at ${outputPath}!`)
