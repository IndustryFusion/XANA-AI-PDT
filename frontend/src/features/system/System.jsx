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

import { useState } from 'react'
import HealthSection from './HealthSection'
import KnowledgeBase from './KnowledgeBase'
import ServiceSettings from './ServiceSettings'
import SessionSection from './SessionSection'
import './system.css'

/**
 * System area: dependency health, service settings, the session, and the
 * knowledge base the agent retrieves from.
 */
export default function System() {
  const [round, setRound] = useState(0)
  const checkAgain = () => setRound((r) => r + 1)
  return (
    <section className="page system" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">System</h1>
      </div>
      <div className="system__top">
        <HealthSection round={round} onCheckAgain={checkAgain} />
        <div className="stack">
          <ServiceSettings onSaved={checkAgain} />
          <SessionSection />
        </div>
      </div>
      <KnowledgeBase />
    </section>
  )
}
