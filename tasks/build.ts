const sourceDir = 'web'
const outputDir = 'dist'

const copyDir = async (source: string, output: string) => {
  await Deno.mkdir(output, { recursive: true })

  for await (const entry of Deno.readDir(source)) {
    const sourcePath = `${source}/${entry.name}`
    const outputPath = `${output}/${entry.name}`

    if (entry.isDirectory) {
      await copyDir(sourcePath, outputPath)
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, outputPath)
    }
  }
}

await Deno.remove(outputDir, { recursive: true }).catch((err) => {
  if (!(err instanceof Deno.errors.NotFound)) throw err
})

await copyDir(sourceDir, outputDir)
console.log(`Built ${outputDir}/ from ${sourceDir}/`)
