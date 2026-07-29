import { assertEquals } from '@std/assert'
import { type DBCSchema, decodeDBC, encodeDBC, mergeDBCRows } from './dbc.ts'

const schema: DBCSchema = {
  ID: 'int',
  Name: 'string',
  Amount: 'uint',
  Ratio: 'float',
  Flag: 'byte',
}

Deno.test('merges sparse DBC rows and preserves untouched values', () => {
  const original = [
    { ID: 1, Name: 'one', Amount: 10, Ratio: 1.25, Flag: 1 },
    { ID: 2, Name: 'two', Amount: 20, Ratio: 2.5, Flag: -1 },
  ]
  const bytes = encodeDBC(schema, original)
  const decoded = decodeDBC(bytes, schema)
  assertEquals(decoded, original)

  const merged = mergeDBCRows(schema, decoded, [
    { ID: 1, Amount: 99 },
    { ID: 2, Name: 'updated', Ratio: 3.5 },
    { ID: 3, Name: 'new', Amount: 7, Ratio: 0.5, Flag: 0 },
  ])
  assertEquals(merged, [
    { ID: 1, Name: 'one', Amount: 99, Ratio: 1.25, Flag: 1 },
    { ID: 2, Name: 'updated', Amount: 20, Ratio: 3.5, Flag: -1 },
    { ID: 3, Name: 'new', Amount: 7, Ratio: 0.5, Flag: 0 },
  ])
})
