// Fails if development-only mock controls ended up in the production bundle.
// Run after `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const FORBIDDEN = ['Mock data controls', 'xana.mock.controls', 'Per-area behaviour']

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

let found = 0
for (const file of files(DIST).filter((f) => /\.(js|html|css)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const marker of FORBIDDEN) {
    if (text.includes(marker)) {
      console.error(`Development-only marker "${marker}" found in ${file}`)
      found++
    }
  }
}

if (found) process.exit(1)
console.log('Production bundle contains no development-only mock controls.')
