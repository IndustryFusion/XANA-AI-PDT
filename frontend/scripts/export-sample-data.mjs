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

// Writes the backend's sample machine data from the mock seed.
// Run from frontend/: npx vite-node scripts/export-sample-data.mjs
import { writeFileSync } from 'node:fs'
import { SAMPLE_DATA_PATH, sampleData, serialize } from './sample-data.js'

const data = sampleData()
writeFileSync(SAMPLE_DATA_PATH, serialize(data))
console.log(`Wrote ${data.entities.length} entities and ${data.history.length} attribute histories to ${SAMPLE_DATA_PATH}`)
