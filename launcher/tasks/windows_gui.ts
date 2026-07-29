const path = Deno.args[0]
if (!path) throw new Error('missing exe path')

const exe = await Deno.readFile(path)
const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength)

if (view.getUint16(0, true) !== 0x5a4d) throw new Error('not a Windows executable')

const pe = view.getUint32(0x3c, true)
if (view.getUint32(pe, true) !== 0x0000_4550) throw new Error('missing PE header')

const optionalHeader = pe + 24
const magic = view.getUint16(optionalHeader, true)
if (magic !== 0x10b && magic !== 0x20b) throw new Error('unsupported PE optional header')

const subsystem = optionalHeader + 0x44
view.setUint16(subsystem, 3, true)

await Deno.writeFile(path, exe)
console.log(`patched Windows subsystem: ${path}`)
