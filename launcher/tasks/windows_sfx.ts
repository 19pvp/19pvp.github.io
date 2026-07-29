import { basename, dirname, join } from '@std/path'

const payloadPath = Deno.args[0]
const outputPath = Deno.args[1]
if (!payloadPath || !outputPath) throw new Error('usage: windows_sfx.ts <payload> <output>')

const archiveDirectory = await Deno.makeTempDir({ prefix: '19pvp-launcher-sfx-' })
const archivePath = join(archiveDirectory, 'payload.7z')
const payloadName = basename(payloadPath)
const result = await new Deno.Command('7z', {
  args: ['a', '-t7z', '-mx=9', archivePath, payloadName],
  cwd: dirname(payloadPath),
  stdout: 'inherit',
  stderr: 'inherit',
}).output()
if (!result.success) throw new Error('7z compression failed')

const sfx = await Deno.readFile('tools/7zS.sfx')
const config = new TextEncoder().encode(
  `;!@Install@!UTF-8!\nRunProgram="${payloadName}"\n;!@InstallEnd@!\n`,
)
const archive = await Deno.readFile(archivePath)
const output = new Uint8Array(sfx.byteLength + config.byteLength + archive.byteLength)
output.set(sfx)
output.set(config, sfx.byteLength)
output.set(archive, sfx.byteLength + config.byteLength)

for (
  const [from, to] of [
    ['7z Setup SFX', '19PvP Client'],
    ['7-Zip', '19PvP'],
    ['7zS.sfx.exe', '19PvP.exe'],
    ['7zS.sfx', '19PvP'],
  ]
) {
  const source = new Uint8Array(from.length * 2)
  for (let i = 0; i < from.length; i++) source[i * 2] = from.charCodeAt(i)
  for (let i = 0; i <= output.length - source.length; i++) {
    if (!source.every((byte, index) => output[i + index] === byte || (index & 1))) continue
    for (let j = 0; j < to.length; j++) output[i + j * 2] = to.charCodeAt(j)
    for (let j = to.length; j < from.length; j++) output[i + j * 2] = 0
  }
}

await Deno.writeFile(outputPath, output)
await Deno.remove(archiveDirectory, { recursive: true })
await Deno.remove(payloadPath)
console.log(`created compressed Windows launcher: ${outputPath}`)
