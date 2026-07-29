export type DBCFieldType = 'byte' | 'float' | 'int' | 'string' | 'uint'
export type DBCSchema = Record<string, DBCFieldType>
export type DBCValue = number | string
export type DBCRow = Record<string, DBCValue>

const MAGIC_NUMBER = 0x43424457 // WDBC
const HEADER_SIZE = 20
const fieldTypes = new Set<DBCFieldType>(['byte', 'float', 'int', 'string', 'uint'])

const fieldSize = (type: DBCFieldType): number => type === 'byte' ? 1 : 4

const schemaEntries = (schema: DBCSchema) => {
  const entries = Object.entries(schema)
  if (entries.length === 0) throw new Error('DBC schema is empty')
  for (const [name, type] of entries) {
    if (!name || !fieldTypes.has(type)) throw new Error(`invalid DBC field: ${name}`)
  }
  return entries
}

const rowSize = (schema: DBCSchema): number =>
  schemaEntries(schema).reduce((size, [, type]) => size + fieldSize(type), 0)

const viewFor = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export function decodeDBC(bytes: Uint8Array, schema: DBCSchema): DBCRow[] {
  const entries = schemaEntries(schema)
  const view = viewFor(bytes)
  if (bytes.byteLength < HEADER_SIZE || view.getUint32(0, true) !== MAGIC_NUMBER) {
    throw new Error('invalid DBC signature')
  }

  const rowCount = view.getUint32(4, true)
  const fieldCount = view.getUint32(8, true)
  const recordSize = view.getUint32(12, true)
  const stringSize = view.getUint32(16, true)
  const expectedRecordSize = rowSize(schema)
  if (fieldCount !== entries.length || recordSize !== expectedRecordSize) {
    throw new Error('DBC schema does not match the original file')
  }

  const recordsEnd = HEADER_SIZE + rowCount * recordSize
  const stringsEnd = recordsEnd + stringSize
  if (stringsEnd > bytes.byteLength) throw new Error('truncated DBC file')
  const strings = bytes.subarray(recordsEnd, stringsEnd)
  const decoder = new TextDecoder()
  const rows: DBCRow[] = []

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row: DBCRow = {}
    let cursor = HEADER_SIZE + rowIndex * recordSize
    for (const [name, type] of entries) {
      switch (type) {
        case 'byte':
          row[name] = view.getInt8(cursor)
          cursor += 1
          break
        case 'float':
          row[name] = view.getFloat32(cursor, true)
          cursor += 4
          break
        case 'int':
          row[name] = view.getInt32(cursor, true)
          cursor += 4
          break
        case 'uint':
          row[name] = view.getUint32(cursor, true)
          cursor += 4
          break
        case 'string': {
          const offset = view.getUint32(cursor, true)
          if (offset >= strings.byteLength) throw new Error('invalid DBC string offset')
          const end = strings.indexOf(0, offset)
          if (end === -1) throw new Error('unterminated DBC string')
          row[name] = decoder.decode(strings.subarray(offset, end))
          cursor += 4
          break
        }
      }
    }
    rows.push(row)
  }
  return rows
}

const defaultValue = (type: DBCFieldType): DBCValue => type === 'string' ? '' : 0

export function mergeDBCRows(
  schema: DBCSchema,
  originalRows: DBCRow[],
  updates: readonly Record<string, unknown>[],
): DBCRow[] {
  const entries = schemaEntries(schema)
  const idField = entries[0][0]
  const rows = originalRows.map((row) => ({ ...row }))
  const byId = new Map<DBCValue, number>()
  for (const [index, row] of rows.entries()) {
    const id = row[idField]
    if (id === undefined) throw new Error(`original DBC row is missing ${idField}`)
    if (byId.has(id)) throw new Error(`duplicate DBC row ID: ${id}`)
    byId.set(id, index)
  }

  for (const update of updates) {
    const changes: DBCRow = {}
    for (const [name, value] of Object.entries(update)) {
      if (!(name in schema)) throw new Error(`unknown DBC field: ${name}`)
      if (value === null || value === undefined) continue
      changes[name] = value as DBCValue
    }
    const id = changes[idField]
    if (id === undefined) throw new Error(`DBC update is missing ${idField}`)

    const existingIndex = byId.get(id)
    if (existingIndex === undefined) {
      const row = Object.fromEntries(entries.map(([name, type]) => [name, defaultValue(type)])) as DBCRow
      Object.assign(row, changes)
      byId.set(id, rows.length)
      rows.push(row)
    } else {
      Object.assign(rows[existingIndex], changes)
    }
  }
  return rows
}

const numberValue = (row: DBCRow, name: string, type: DBCFieldType): number => {
  const value = row[name]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`DBC field ${name} must be a finite number`)
  }
  if (type !== 'float' && !Number.isInteger(value)) {
    throw new Error(`DBC field ${name} must be an integer`)
  }
  if (type === 'byte' && (value < -128 || value > 127)) {
    throw new Error(`DBC byte field ${name} is out of range`)
  }
  if (type === 'int' && (value < -0x8000_0000 || value > 0x7fff_ffff)) {
    throw new Error(`DBC int field ${name} is out of range`)
  }
  if (type === 'uint' && (value < 0 || value > 0xffff_ffff)) {
    throw new Error(`DBC uint field ${name} is out of range`)
  }
  return value
}

export function encodeDBC(schema: DBCSchema, rows: readonly DBCRow[]): Uint8Array {
  const entries = schemaEntries(schema)
  const recordSize = rowSize(schema)
  const encoder = new TextEncoder()
  const stringOffsets = new Map<string, number>([['', 0]])
  const stringChunks: Uint8Array[] = [new Uint8Array([0])]
  let stringSize = 1

  const stringOffset = (value: string): number => {
    const existing = stringOffsets.get(value)
    if (existing !== undefined) return existing
    const encoded = encoder.encode(value)
    const offset = stringSize
    stringOffsets.set(value, offset)
    stringChunks.push(encoded, new Uint8Array([0]))
    stringSize += encoded.byteLength + 1
    return offset
  }

  const records = new Uint8Array(rows.length * recordSize)
  const view = viewFor(records)
  for (const [rowIndex, row] of rows.entries()) {
    let cursor = rowIndex * recordSize
    for (const [name, type] of entries) {
      const value = row[name]
      switch (type) {
        case 'byte':
          view.setInt8(cursor, numberValue(row, name, type))
          cursor += 1
          break
        case 'float':
          view.setFloat32(cursor, numberValue(row, name, type), true)
          cursor += 4
          break
        case 'int':
          view.setInt32(cursor, numberValue(row, name, type), true)
          cursor += 4
          break
        case 'uint':
          view.setUint32(cursor, numberValue(row, name, type), true)
          cursor += 4
          break
        case 'string':
          if (typeof value !== 'string') throw new Error(`DBC field ${name} must be a string`)
          view.setUint32(cursor, stringOffset(value), true)
          cursor += 4
          break
      }
    }
  }

  const strings = new Uint8Array(stringSize)
  let stringCursor = 0
  for (const chunk of stringChunks) {
    strings.set(chunk, stringCursor)
    stringCursor += chunk.byteLength
  }

  const output = new Uint8Array(HEADER_SIZE + records.byteLength + strings.byteLength)
  const header = viewFor(output)
  header.setUint32(0, MAGIC_NUMBER, true)
  header.setUint32(4, rows.length, true)
  header.setUint32(8, entries.length, true)
  header.setUint32(12, recordSize, true)
  header.setUint32(16, strings.byteLength, true)
  output.set(records, HEADER_SIZE)
  output.set(strings, HEADER_SIZE + records.byteLength)
  return output
}
