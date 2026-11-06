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

/** Sign-in served by the backend (`/api/auth`). The factory's details come from a later phase. */
import { request } from './http'

export const session = {
  getAuthConfig: () => request('session', 'GET', '/api/auth/config'),
  getSession: () => request('session', 'GET', '/api/auth/status'),
  signIn: ({ username, password } = {}) => request('session', 'POST', '/api/auth/connect', { body: { username, password } }),
  signOut: () => request('session', 'POST', '/api/auth/logout'),
}
