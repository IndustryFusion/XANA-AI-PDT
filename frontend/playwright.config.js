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

import { defineConfig, devices } from '@playwright/test'

const PORT = 5174
const BACKEND_UI_PORT = 5175

// XANA_E2E_BACKEND=1 runs only the `backend` project: the UI on the backend data
// source against a running backend (XANA_BACKEND_URL, default http://localhost:8000)
// with the scripted language model and the sample data. Otherwise only the mock project runs.
const backendRun = !!process.env.XANA_E2E_BACKEND

const mock = {
  project: { name: 'chromium', testIgnore: 'backend/**', use: { ...devices['Desktop Chrome'] } },
  server: {
    command: `npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_DATA_SOURCE: 'mock', VITE_SESSION_CHECK_MS: '1000' },
  },
}

const backend = {
  project: {
    name: 'backend',
    testDir: './e2e/backend',
    use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${BACKEND_UI_PORT}` },
  },
  server: {
    command: `npm run dev -- --port ${BACKEND_UI_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${BACKEND_UI_PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_DATA_SOURCE: 'backend', VITE_SESSION_CHECK_MS: '1000', XANA_BACKEND_URL: process.env.XANA_BACKEND_URL ?? 'http://localhost:8000' },
  },
}

const selected = backendRun ? backend : mock

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !backendRun,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [selected.project],
  webServer: selected.server,
})
