import esbuild from 'esbuild'
import { config } from './esbuild.config.js'

const injectedCode = () => {
  // Use dev no-build version of tailwindcss
  const s = document.createElement('script')
  s.src = 'https://cdn.tailwindcss.com/3.4.3'
  document.body.append(s)

  // Inject some code to auto reload the page on change
  new EventSource('/esbuild')
    .addEventListener('change', () => location.reload())
}

const ctx = await esbuild.context({
  ...config,
  sourcemap: true,
  banner: { js: String(injectedCode).slice('() => '.length) },
})

await ctx.watch()
const { host, port } = await ctx.serve({ servedir: 'build' })

console.log(`http://${host}:${port}`)
