import { assertEquals, assertThrows } from '@std/assert'
import { loadStormLib } from 'stormlib'
import { type DBCSchema, decodeDBC, encodeDBC } from './dbc.ts'
import { generatePatch, parsePatchDefinition } from './patch.ts'

Deno.test('generates an MPQ containing merged DBC edits', async () => {
  const schema: DBCSchema = { ID: 'int', Name: 'string', Amount: 'uint' }
  const originalRows = [
    { ID: 1, Name: 'one', Amount: 10 },
    { ID: 2, Name: 'two', Amount: 20 },
  ]
  const root = await Deno.makeTempDir({ prefix: '19pvp-patch-test-' })
  const sourcePath = `${root}/Data/enUS/patch-enUS-3.MPQ`
  const outputPath = `${root}/Data/patch-S.mpq`

  try {
    await Deno.mkdir(`${root}/Data/enUS`, { recursive: true })
    const storm = await loadStormLib()
    const source = storm.createArchive()
    source.addFile(encodeDBC(schema, originalRows), 'DBFilesClient\\Test.dbc')
    await Deno.writeFile(sourcePath, source.close()!)

    await generatePatch(storm, root, [{
      filename: 'Test.dbc',
      schema,
      rows: [{ ID: 1, Amount: 99 }, { ID: 2, Name: 'updated' }],
    }], [{
      path: 'Interface/GlueXML/GlueStrings.lua',
      bytes: new TextEncoder().encode('ABILITY_INFO_SCOURGE1 = "updated"'),
    }], outputPath)

    const patch = await storm.open(outputPath)
    const file = patch.getFile('DBFilesClient\\Test.dbc')
    const bytes = new Uint8Array(file.size)
    assertEquals(file.read(bytes), bytes.byteLength)
    assertEquals(decodeDBC(bytes, schema), [
      { ID: 1, Name: 'one', Amount: 99 },
      { ID: 2, Name: 'updated', Amount: 20 },
    ])
    const glueFile = patch.getFile('Interface\\GlueXML\\GlueStrings.lua')
    const glueBytes = new Uint8Array(glueFile.size)
    glueFile.read(glueBytes)
    assertEquals(new TextDecoder().decode(glueBytes), 'ABILITY_INFO_SCOURGE1 = "updated"')
    await patch.close()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('parses patch file paths', () => {
  assertEquals(parsePatchDefinition({ patches: [], files: ['Interface/GlueXML/GlueStrings.lua'] }), {
    edits: [],
    files: ['Interface/GlueXML/GlueStrings.lua'],
  })
  assertThrows(() => parsePatchDefinition({ patches: [], files: ['../GlueStrings.lua'] }))
  assertEquals(parsePatchDefinition({ files: ['Interface/GlueXML/GlueStrings.lua'] }), {
    edits: [],
    files: ['Interface/GlueXML/GlueStrings.lua'],
  })
})
