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

/**
 * Sign-in served by the backend (`/api/auth`). The factory's details come from a later phase.
 *
 * A stopped backend affects only the areas it serves, so if it can't be reached while the UI
 * loads, sign-in counts as off: the app opens, and each area shows its own state. The backend
 * protects nothing in the browser, and without it there is nothing to read. Once the backend
 * has answered, a failed session check stays a failure, as it is no proof of expiry.
 */
import { request } from './http'

const PROVIDER = 'Keycloak'
const NO_SESSION = { valid: false, user: null, factoryId: null, companyId: null, tokenExpiresInS: null }

let backendAnswered = false

export const session = {
  getAuthConfig: async () => {
    try {
      const config = await request('session', 'GET', '/api/auth/config')
      backendAnswered = true
      return config
    } catch (error) {
      if (error.kind !== 'unavailable') throw error
      backendAnswered = false
      return { enabled: false, provider: PROVIDER }
    }
  },
  getSession: async () => {
    try {
      return await request('session', 'GET', '/api/auth/status')
    } catch (error) {
      if (error.kind === 'unavailable' && !backendAnswered) return NO_SESSION
      throw error
    }
  },
  signIn: ({ username, password } = {}) => request('session', 'POST', '/api/auth/connect', { body: { username, password } }),
  signOut: () => request('session', 'POST', '/api/auth/logout'),
}
