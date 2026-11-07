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
 * Backend data source: every operation of the interface comes from the backend. Nothing here uses the mock
 * source, and a test keeps it that way. The optional knowledge base has no backend, so with its build
 * setting on, its operations reject as `unavailable`.
 */
import { alerts as backendAlerts } from './alerts'
import { dataspace as backendDataspace } from './dataspace'
import { entities as backendEntities } from './entities'
import { incidents as backendIncidents } from './incidents'
import { runs as backendRuns } from './runs'
import { session as backendSession } from './session'
import { system as backendSystem } from './system'

export const session = backendSession
export const runs = backendRuns
export const incidents = backendIncidents
export const entities = backendEntities
export const alerts = backendAlerts
export const dataspace = backendDataspace
export const system = backendSystem

/** The operations of each area that the backend serves. */
export const SERVED = Object.fromEntries(
  Object.entries({ session, runs, incidents, entities, alerts, dataspace, system }).map(([name, ops]) => [name, Object.keys(ops)]),
)

export const info = { name: 'backend' }
