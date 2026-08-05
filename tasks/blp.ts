const BLP_HEADER_SIZE = 148

export type RGBAImage = { width: number; height: number; pixels: Uint8Array }

const readUint32 = (view: DataView, offset: number) => view.getUint32(offset, true)

const color565 = (value: number) => [
  Math.round(((value >> 11) & 0x1f) * 255 / 31),
  Math.round(((value >> 5) & 0x3f) * 255 / 63),
  Math.round((value & 0x1f) * 255 / 31),
]

const setPixel = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: readonly number[],
) => {
  if (x >= width || y >= height) return
  const offset = (y * width + x) * 4
  pixels.set(color, offset)
}

const decodeDxtColors = (data: Uint8Array, offset: number, useDxt1Alpha: boolean) => {
  const color0 = data[offset] | (data[offset + 1] << 8)
  const color1 = data[offset + 2] | (data[offset + 3] << 8)
  const first = color565(color0)
  const second = color565(color1)
  const colors = [
    [...first, 255],
    [...second, 255],
  ]

  if (useDxt1Alpha && color0 <= color1) {
    colors.push([
      Math.round((first[0] + second[0]) / 2),
      Math.round((first[1] + second[1]) / 2),
      Math.round((first[2] + second[2]) / 2),
      255,
    ], [0, 0, 0, 0])
  } else {
    colors.push([
      Math.round((2 * first[0] + second[0]) / 3),
      Math.round((2 * first[1] + second[1]) / 3),
      Math.round((2 * first[2] + second[2]) / 3),
      255,
    ], [
      Math.round((first[0] + 2 * second[0]) / 3),
      Math.round((first[1] + 2 * second[1]) / 3),
      Math.round((first[2] + 2 * second[2]) / 3),
      255,
    ])
  }
  return { colors, indices: readUint32(new DataView(data.buffer, data.byteOffset, data.byteLength), offset + 4) }
}

const decodeDxt1 = (
  data: Uint8Array,
  width: number,
  height: number,
  pixels: Uint8Array,
  hasAlpha: boolean,
) => {
  for (let blockY = 0, offset = 0; blockY < height; blockY += 4) {
    for (let blockX = 0; blockX < width; blockX += 4, offset += 8) {
      const block = decodeDxtColors(data, offset, hasAlpha)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const index = (block.indices >> (2 * (y * 4 + x))) & 3
          setPixel(pixels, width, height, blockX + x, blockY + y, block.colors[index])
        }
      }
    }
  }
}

const decodeDxt3 = (data: Uint8Array, width: number, height: number, pixels: Uint8Array) => {
  for (let blockY = 0, offset = 0; blockY < height; blockY += 4) {
    for (let blockX = 0; blockX < width; blockX += 4, offset += 16) {
      const block = decodeDxtColors(data, offset + 8, false)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const pixel = y * 4 + x
          const alphaByte = data[offset + Math.floor(pixel / 2)]
          const alpha = (pixel & 1 ? alphaByte >> 4 : alphaByte & 0x0f) * 17
          const index = (block.indices >> (2 * pixel)) & 3
          setPixel(pixels, width, height, blockX + x, blockY + y, [...block.colors[index].slice(0, 3), alpha])
        }
      }
    }
  }
}

const decodeDxt5 = (data: Uint8Array, width: number, height: number, pixels: Uint8Array) => {
  for (let blockY = 0, offset = 0; blockY < height; blockY += 4) {
    for (let blockX = 0; blockX < width; blockX += 4, offset += 16) {
      const alpha0 = data[offset]
      const alpha1 = data[offset + 1]
      const alphas = [alpha0, alpha1]
      if (alpha0 > alpha1) {
        alphas.push(
          (6 * alpha0 + alpha1) / 7,
          (5 * alpha0 + 2 * alpha1) / 7,
          (4 * alpha0 + 3 * alpha1) / 7,
          (3 * alpha0 + 4 * alpha1) / 7,
          (2 * alpha0 + 5 * alpha1) / 7,
          (alpha0 + 6 * alpha1) / 7,
        )
      } else {
        alphas.push(
          (4 * alpha0 + alpha1) / 5,
          (3 * alpha0 + 2 * alpha1) / 5,
          (2 * alpha0 + 3 * alpha1) / 5,
          (alpha0 + 4 * alpha1) / 5,
          0,
          255,
        )
      }

      let alphaIndices = 0
      for (let byte = 0; byte < 6; byte++) alphaIndices += data[offset + 2 + byte] * 2 ** (8 * byte)
      const block = decodeDxtColors(data, offset + 8, false)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const pixel = y * 4 + x
          const alpha = Math.round(alphas[Math.floor(alphaIndices / 2 ** (3 * pixel)) % 8])
          const index = (block.indices >> (2 * pixel)) & 3
          setPixel(pixels, width, height, blockX + x, blockY + y, [...block.colors[index].slice(0, 3), alpha])
        }
      }
    }
  }
}

const decodePalette = (
  bytes: Uint8Array,
  width: number,
  height: number,
  alphaBits: number,
  mipOffset: number,
  pixels: Uint8Array,
) => {
  const palette = bytes.subarray(BLP_HEADER_SIZE, BLP_HEADER_SIZE + 256 * 4)
  const colorData = bytes.subarray(mipOffset, mipOffset + width * height)
  const alphaOffset = mipOffset + width * height
  for (let pixel = 0; pixel < width * height; pixel++) {
    const paletteOffset = colorData[pixel] * 4
    let alpha = 255
    if (alphaBits === 8) alpha = bytes[alphaOffset + pixel]
    if (alphaBits === 4) {
      const nibble = bytes[alphaOffset + Math.floor(pixel / 2)]
      alpha = (pixel & 1 ? nibble >> 4 : nibble & 0x0f) * 17
    }
    if (alphaBits === 1) alpha = (bytes[alphaOffset + Math.floor(pixel / 8)] >> (pixel & 7) & 1) * 255
    pixels.set([palette[paletteOffset + 2], palette[paletteOffset + 1], palette[paletteOffset], alpha], pixel * 4)
  }
}

export const decodeBlp = (bytes: Uint8Array): RGBAImage => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== 'BLP2') throw Error(`unsupported BLP format ${magic}`)

  const type = readUint32(view, 4)
  const compression = view.getUint8(8)
  const alphaBits = view.getUint8(9)
  const alphaEncoding = view.getUint8(10)
  const width = readUint32(view, 12)
  const height = readUint32(view, 16)
  const mipOffset = readUint32(view, 20)
  const mipSize = readUint32(view, 84)
  if (!width || !height || mipOffset < BLP_HEADER_SIZE || mipOffset + mipSize > bytes.byteLength) {
    throw Error('invalid BLP2 dimensions or mipmap')
  }

  const pixels = new Uint8Array(width * height * 4)
  if (type !== 1) throw Error(`unsupported BLP2 type ${type}`)
  switch (compression) {
    case 1:
      decodePalette(bytes, width, height, alphaBits, mipOffset, pixels)
      break
    case 2:
      if (alphaEncoding === 1) decodeDxt3(bytes.subarray(mipOffset, mipOffset + mipSize), width, height, pixels)
      else if (alphaEncoding === 7) decodeDxt5(bytes.subarray(mipOffset, mipOffset + mipSize), width, height, pixels)
      else if (alphaEncoding === 0) {
        decodeDxt1(bytes.subarray(mipOffset, mipOffset + mipSize), width, height, pixels, alphaBits === 1)
      } else throw Error(`unsupported BLP2 alpha encoding ${alphaEncoding}`)
      break
    case 3: {
      const source = bytes.subarray(mipOffset, mipOffset + mipSize)
      for (let pixel = 0; pixel < width * height; pixel++) {
        const offset = pixel * 4
        pixels.set(
          [source[offset + 2], source[offset + 1], source[offset], alphaBits ? source[offset + 3] : 255],
          offset,
        )
      }
      break
    }
    default:
      throw Error(`unsupported BLP2 compression ${compression}`)
  }
  return { width, height, pixels }
}

export const trimImage = (image: RGBAImage, border: number): RGBAImage => {
  if (!Number.isInteger(border) || border < 0) throw Error('invalid image border')
  const width = image.width - border * 2
  const height = image.height - border * 2
  if (width <= 0 || height <= 0) throw Error('image border is too large')

  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceOffset = ((y + border) * image.width + border) * 4
    pixels.set(image.pixels.subarray(sourceOffset, sourceOffset + width * 4), y * width * 4)
  }
  return { width, height, pixels }
}

export const blackenCorners = (image: RGBAImage): RGBAImage => {
  const pixels = image.pixels.slice()
  for (const [x, y] of [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]]) {
    pixels.set([0, 0, 0, 255], (y * image.width + x) * 4)
  }
  return { ...image, pixels }
}

export const stitchImages = (images: readonly RGBAImage[], columns: number): RGBAImage => {
  if (!images.length) throw Error('cannot stitch an empty image list')
  if (!Number.isInteger(columns) || columns <= 0) throw Error('invalid image columns')
  const { width, height } = images[0]
  if (images.some((image) => image.width !== width || image.height !== height)) {
    throw Error('all stitched images must have the same dimensions')
  }

  const rows = Math.ceil(images.length / columns)
  const pixels = new Uint8Array(width * columns * height * rows * 4)
  for (const [index, image] of images.entries()) {
    const x = index % columns
    const y = Math.floor(index / columns)
    for (let row = 0; row < height; row++) {
      const sourceOffset = row * width * 4
      const targetOffset = ((y * height + row) * width * columns + x * width) * 4
      pixels.set(image.pixels.subarray(sourceOffset, sourceOffset + width * 4), targetOffset)
    }
  }
  return { width: width * columns, height: height * rows, pixels }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array) => {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.byteLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)))
  return chunk
}

export const encodePng = async ({ width, height, pixels }: RGBAImage) => {
  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1)
    scanlines[rowOffset] = 0
    scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1)
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  )
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const end = pngChunk('IEND', new Uint8Array())
  const result = new Uint8Array(signature.byteLength + 25 + compressed.byteLength + 12 + end.byteLength)
  let offset = 0
  result.set(signature, offset)
  offset += signature.byteLength
  result.set(pngChunk('IHDR', header), offset)
  offset += 25
  result.set(pngChunk('IDAT', compressed), offset)
  offset += compressed.byteLength + 12
  result.set(end, offset)
  return result
}
