/** Deno convenience wrapper for the Emscripten StormLib module. */

import stormModuleFactory from 'stormlib/module'
import stormWasm from 'stormlib/wasm' with { type: 'bytes' }

export const MPQ_OPEN_NO_LISTFILE = 0x0001_0000
export const MPQ_OPEN_NO_ATTRIBUTES = 0x0002_0000
export const MPQ_OPEN_READ_ONLY = 0x0000_0100
export const STREAM_FLAG_WRITE_SHARE = 0x0000_0200

export enum Compression {
  HUFFMANN = 0x01,
  ZLIB = 0x02,
  PKWARE = 0x08,
  BZIP2 = 0x10,
  SPARSE = 0x20,
  ADPCM_MONO = 0x40,
  ADPCM_STEREO = 0x80,
  LZMA = 0x12,
}

export enum ArchiveFlags {
  IMPLODE = 0x0000_0100,
  COMPRESS = 0x0000_0200,
  ENCRYPTED = 0x0001_0000,
  FIX_KEY = 0x0002_0000,
  DELETE_MARKER = 0x0200_0000,
  SECTOR_CRC = 0x0400_0000,
  SINGLE_UNIT = 0x0100_0000,
  REPLACEEXISTING = 0x8000_0000,
}

export enum CreateFlags {
  LISTFILE = 0x0010_0000,
  ATTRIBUTES = 0x0020_0000,
  SIGNATURE = 0x0040_0000,
  ARCHIVE_V1 = 0x0000_0000,
  ARCHIVE_V2 = 0x0100_0000,
  ARCHIVE_V3 = 0x0200_0000,
  ARCHIVE_V4 = 0x0300_0000,
}

type StormModule = {
  FS: {
    mkdir(path: string): void
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
    unlink(path: string): void
  }
  HEAPU8: Uint8Array
  cwrap(
    name: string,
    returnType: string,
    argTypes: string[],
  ): (...args: (string | number)[]) => number
}

type StormModuleFactory = (
  options: { wasmBinary: Uint8Array },
) => Promise<StormModule>

export async function loadStormLib(): Promise<StormArchiveModule> {
  const factory = stormModuleFactory as unknown as StormModuleFactory
  return new StormArchiveModule(await factory({ wasmBinary: stormWasm }))
}

export class StormArchiveModule {
  readonly #module: StormModule
  #directoryReady = false
  readonly #openArchive: (...args: (string | number)[]) => number
  readonly #createArchive: (...args: (string | number)[]) => number
  readonly #closeArchive: (...args: (string | number)[]) => number
  readonly #hasFile: (...args: (string | number)[]) => number
  readonly #addFile: (...args: (string | number)[]) => number
  readonly #fileSize: (...args: (string | number)[]) => number
  readonly #readFile: (...args: (string | number)[]) => number
  readonly #readFileSize: (...args: (string | number)[]) => number
  readonly #freeReadBuffer: (...args: (string | number)[]) => number
  readonly #lastError: (...args: (string | number)[]) => number

  constructor(module: StormModule) {
    this.#module = module
    this.#openArchive = module.cwrap('storm_wasm_open_archive', 'number', [
      'string',
      'number',
    ])
    this.#createArchive = module.cwrap('storm_wasm_create_archive', 'number', [
      'string',
      'number',
      'number',
    ])
    this.#closeArchive = module.cwrap('storm_wasm_close_archive', 'number', [
      'number',
    ])
    this.#hasFile = module.cwrap('storm_wasm_has_file', 'number', [
      'number',
      'string',
    ])
    this.#addFile = module.cwrap('storm_wasm_add_file', 'number', [
      'number',
      'string',
      'string',
      'number',
      'number',
      'number',
    ])
    this.#fileSize = module.cwrap('storm_wasm_file_size', 'number', [
      'number',
      'string',
    ])
    this.#readFile = module.cwrap('storm_wasm_read_file', 'number', [
      'number',
      'string',
    ])
    this.#readFileSize = module.cwrap(
      'storm_wasm_read_file_size',
      'number',
      [],
    )
    this.#freeReadBuffer = module.cwrap(
      'storm_wasm_free_read_buffer',
      'number',
      [],
    )
    this.#lastError = module.cwrap('storm_wasm_last_error', 'number', [])
  }

  openArchive(
    bytes: Uint8Array,
    flags = MPQ_OPEN_READ_ONLY | MPQ_OPEN_NO_LISTFILE | MPQ_OPEN_NO_ATTRIBUTES,
    saveOnClose = false,
  ): StormArchive {
    this.ensureDirectory()
    const path = '/stormlib/archive.mpq'
    this.#module.FS.writeFile(path, bytes)

    const handle = this.#openArchive(path, flags)
    if (handle === 0) {
      throw new Error(`SFileOpenArchive failed (error ${this.lastError()})`)
    }
    return new StormArchive(this, handle, saveOnClose)
  }

  createArchive(
    flags = CreateFlags.ARCHIVE_V2 | CreateFlags.LISTFILE |
      CreateFlags.ATTRIBUTES | CreateFlags.SIGNATURE,
    maxFileCount = 127,
  ): StormArchive {
    this.ensureDirectory()
    const handle = this.#createArchive(
      '/stormlib/archive.mpq',
      flags,
      maxFileCount,
    )
    if (handle === 0) {
      throw new Error(`SFileCreateArchive failed (error ${this.lastError()})`)
    }
    return new StormArchive(this, handle, true)
  }

  async open(
    file: string | URL,
    options: { readonly?: boolean } = {},
  ): Promise<MPQ> {
    const bytes = await Deno.readFile(file)
    const flags = options.readonly === false ? STREAM_FLAG_WRITE_SHARE : MPQ_OPEN_READ_ONLY
    return new MPQ(
      this,
      this.openArchive(bytes, flags, options.readonly === false),
      file,
      options.readonly !== false,
    )
  }

  async create(
    file: string | URL,
    options: { flags?: number; maxFileCount?: number } = {},
  ): Promise<MPQ> {
    const archive = this.createArchive(options.flags, options.maxFileCount)
    return new MPQ(this, archive, file, false)
  }

  hasFile(handle: number, name: string): boolean {
    return this.#hasFile(handle, name) !== 0
  }

  addFile(
    handle: number,
    data: Uint8Array,
    archiveName: string,
    flags = ArchiveFlags.COMPRESS,
    compression = Compression.ZLIB,
    compressionNext = Compression.ZLIB,
  ): void {
    this.ensureDirectory()
    this.#module.FS.writeFile('/stormlib/input-file', data)
    const ok = this.#addFile(
      handle,
      '/stormlib/input-file',
      archiveName,
      flags,
      compression,
      compressionNext,
    )
    if (ok === 0) {
      throw new Error(`SFileAddFileEx failed (error ${this.lastError()})`)
    }
  }

  fileSize(handle: number, name: string): number {
    const size = this.#fileSize(handle, name)
    if (size < 0) {
      throw new Error(`SFileGetFileSize failed (error ${this.lastError()})`)
    }
    return size
  }

  readFile(handle: number, name: string): Uint8Array {
    const pointer = this.#readFile(handle, name)
    if (pointer === 0) {
      throw new Error(`SFileReadFile failed (error ${this.lastError()})`)
    }
    const size = this.#readFileSize()
    const contents = this.#module.HEAPU8.slice(pointer, pointer + size)
    this.#freeReadBuffer()
    return contents
  }

  readVirtualFile(path: string): Uint8Array {
    return this.#module.FS.readFile(path).slice()
  }

  closeArchive(handle: number): void {
    if (this.#closeArchive(handle) === 0) {
      throw new Error(`SFileCloseArchive failed (error ${this.lastError()})`)
    }
  }

  lastError(): number {
    return this.#lastError()
  }

  private ensureDirectory(): void {
    if (this.#directoryReady) return
    try {
      this.#module.FS.mkdir('/stormlib')
      this.#directoryReady = true
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('File exists')) {
        if ((error as { errno?: number }).errno !== 20) throw error
      }
      this.#directoryReady = true
    }
  }
}

export class StormArchive {
  readonly #module: StormArchiveModule
  readonly #handle: number
  readonly #saveOnClose: boolean
  #closed = false

  constructor(
    module: StormArchiveModule,
    handle: number,
    saveOnClose: boolean,
  ) {
    this.#module = module
    this.#handle = handle
    this.#saveOnClose = saveOnClose
  }

  hasFile(name: string): boolean {
    this.assertOpen()
    return this.#module.hasFile(this.#handle, name)
  }

  fileSize(name: string): number {
    this.assertOpen()
    return this.#module.fileSize(this.#handle, name)
  }

  readFile(name: string): Uint8Array {
    this.assertOpen()
    return this.#module.readFile(this.#handle, name)
  }

  getFile(name: string): File {
    return new File(this, name)
  }

  addFile(
    data: Uint8Array,
    archiveName: string,
    options: {
      flags?: number
      compression?: number
      compressionNext?: number
    } = {},
  ): void {
    this.assertOpen()
    this.#module.addFile(
      this.#handle,
      data,
      archiveName,
      options.flags,
      options.compression,
      options.compressionNext,
    )
  }

  close(): Uint8Array | undefined {
    if (!this.#closed) {
      this.#module.closeArchive(this.#handle)
      this.#closed = true
    }
    return this.#saveOnClose ? this.#module.readVirtualFile('/stormlib/archive.mpq') : undefined
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('Storm archive is already closed')
  }
}

export class File {
  readonly size: number
  readonly #archive: StormArchive
  readonly #name: string
  #closed = false

  constructor(archive: StormArchive, name: string) {
    this.#archive = archive
    this.#name = name
    this.size = archive.fileSize(name)
  }

  read(buffer: ArrayBuffer | Uint8Array): number {
    if (this.#closed) throw new Error('File is already closed')
    const target = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    const contents = this.#archive.readFile(this.#name)
    const bytesRead = Math.min(target.byteLength, contents.byteLength)
    target.set(contents.subarray(0, bytesRead))
    return bytesRead
  }

  close(): void {
    this.#closed = true
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

export class MPQ {
  readonly #archive: StormArchive
  readonly #file: string | URL
  readonly #readOnly: boolean
  #closed = false

  constructor(
    private readonly module: StormArchiveModule,
    archive: StormArchive,
    file: string | URL,
    readOnly: boolean,
  ) {
    this.#archive = archive
    this.#file = file
    this.#readOnly = readOnly
  }

  getFile(name: string): File {
    this.assertOpen()
    return this.#archive.getFile(name)
  }

  async addFile(
    fileName: string | URL,
    archiveName: string,
    options: {
      flags?: number
      compression?: number
      compressionNext?: number
    } = {},
  ): Promise<void> {
    this.assertOpen()
    if (this.#readOnly) throw new Error('Archive was opened read-only')
    this.#archive.addFile(await Deno.readFile(fileName), archiveName, options)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    const bytes = this.#archive.close()
    this.#closed = true
    if (bytes !== undefined) await Deno.writeFile(this.#file, bytes)
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('Archive is already closed')
  }
}
