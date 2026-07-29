import { join, normalize } from '@std/path'

const CLIENT_DIRECTORY_NAME = 'World of Warcraft 3.3.5a'
const SCANNED_ROOTS_KEY = 'scannedScanRoots'
const SCAN_WORKERS = 4
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

function savedRoots(): Set<string> {
  try {
    const roots = JSON.parse(localStorage.getItem(SCANNED_ROOTS_KEY) ?? '[]')
    return new Set(Array.isArray(roots) ? roots : [])
  } catch {
    return new Set()
  }
}

function saveRoots(roots: Set<string>): void {
  localStorage.setItem(SCANNED_ROOTS_KEY, JSON.stringify([...roots]))
}

async function scanRoots(): Promise<string[]> {
  const home = homePath()
  const roots = [home, Deno.cwd()]
  if (Deno.build.os === 'windows') {
    for (let code = 65; code <= 90; code++) {
      const root = `${String.fromCharCode(code)}:\\`
      try {
        await Deno.stat(root)
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
): Promise<ScannedFile[]> {
  const matches: ScannedFile[] = []
  for (const file of files) {
    const sourcePath = torrentPath(source, file.path)
    try {
      const stat = await Deno.stat(sourcePath)
      if (stat.isFile && stat.size === file.length) {
        matches.push({ ...file, sourcePath })
      }
    } catch {
      // Missing or inaccessible files are simply not copied.
    }
  }

  const anchors = ['Wow.exe', 'Data/enUS/patch-enUS-3.MPQ']
  return anchors.every((anchor) => {
      const expected = files.find((file) => relativeClientPath(file.path).toLowerCase() === anchor.toLowerCase())
      return expected && matches.some((file) => file.path === expected.path)
    })
    ? matches
    : []
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
    const roots = await scanRoots()
    const scannedRoots = savedRoots()
    const visited = new Set<string>()
    log('scan started')

    for (const root of roots) {
      if (signal.aborted) return
      if ([...scannedRoots].some((scanned) => samePath(scanned, root))) {
        log(`scan skipped previously visited root: ${root}`)
        continue
      }

      scannedRoots.add(root)
      saveRoots(scannedRoots)
      log(`scan root: ${root}`)
      const pending = [root]
      let candidate: { path: string; files: ScannedFile[] } | null = null

      const worker = async () => {
        while (!signal.aborted && !candidate) {
          const path = pending.pop()
          if (!path) return
          const normalizedPath = normalize(path)
          if (visited.has(normalizedPath)) continue
          visited.add(normalizedPath)

          let entries
          try {
            entries = Deno.readDir(path)
          } catch {
            continue
          }
          try {
            for await (const entry of entries) {
              if (signal.aborted || candidate) return
              const next = join(path, entry.name)
              if (entry.isDirectory) {
                if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) pending.push(next)
                continue
              }
              if (!entry.isFile || entry.name.toLowerCase() !== 'wow.exe') continue
              if (samePath(path, ignoredPath)) continue
              log(`scan candidate: ${path}`)
              const matches = await findMatchingTorrentFiles(path, files)
              if (!matches.length) {
                log(`scan candidate rejected: ${path}`)
                continue
              }
              candidate = { path, files: matches }
              log(`scan candidate valid: ${path}; matching files=${matches.length}`)
              return
            }
          } catch {
            // A directory can disappear or become inaccessible while scanning.
          }
        }
      }

      await Promise.all(Array.from({ length: SCAN_WORKERS }, worker))
      log(`scan root complete: ${root}; directories=${visited.size}`)
      const result = candidate as { path: string; files: ScannedFile[] } | null
      if (result) {
        await found(result.path, result.files)
        log('scan complete: existing client found')
        return
      }
    }

    log('scan complete: no existing client found')
  })().catch((error) => log(`scan failed: ${error instanceof Error ? error.message : String(error)}`))
}
