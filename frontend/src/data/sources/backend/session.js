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
 * Sign-in served by the backend (`/api/auth`), and the factory's details from the IFRIC registry (`/api/ifric/factory`).
 *
 * A stopped backend affects only the areas it serves, so if it has not answered since the UI
 * loaded, `getAuthConfig` says so with `backendUnreachable`: the app opens, each area shows its
 * own state, and the session gate checks again until the backend answers. Once the backend has
 * answered, a failed read stays a failure, as it is no proof that sign-in is off or has expired.
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
      if (error.kind !== 'unavailable' || backendAnswered) throw error
      return { enabled: false, provider: PROVIDER, backendUnreachable: true }
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
  getFactory: () => request('session', 'GET', '/api/ifric/factory'),
}
