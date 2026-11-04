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

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

// Screens talk to the backend only through the UI data interface (src/data).
// Data sources are private to src/data, and only data sources may do network I/O.
const NETWORK_GLOBALS = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest'].map((name) => ({
  name,
  message: 'Network access belongs in a data source under src/data/sources/.',
}))

export default [
  { ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'tests/lint/fixtures/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/data/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/data/sources', '**/data/sources/**'],
          message: 'Use the UI data interface (src/data) instead of a data source.',
        }],
      }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/data/sources/**'],
    rules: { 'no-restricted-globals': ['error', ...NETWORK_GLOBALS] },
  },
  {
    files: ['tests/**/*.{js,jsx}', 'e2e/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
