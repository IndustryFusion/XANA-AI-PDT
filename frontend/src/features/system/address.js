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

/** Schemes accepted for service addresses. */
export const URL_SCHEMES = ['http', 'https', 'ws', 'wss', 'mqtt']

/** Why `value` is not a valid service address (checked with the browser's URL parser), or null. */
export function addressProblem(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'Enter an address.'
  let url
  try {
    url = new URL(text)
  } catch {
    return 'Not a valid URL, for example http://broker.example.org:9090.'
  }
  if (!URL_SCHEMES.includes(url.protocol.slice(0, -1))) return `Use one of the schemes ${URL_SCHEMES.join(', ')}.`
  if (!url.hostname) return 'The address has no host.'
  return null
}
