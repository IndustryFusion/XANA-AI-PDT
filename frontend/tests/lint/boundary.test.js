//
// Copyright (c) 2026 IndustryFusion Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

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
