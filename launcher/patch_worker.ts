import { type DBCEdit, generatePatch, type PatchFile } from './patch.ts'
import { loadStormLib } from './stormlib.ts'

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void
  postMessage(message: unknown): void
}

worker.onmessage = async (event) => {
  try {
    const { root, edits, files, outputPath } = event.data as {
      root: string
      edits: DBCEdit[]
      files: PatchFile[]
      outputPath: string
    }
    worker.postMessage({ message: 'loading StormLib', type: 'log' })
    const started = performance.now()
    const storm = await loadStormLib()
    worker.postMessage({ message: `StormLib ready in ${Math.round(performance.now() - started)}ms`, type: 'log' })
    await generatePatch(storm, root, edits, files, outputPath, (message) => {
      worker.postMessage({ message, type: 'log' })
    })
    worker.postMessage({ ok: true })
  } catch (error) {
    worker.postMessage({
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    })
  }
}
