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
 * Backend data source. Serves what the backend provides (session, runs,
 * incidents, the entities of the data explorer, alerts, the dataspace connection, system health) and delegates every other operation to the mock source, so
 * the whole UI stays usable while later phases bring their backends.
 *
 * Each area is `{ ...mock[area], ...backend[area] }`: delegation is visible here only.
 */
import { AREAS } from '../../interface'
import * as mock from '../mock'
import { alerts as backendAlerts } from './alerts'
import { dataspace as backendDataspace } from './dataspace'
import { entities as backendEntities } from './entities'
import { incidents as backendIncidents } from './incidents'
import { runs as backendRuns } from './runs'
import { session as backendSession } from './session'
import { system as backendSystem } from './system'

const backend = { session: backendSession, runs: backendRuns, incidents: backendIncidents, entities: backendEntities, alerts: backendAlerts, dataspace: backendDataspace, system: backendSystem }

/** Operations of each area that the backend serves; everything else comes from the mock. */
export const SERVED = Object.fromEntries(Object.entries(backend).map(([name, ops]) => [name, Object.keys(ops)]))

const areas = Object.fromEntries(AREAS.map((name) => [name, { ...mock[name], ...(backend[name] ?? {}) }]))

export const { session, runs, incidents, entities, alerts, dataspace, knowledgeBase, system } = areas

export const info = { ...mock.info, name: 'backend', signInHint: undefined }

// The mock's development controls still drive the delegated areas.
export const DevControls = mock.DevControls
