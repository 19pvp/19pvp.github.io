import { once } from 'node:events'
import { spawn } from 'node:child_process'
import esbuild from 'esbuild'
import { config } from './esbuild.config.js'

// ./node_modules/.bin/tailwindcss -i ./src/style.css -o ./build/style.css --minify
const tailwindBuild = spawn('./node_modules/.bin/tailwindcss', [
  ...['-i', './src/style.css'],
  ...['-o', './build/style.css'],
  ...['--minify'],
])

await esbuild.build({
  ...config,
  minify: true,
  splitting: true,
  treeShaking: true,
})
console.log('js bundle generated')

await once(tailwindBuild, 'close')
console.log('tailwind css generated')
