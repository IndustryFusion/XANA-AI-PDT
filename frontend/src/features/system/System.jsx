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
