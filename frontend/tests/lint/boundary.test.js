import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'

const root = resolve(__dirname, '../..')
const fixture = readFileSync(resolve(__dirname, 'fixtures/violations.jsx'), 'utf8')

async function lintAs(filePath, code = fixture) {
  const eslint = new ESLint({ cwd: root })
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) })
  return result.messages.map((m) => m.ruleId)
}

test('a screen importing a data source or using the network fails lint', async () => {
  const rules = await lintAs('src/features/dashboard/Violation.jsx')
  expect(rules).toContain('no-restricted-imports')
  expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(2)
})

test('a data source may use the network', async () => {
  const code = 'export const get = () => fetch("/api/x")\n'
  expect(await lintAs('src/data/sources/http/example.js', code)).toEqual([])
})

test('the facade may import data sources', async () => {
  const code = "import * as mock from './sources/mock'\nexport default mock\n"
  expect(await lintAs('src/data/example.js', code)).toEqual([])
})
