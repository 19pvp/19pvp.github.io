import { env } from '../service/env.ts'
import { runCommand } from '../service/utils.ts'

export const applyPatches = async () => {
  const corePath = env.CORE_PATH
  const patchesDir = './patches'

  try {
    await Deno.stat(patchesDir)
  } catch {
    return // No patches directory
  }

  console.log('Checking for patches to apply...')
  try {
    for await (const entry of Deno.readDir(patchesDir)) {
      if (entry.isFile && entry.name.endsWith('.patch')) {
        const patchPath = `${patchesDir}/${entry.name}`
        let targetDir = corePath
        if (entry.name.startsWith('mod-')) {
          const moduleName = entry.name.replace('.patch', '')
          targetDir = `${corePath}/modules/${moduleName}`
        }

        console.log(`Applying patch ${entry.name} to ${targetDir}...`)
        try {
          await runCommand('git', ['-C', targetDir, 'reset', '--hard', 'HEAD'])
          await runCommand('git', ['-C', targetDir, 'clean', '-fd'])
          await runCommand('git', ['-C', targetDir, 'apply', '--ignore-whitespace', Deno.realPathSync(patchPath)])
          console.log(`Successfully applied patch ${entry.name}`)
        } catch (err) {
          console.warn(`Could not apply patch ${entry.name} (it might already be applied):`, String(err))
        }
      }
    }
  } catch (err) {
    console.error('Failed to read patches directory', err)
  }
}

if (import.meta.main) {
  await applyPatches()
}
