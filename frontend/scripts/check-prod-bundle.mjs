// Checks the production bundle (run after `npm run build`):
// - development-only mock controls are not included;
// - the chart library is not part of the entry bundle (dashboard and other
//   areas) but loaded on demand in a separate chunk by the data explorer.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const FORBIDDEN = ['Mock data controls', 'xana.mock.controls', 'Per-area behaviour', 'Playback speed of simulated runs']
const CHART_MARKER = 'recharts-wrapper'

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

let found = 0
const scripts = files(DIST).filter((f) => f.endsWith('.js'))
for (const file of files(DIST).filter((f) => /\.(js|html|css)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const marker of FORBIDDEN) {
    if (text.includes(marker)) {
      console.error(`Development-only marker "${marker}" found in ${file}`)
      found++
    }
  }
}

const entry = /<script[^>]+src="\/([^"]+\.js)"/.exec(readFileSync(join(DIST, 'index.html'), 'utf8'))?.[1]
if (!entry) {
  console.error('No entry script found in dist/index.html')
  found++
} else if (readFileSync(join(DIST, entry), 'utf8').includes(CHART_MARKER)) {
  console.error(`The chart library is part of the entry bundle ${entry}; it must be loaded on demand.`)
  found++
}
const chartChunks = scripts.filter((f) => !f.endsWith(entry ?? '') && readFileSync(f, 'utf8').includes(CHART_MARKER))
if (chartChunks.length === 0) {
  console.error('No separate chunk with the chart library found.')
  found++
}

if (found) process.exit(1)
console.log('Production bundle contains no development-only mock controls; the chart library is loaded on demand.')
