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
 * What the Alerts area keeps while the operator is in another area, so it is
 * the same on return: the checked rows, the last list shown per request and
 * the scroll position. Filters and the open alert are in the address, which
 * the main navigation brings back. Cleared when the session ends.
 */
import { onSessionEnd } from '../../app/lastPath'

const fresh = () => ({ selection: [], results: null, scroll: null })
let kept = fresh()

export const keptSelection = () => kept.selection
export const keepSelection = (ids) => { kept.selection = ids }
/** The last list, for the request it answered. */
export const keptResults = (key) => (kept.results?.key === key ? kept.results.data : undefined)
export const keepResults = (key, data) => { if (data !== undefined) kept.results = { key, data } }
/** The scroll position, for the address it was left at. */
export const keptScroll = (path) => (kept.scroll?.path === path ? kept.scroll.y : null)
export const keepScroll = (path, y) => { kept.scroll = { path, y } }

/** Starts again as after a reload. */
export function resetAlertsState() { kept = fresh() }

onSessionEnd(resetAlertsState)
