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
    await generatePatch(await loadStormLib(), root, edits, outputPath)
    worker.postMessage({ ok: true })
  } catch (error) {
    worker.postMessage({
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    })
  }
}
