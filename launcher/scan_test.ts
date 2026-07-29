import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { findMatchingTorrentFiles } from './scan.ts'

Deno.test('matches existing files using torrent paths and sizes', async () => {
  const root = await Deno.makeTempDir()
  await Deno.mkdir(join(root, 'Data', 'enUS'), { recursive: true })
  await Deno.writeFile(join(root, 'Wow.exe'), new Uint8Array(3))
  await Deno.writeFile(
    join(root, 'Data', 'enUS', 'patch-enUS-3.MPQ'),
    new Uint8Array(4),
  )

  const files = [
    { path: 'World of Warcraft 3.3.5a/Wow.exe', length: 3 },
    { path: 'World of Warcraft 3.3.5a/Data/enUS/patch-enUS-3.MPQ', length: 4 },
    { path: 'World of Warcraft 3.3.5a/Data/common.MPQ', length: 10 },
  ]
  assertEquals(
    (await findMatchingTorrentFiles(root, files)).map(({ path }) => path),
    [files[1].path],
  )
  assertEquals(
    await findMatchingTorrentFiles(root, files.map((file) => ({ ...file, length: file.length + 1 }))),
    [],
  )
})
