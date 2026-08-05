const { default: sharp } = await import('sharp')

const sprite = sharp(await Deno.readFile('web/assets/icons.png'))
  .flatten({ background: '#000000' })

await Promise.all([
  sprite.clone().avif({ quality: 55, effort: 9, chromaSubsampling: '4:2:0' }).toFile('web/assets/icons.avif'),
  sprite.clone().jpeg({ quality: 80, chromaSubsampling: '4:2:0', mozjpeg: true }).toFile('web/assets/icons.jpg'),
])

await Deno.remove('web/assets/icons.png')
