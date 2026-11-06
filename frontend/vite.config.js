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

import { configDefaults } from 'vitest/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Forward API and run-stream requests to the backend (default: the local environment's address).
const backend = process.env.XANA_BACKEND_URL || 'http://localhost:8000'
const proxy = {
  '/api': { target: backend, ws: true, changeOrigin: true },
  '/ws': { target: backend, ws: true, changeOrigin: true },
}

export default defineConfig({
  plugins: [react()],
  // Listen on all network interfaces so the UI is reachable from other machines.
  server: { host: true, proxy },
  preview: { host: true, proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    // The knowledge base is off by default; `npm run test:knowledge-base` tests it turned on.
    exclude: [...configDefaults.exclude, ...(process.env.VITE_KNOWLEDGE_BASE === 'on' ? [] : ['tests/**/knowledgeBase.test.*'])],
    css: false,
  },
})
