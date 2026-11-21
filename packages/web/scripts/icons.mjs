import { Resvg } from '@resvg/resvg-js'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('../', import.meta.url)
const sizes = JSON.parse(readFileSync(new URL('icon/sizes.json', dir), 'utf8'))
const sources = { icon: readFileSync(new URL('icon/icon.svg', dir)), 'icon-monochrome': readFileSync(new URL('icon/icon-monochrome.svg', dir)) }
const render = (svg, size, file) =>
  writeFileSync(new URL(`public/${file}`, dir), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())

for (const size of sizes) for (const [name, svg] of Object.entries(sources)) render(svg, size, `${name}-${size}.png`)
render(sources.icon, 180, 'apple-touch-icon.png')
copyFileSync(new URL('icon/icon.svg', dir), new URL('public/icon.svg', dir))
console.log(`Rendered ${sizes.length * 2 + 1} icons into public/`)
