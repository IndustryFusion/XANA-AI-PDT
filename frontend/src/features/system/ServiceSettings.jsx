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

import { Fragment, useEffect, useState } from 'react'
import { system } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, StatusBadge, useToast } from '../../ui/components'
import { addressProblem } from './address'

/**
 * Service addresses in use. Where they can be edited, values are validated before saving, and changed values are
 * marked and can be reset to the deployment value. On a backend they are read-only: they are set at deployment.
 */
export default function ServiceSettings({ onSaved }) {
  const result = useData('system', 'getServiceSettings')
  return (
    <Card title="Service settings" className="service-settings">
      <DataView result={result} errorTitle="Could not load the service settings">
        {(settings) => (settings.every((s) => s.editable === false)
          ? <SettingsList settings={settings} />
          : <SettingsForm settings={settings} onSaved={(saved) => { result.refresh(); onSaved(saved) }} />)}
      </DataView>
    </Card>
  )
}

function SettingsList({ settings }) {
  return (
    <div className="stack">
      <p className="muted">These addresses are set at deployment, and can&apos;t be changed here.</p>
      <dl className="details">
        {settings.map((s) => (
          <Fragment key={s.key}>
            <dt>{s.label}</dt>
            <dd className="mono" data-setting={s.key}>{s.value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

function SettingsForm({ settings, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(settings.map((s) => [s.key, s.value])))
  const [problems, setProblems] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const notify = useToast()

  useEffect(() => {
    setValues(Object.fromEntries(settings.map((s) => [s.key, s.value])))
  }, [settings])

  async function save(changes, message) {
    setBusy(true)
    setFormError(null)
    try {
      const saved = await system.saveServiceSettings(changes)
      notify(message, 'success')
      onSaved(saved)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function submit(e) {
    e.preventDefault()
    const found = {}
    for (const s of settings) {
      const problem = addressProblem(values[s.key])
      if (problem) found[s.key] = problem
    }
    setProblems(found)
    if (Object.keys(found).length > 0) {
      setFormError('Not saved: correct the marked addresses.')
      return
    }
    const changes = Object.fromEntries(settings.filter((s) => values[s.key].trim() !== s.value).map((s) => [s.key, values[s.key].trim()]))
    if (Object.keys(changes).length === 0) {
      setFormError(null)
      notify('No setting was changed.')
      return
    }
    save(changes, 'Service settings saved. The health check now uses them.')
  }

  function reset(setting) {
    setProblems((p) => ({ ...p, [setting.key]: undefined }))
    save({ [setting.key]: null }, `${setting.label} uses the deployment value again.`)
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Service settings" noValidate>
      <p className="muted">Addresses are URLs with the scheme http, https, ws, wss or mqtt. Saved values apply to the next health check.</p>
      {settings.map((s) => {
        const id = `setting-${s.key}`
        const problem = problems[s.key]
        return (
          <div key={s.key} className="field setting" data-setting={s.key}>
            <div className="row setting__head">
              <label className="field__label" htmlFor={id}>{s.label}</label>
              <StatusBadge kind="setting" value={s.changed ? 'changed' : 'deployment'} />
            </div>
            <input
              id={id} type="text" inputMode="url" spellCheck={false} autoComplete="off" value={values[s.key] ?? ''} disabled={busy}
              aria-invalid={problem ? 'true' : undefined} aria-describedby={problem ? `${id}-problem` : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
            />
            {problem && <span id={`${id}-problem`} className="field__error">{problem}</span>}
            {s.changed && (
              <div className="row setting__deployment">
                <span className="muted">Deployment value: <span className="mono">{s.deploymentValue}</span></span>
                <Button size="sm" onClick={() => reset(s)} disabled={busy} aria-label={`Reset to deployment value: ${s.label}`}>Reset to deployment value</Button>
              </div>
            )}
          </div>
        )
      })}
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </form>
  )
}
