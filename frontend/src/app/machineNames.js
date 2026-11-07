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

import { useData } from '../data/useData'

/**
 * Asset names of machines from the registry, `{ [machineId]: name }`. Empty while loading, and when the
 * registry is unavailable: screens then show the IDs, as before.
 */
export function useMachineNames(machineIds) {
  const ids = [...new Set((machineIds ?? []).filter(Boolean))].sort()
  const result = useData('dataspace', 'resolveMachines', [ids], { enabled: ids.length > 0 })
  return result.status === 'success' && result.data ? result.data : {}
}
