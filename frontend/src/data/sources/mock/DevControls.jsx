import { useEffect, useState } from 'react'
import { AREAS } from '../../interface'
import { Button, Dialog } from '../../../ui/components'
import { FAILURE_MODES, onControlsChange, readControls, writeControls } from './controls'
import { STORE_KEY } from './store'

const CONNECTION_STATES = ['connected', 'expired', 'disconnected', 'not_configured']

/**
 * Floating panel for the mock source's development controls. Rendered only
 * in development builds (the data facade exports it as null otherwise).
 */
export default function DevControls() {
  const [open, setOpen] = useState(false)
  const [controls, setControls] = useState(readControls)

  useEffect(() => onControlsChange(setControls), [])

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
            <select value={controls.connection} onChange={(e) => update({ connection: e.target.value })}>
              {CONNECTION_STATES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
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
