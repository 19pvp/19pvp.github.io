import { basename, join, normalize } from '@std/path'

const CLIENT_DIRECTORY_NAME = 'World of Warcraft 3.3.5a'
const SCAN_PARALLELISM = 4
const SCAN_PROGRESS_INTERVAL = 100
const EXCLUDED_DIRECTORIES = new Set([
  '$recycle.bin',
  '.cache',
  '.git',
  'appdata',
  'cache',
  'caches',
  'dropbox',
  'googledrive',
  'icloud drive',
  'library',
  'node_modules',
  'onedrive',
  'perflogs',
  'programdata',
  'recovery',
  'steamlibrary',
  'steamapps',
  'system volume information',
  'temp',
  'tmp',
  'venv',
  'windows',
  'windowsapps',
])

export type TorrentFile = { path: string; length: number }
export type ScannedFile = TorrentFile & { sourcePath: string }

let started = false

function homePath(): string {
  return Deno.env.get(Deno.build.os === 'windows' ? 'USERPROFILE' : 'HOME') ?? Deno.cwd()
}

const makeQueue = (max: number) => {
  let slotsUsed = 0
  const pendingSlots: Array<(slot: Slot) => void> = []
  type Slot = { [Symbol.dispose](): void }
  const freeSlot = {
    [Symbol.dispose]() {
      const next = pendingSlots.shift()
      next ? next(freeSlot) : slotsUsed--
    },
  }

  const queueSlot = (resolve: (slot: Slot) => void) => pendingSlots.push(resolve)
  return (): Slot | Promise<Slot> => {
    if (slotsUsed >= max) return new Promise<Slot>(queueSlot)
    slotsUsed++
    return freeSlot
  }
}

function samePath(left: string, right: string): boolean {
  left = normalize(left)
  right = normalize(right)
  return Deno.build.os === 'windows' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function relativeClientPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  if (parts[0]?.toLowerCase() === CLIENT_DIRECTORY_NAME.toLowerCase()) parts.shift()
  return parts.join('/')
}

function torrentPath(source: string, path: string): string {
  return join(source, ...relativeClientPath(path).split('/'))
}

function scanRoots(): string[] {
  const roots = [Deno.cwd(), homePath()]
  if (Deno.build.os === 'windows') {
    for (let code = 65; code <= 90; code++) {
      const root = `${String.fromCharCode(code)}:\\`
      try {
        Deno.statSync(root)
        roots.push(root)
      } catch {
        // Drive does not exist or is not accessible.
      }
    }
  }
  return roots.filter((root, index) => roots.findIndex((candidate) => samePath(candidate, root)) === index)
}

export async function findMatchingTorrentFiles(
  source: string,
  files: TorrentFile[],
  report: (message: string) => void = () => {},
): Promise<ScannedFile[]> {
  const matches: ScannedFile[] = []
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.mpq')) continue
    const sourcePath = torrentPath(source, file.path)
    try {
      const stat = await Deno.stat(sourcePath)
      if (stat.isFile && stat.size === file.length) {
        report(`scan file accepted: ${sourcePath}; size=${stat.size}`)
        matches.push({ ...file, sourcePath })
      }
    } catch { /* Missing or inaccessible files do not match. */ }
  }

  const anchors = ['Data/enUS/patch-enUS-3.MPQ']
  if (
    !anchors.every((anchor) => {
      const expected = files.find((file) => relativeClientPath(file.path).toLowerCase() === anchor.toLowerCase())
      return expected && matches.some((file) => file.path === expected.path)
    })
  ) {
    return []
  }
  return matches
}

export function startScan(
  files: TorrentFile[],
  ignoredPath: string,
  log: (message: string) => void,
  found: (source: string, files: ScannedFile[]) => Promise<void>,
  signal: AbortSignal,
): void {
  if (started) return
  started = true
  void (async () => {
    const roots = scanRoots()
    const visited = new Set<string>()
    const getSlot = makeQueue(SCAN_PARALLELISM)
    let lastProgress = 0
    log('scan started')

    for (const root of roots) {
      if (signal.aborted) return
      log(`scan root: ${root}`)
      let candidate: { path: string; files: ScannedFile[] } | null = null
      let foundStarted = false

      const scanDirectory = async (path: string): Promise<void> => {
        if (signal.aborted || candidate) return
        const normalizedPath = normalize(path)
        if (visited.has(normalizedPath)) return
        visited.add(normalizedPath)
        if (samePath(path, ignoredPath)) return
        if (visited.size <= 20) log(`scan directory: ${path}`)
        if (visited.size >= lastProgress + SCAN_PROGRESS_INTERVAL) {
          lastProgress = visited.size
          log(`scan progress: directories=${visited.size}`)
        }

        const children: string[] = []
        try {
          using _ = await getSlot()
          if (signal.aborted || candidate) return
          if (basename(path).toLowerCase() === CLIENT_DIRECTORY_NAME.toLowerCase()) {
            const matches = await findMatchingTorrentFiles(path, files, log)
            if (matches.length) {
              candidate = { path, files: matches }
              foundStarted = true
              await found(path, matches)
              log('scan complete: existing client found')
              return
            }
          }
          let entries
          try {
            entries = Deno.readDir(path)
          } catch {
            return
          }
          for await (const entry of entries) {
            if (signal.aborted || candidate) break
            const next = join(path, entry.name)
            if (entry.isDirectory) {
              if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) children.push(next)
              continue
            }
            if (!entry.isFile || !entry.name.toLowerCase().endsWith('.mpq')) continue
          }
        } catch {
          // A directory can disappear or become inaccessible while scanning.
        }
        if (!candidate && !signal.aborted) await Promise.all(children.map(scanDirectory))
      }

      await scanDirectory(root)
      log(`scan root complete: ${root}; directories=${visited.size}`)
      const result = candidate as { path: string; files: ScannedFile[] } | null
      if (result && !foundStarted) {
        await found(result.path, result.files)
        log('scan complete: existing client found')
        return
      }
    }

    log('scan complete: no existing client found')
  })().catch((error) => log(`scan failed: ${error instanceof Error ? error.message : String(error)}`))
}
