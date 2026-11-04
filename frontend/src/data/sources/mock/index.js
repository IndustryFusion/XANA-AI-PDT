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
 * Mock data source: implements the UI data interface in the browser with a
 * deterministic seed and a simulated run engine, so the UI runs without any
 * backend.
 */
import { MOCK_CREDENTIALS } from './areas'
import { MOCK_DATASPACE_SECRET } from './dataspaceArea'
import { areas, engine, raiseAlert, store } from './instance'
import DevControlsPanel from './DevControls'

export const info = {
  name: 'mock',
  signInHint: `Mock data: sign in as ${MOCK_CREDENTIALS.username} / ${MOCK_CREDENTIALS.password}`,
  dataspaceHint: `Mock data: the dataspace credential is ${MOCK_DATASPACE_SECRET}`,
}

export const { session, runs, incidents, alerts, entities, dataspace, knowledgeBase, system } = areas

/** The mock's store, run engine and alert generator, for tests that need to arrange data. */
export { store, engine, raiseAlert }

// Resolved at build time so production bundles do not contain the panel.
export const DevControls = import.meta.env.DEV ? DevControlsPanel : null
