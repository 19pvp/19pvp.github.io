import { dirname, join } from '@std/path'
import { type DBCFieldType, type DBCSchema, decodeDBC, encodeDBC, mergeDBCRows } from './dbc.ts'
import type { StormArchiveModule } from 'stormlib'
import dbcSources from './dbc-sources.json' with { type: 'json' }

export type DBCEdit = {
  filename: string
  schema: DBCSchema
  rows: readonly Record<string, unknown>[]
}

export type PatchDefinition = {
  edits: DBCEdit[]
  files: string[]
}

export type PatchFile = {
  path: string
  bytes: Uint8Array
}

const sourceArchives = [
  'patch-enUS-3.MPQ',
  'patch-enUS-2.MPQ',
  'patch-enUS.MPQ',
  'locale-enUS.MPQ',
]
const sourceMap = dbcSources as Record<string, string>
const fieldTypes = new Set<DBCFieldType>(['byte', 'float', 'int', 'string', 'uint'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseDBCEditPayload(payload: unknown): DBCEdit[] {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.patches)
    ? payload.patches
    : isRecord(payload) && 'filename' in payload && 'schema' in payload && 'rows' in payload
    ? [payload]
    : null
  if (!items) throw new Error('patch response must be an array of DBC edits')

  return items.map((item, index) => {
    if (!isRecord(item) || typeof item.filename !== 'string' || !/^\w[\w.-]*\.dbc$/i.test(item.filename)) {
      throw new Error(`invalid DBC edit filename at index ${index}`)
    }
    if (!isRecord(item.schema) || !Array.isArray(item.rows)) {
      throw new Error(`invalid DBC edit at index ${index}`)
    }
    const schema: DBCSchema = {}
    for (const [name, type] of Object.entries(item.schema)) {
      if (typeof type !== 'string' || !fieldTypes.has(type as DBCFieldType)) {
        throw new Error(`invalid DBC field type for ${item.filename}: ${name}`)
      }
      schema[name] = type as DBCFieldType
    }
    const rows = item.rows.map((row, rowIndex) => {
      if (!isRecord(row)) throw new Error(`invalid DBC row ${rowIndex} in ${item.filename}`)
      return row
    })
    if (Object.keys(schema).length === 0) throw new Error(`empty DBC schema: ${item.filename}`)
    return { filename: item.filename, schema, rows }
  })
}

export function parsePatchDefinition(payload: unknown): PatchDefinition {
  const edits = isRecord(payload) && 'files' in payload && !('patches' in payload) ? [] : parseDBCEditPayload(payload)
  const files = isRecord(payload) && 'files' in payload ? payload.files : []
  if (!Array.isArray(files) || files.some((path) => !isPatchFilePath(path))) {
    throw new Error('patch files must be relative slash-separated paths')
  }
  return { edits, files }
}

function isPatchFilePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes('\\'))
}

async function readOriginalDBC(
  storm: StormArchiveModule,
  clientRoot: string,
  filename: string,
  report: (message: string) => void,
): Promise<Uint8Array> {
  let lastError: unknown
  const hintedSource = sourceMap[filename] ?? sourceMap[filename.toLowerCase()]
  const sourcePaths = hintedSource
    ? [hintedSource, ...sourceArchives.map((archiveName) => join('Data', 'enUS', archiveName))]
    : sourceArchives.map((archiveName) => join('Data', 'enUS', archiveName))
  const uniqueSourcePaths = [...new Set(sourcePaths)]
  for (const sourcePath of uniqueSourcePaths) {
    const started = performance.now()
    let archive
    try {
      archive = await storm.open(join(clientRoot, sourcePath))
      const file = archive.getFile(`DBFilesClient\\${filename}`)
      const bytes = new Uint8Array(file.size)
      if (file.read(bytes) !== bytes.byteLength) throw new Error(`could not read ${filename}`)
      report(`loaded ${sourcePath} for ${filename} in ${Math.round(performance.now() - started)}ms`)
      return bytes
    } catch (error) {
      lastError = error
      report(`could not load ${filename} from ${sourcePath} in ${Math.round(performance.now() - started)}ms`)
    } finally {
      await archive?.close()
    }
  }
  throw new Deno.errors.NotFound(`could not find DBFilesClient\\${filename}`, { cause: lastError })
}

export async function generatePatch(
  storm: StormArchiveModule,
  clientRoot: string,
  edits: readonly DBCEdit[],
  patchFiles: readonly PatchFile[],
  outputPath: string,
  report: (message: string) => void = () => {},
): Promise<void> {
  const files: { name: string; bytes: Uint8Array }[] = []
  for (const edit of edits) {
    report(`editing ${edit.filename}; ${edit.rows.length} row(s)`)
    const original = await readOriginalDBC(storm, clientRoot, edit.filename, report)
    const originalRows = decodeDBC(original, edit.schema)
    const rows = mergeDBCRows(edit.schema, originalRows, edit.rows)
    files.push({
      name: `DBFilesClient\\${edit.filename}`,
      bytes: encodeDBC(edit.schema, rows),
    })
  }
  for (const file of patchFiles) files.push({ name: file.path.replaceAll('/', '\\'), bytes: file.bytes })

  const archiveStarted = performance.now()
  const archive = storm.createArchive()
  let closed = false
  try {
    for (const file of files) {
      archive.addFile(file.bytes, file.name)
    }
    const bytes = archive.close()
    closed = true
    if (!bytes) throw new Error('StormLib did not return the generated patch')
    report(`patch archive created in ${Math.round(performance.now() - archiveStarted)}ms`)
    const writeStarted = performance.now()
    await Deno.mkdir(dirname(outputPath), { recursive: true })
    await Deno.writeFile(outputPath, bytes)
    report(`patch file written in ${Math.round(performance.now() - writeStarted)}ms`)
  } catch (error) {
    if (!closed) {
      try {
        archive.close()
      } catch {
        // Preserve the original generation error.
      }
    }
    throw error
  }
}
