export const config = {
  entryPoints: ['src/index.jsx'],
  outdir: 'build',
  bundle: true,
  format: 'esm',
  jsxImportSource: 'preact',
  jsx: 'transform',
  jsxFactory: 'h',
}
