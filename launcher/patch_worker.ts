import { type DBCEdit, generatePatch } from './patch.ts'
import { loadStormLib } from './stormlib.ts'

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void
  postMessage(message: unknown): void
}

worker.onmessage = async (event) => {
  try {
    const { root, edits, outputPath } = event.data as {
      root: string
      edits: DBCEdit[]
      outputPath: string
    }
    worker.postMessage({ message: 'loading StormLib', type: 'log' })
    const started = performance.now()
    const storm = await loadStormLib()
    worker.postMessage({ message: `StormLib ready in ${Math.round(performance.now() - started)}ms`, type: 'log' })
    await generatePatch(storm, root, edits, outputPath, (message) => {
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
