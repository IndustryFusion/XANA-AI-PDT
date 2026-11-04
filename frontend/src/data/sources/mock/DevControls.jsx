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

import { useEffect, useState } from 'react'
import { AREAS } from '../../interface'
import { Button, Dialog } from '../../../ui/components'
import { FAILURE_MODES, onControlsChange, readControls, SPEEDS, writeControls } from './controls'
import { engine, store } from './instance'
import { SCENARIOS } from './scenarios'
import { OPEN_STATES } from './runCore'
import { STORE_KEY } from './store'

const CONNECTION_STATES = ['connected', 'expired', 'disconnected', 'not_configured']

/**
 * Floating panel for the mock source's development controls. Rendered only
 * in development builds (the data facade exports it as null otherwise).
 */
export default function DevControls() {
  const [open, setOpen] = useState(false)
  const [controls, setControls] = useState(readControls)
  const [, setInterruptions] = useState(0)

  useEffect(() => onControlsChange(setControls), [])

  const scenario = SCENARIOS.find((s) => s.id === controls.scenario) ?? SCENARIOS[0]
  const openRuns = open ? store.get().runs.filter((r) => OPEN_STATES.includes(r.status)) : []

  function toggleConnection(runId) {
    if (engine.isInterrupted(runId)) engine.restore(runId)
    else engine.interrupt(runId)
    setInterruptions((n) => n + 1)
  }

  const update = (patch) => setControls(writeControls(patch))
  const setArea = (key, area, value) => update({ [key]: { ...controls[key], [area]: value } })

  function resetData() {
    sessionStorage.removeItem(STORE_KEY)
    window.location.reload()
  }

  return (
    <>
      <Button className="dev-controls__toggle" size="sm" onClick={() => setOpen(true)}>Mock data controls</Button>
      <Dialog
        open={open}
        title="Mock data controls"
        onClose={() => setOpen(false)}
        footer={<><Button onClick={resetData}>Reset mock data</Button><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></>}
      >
        <div className="stack">
          <p className="muted">Development only. Changes apply to the next request; reload to apply everywhere.</p>
          <label className="row">
            <input type="checkbox" checked={controls.authEnabled} onChange={(e) => update({ authEnabled: e.target.checked })} />
            Sign-in required
          </label>
          <div className="row">
            <Button size="sm" onClick={() => update({ sessionRevision: (controls.sessionRevision ?? 0) + 1 })}>Expire session now</Button>
          </div>
          <label className="field">
            <span className="field__label">Dataspace connection</span>
            <select value={controls.connection ?? store.get().connection.state} onChange={(e) => update({ connection: e.target.value })}>
              {CONNECTION_STATES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="row">
            <input type="checkbox" checked={controls.gatewayReachable} onChange={(e) => update({ gatewayReachable: e.target.checked })} />
            Dataspace gateway reachable
          </label>
          <label className="row">
            <input type="checkbox" checked={controls.credentialConfigured} onChange={(e) => update({ credentialConfigured: e.target.checked })} />
            Configuration provides the dataspace credential
          </label>
          <div className="field">
            <label className="field__label" htmlFor="dev-scenario">Scenario for the next started run</label>
            <select id="dev-scenario" value={scenario.id} onChange={(e) => update({ scenario: e.target.value })}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="muted">{scenario.description}{scenario.actions.length > 0 && ` Operator: ${scenario.actions.join(' → ')}.`}</span>
          </div>
          <label className="field">
            <span className="field__label">Playback speed of simulated runs</span>
            <select value={controls.speed} onChange={(e) => update({ speed: Number(e.target.value) })}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Live entity updates</span>
            <select value={controls.liveUpdates} onChange={(e) => update({ liveUpdates: e.target.value })}>
              <option value="available">available</option>
              <option value="unavailable">unavailable</option>
            </select>
          </label>
          <label className="row">
            <input type="checkbox" checked={controls.newAlerts} onChange={(e) => update({ newAlerts: e.target.checked })} />
            Raise new alerts occasionally while the Alerts area is open
          </label>
          <table className="table">
            <caption>Live connection of open runs</caption>
            <thead>
              <tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Connection</th></tr>
            </thead>
            <tbody>
              {openRuns.length === 0 && <tr><td colSpan={3} className="muted">No open runs.</td></tr>}
              {openRuns.map((r) => (
                <tr key={r.runId}>
                  <th scope="row">{r.runId}</th>
                  <td>{r.status.replace(/_/g, ' ')}</td>
                  <td>
                    <Button size="sm" onClick={() => toggleConnection(r.runId)}>
                      {engine.isInterrupted(r.runId) ? `Restore connection of ${r.runId}` : `Interrupt connection of ${r.runId}`}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="table">
            <caption>Per-area behaviour</caption>
            <thead>
              <tr><th scope="col">Area</th><th scope="col">Added delay (ms)</th><th scope="col">Failure</th></tr>
            </thead>
            <tbody>
              {AREAS.map((area) => (
                <tr key={area}>
                  <th scope="row">{area}</th>
                  <td>
                    <input
                      type="number" min="0" step="250" aria-label={`${area} delay in milliseconds`}
                      value={controls.latencyMs[area] ?? 0}
                      onChange={(e) => setArea('latencyMs', area, Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <select aria-label={`${area} failure`} value={controls.failure[area] ?? 'none'} onChange={(e) => setArea('failure', area, e.target.value)}>
                      {FAILURE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  )
}
