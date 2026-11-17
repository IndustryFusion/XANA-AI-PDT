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

import { useId, useState } from 'react'
import { system } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, useToast } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'

/** Where an allowed context comes from, in words. */
export const CONTEXT_SOURCES = {
  core: 'NGSI-LD core',
  built_in: 'Built in',
  deployment: 'Deployment',
  added: 'Added here',
}

/** What allowing any context means: said before every addition. */
export const CONTEXT_RISK = 'When an imported entity names this context, the context broker fetches it from inside the platform, without checks. Whoever controls the address decides what the entity’s names mean, and a redirect or a changed address can make the broker fetch from a service inside the platform. Only allow addresses you trust.'

/**
 * The JSON-LD contexts an imported entity may name: the NGSI-LD core, the built-in ones, the deployment's,
 * and those added here. Adding one asks the backend what it risks and warns before it is allowed.
 */
export default function AllowedContexts() {
  const result = useData('system', 'listAllowedContexts')
  return (
    <Card title="Allowed contexts" className="allowed-contexts">
      <p className="muted">
        An imported entity may name only these JSON-LD contexts. An entry ending in <span className="mono">/</span> allows every context below it.
      </p>
      <DataView result={result} errorTitle="Could not load the allowed contexts">
        {(list) => <ContextList list={list} onChanged={result.refresh} />}
      </DataView>
    </Card>
  )
}

function ContextList({ list, onChanged }) {
  const notify = useToast()
  const [removing, setRemoving] = useState(null)
  return (
    <div className="stack">
      {list.detail && <p className="muted" role="status">{list.detail}</p>}
      <ul className="allowed-contexts__list" aria-label="Allowed contexts">
        {list.contexts.map((c) => (
          <li key={`${c.source}:${c.url}`} className="allowed-contexts__item">
            <span className="mono allowed-contexts__url" title={c.url}>{c.url}</span>
            <span className="muted allowed-contexts__source">{CONTEXT_SOURCES[c.source] ?? c.source}</span>
            {c.removable && list.editable && (
              <Button size="sm" onClick={() => setRemoving(c.url)} aria-label={`Remove ${c.url}`}>Remove…</Button>
            )}
          </li>
        ))}
      </ul>
      {list.editable
        ? <AddContext onAdded={onChanged} />
        : <p className="muted">Contexts can be added on a backend with a memory database; here the list comes from the deployment.</p>}
      <ConfirmDialog
        open={!!removing}
        title="Remove this allowed context?"
        confirmLabel="Remove"
        variant="danger"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await system.removeAllowedContext(removing)
          notify(`No longer allowed: ${removing}`, 'success')
          onChanged()
        }}
      >
        <p>Entities that name <span className="mono">{removing}</span> can&apos;t be imported any more. Entities already in the broker stay as they are.</p>
      </ConfirmDialog>
    </div>
  )
}

function AddContext({ onAdded }) {
  const notify = useToast()
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const ids = { url: useId(), error: useId() }

  async function check(e) {
    e.preventDefault()
    const clean = url.trim()
    if (!clean) {
      setError('Enter the context’s URL.')
      return
    }
    setChecking(true)
    setError(null)
    try {
      const { risks } = await system.checkContext(clean)
      setConfirming({ url: clean, risks })
    } catch (err) {
      setError(err.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <form className="form-row allowed-contexts__add" onSubmit={check} aria-label="Allow a context" noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.url}>Context URL</label>
        <input
          id={ids.url} className="mono" value={url} placeholder="https://…" autoComplete="off" disabled={checking}
          aria-invalid={error ? 'true' : undefined} aria-describedby={error ? ids.error : undefined}
          onChange={(e) => { setUrl(e.target.value); setError(null) }}
        />
      </div>
      <Button type="submit" disabled={checking}>{checking ? 'Checking…' : 'Allow…'}</Button>
      {error && <p id={ids.error} className="form-error" role="alert">{error}</p>}
      <ConfirmDialog
        open={!!confirming}
        title="Allow this context?"
        confirmLabel={confirming?.risks.length ? 'Allow anyway' : 'Allow'}
        variant="danger"
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          try {
            await system.allowContext(confirming.url)
          } catch (err) {
            setError(err.message)
            return
          }
          notify(`Allowed: ${confirming.url}`, 'success')
          setUrl('')
          onAdded()
        }}
      >
        <p className="mono allowed-contexts__url">{confirming?.url}</p>
        <p>{CONTEXT_RISK}</p>
        {confirming?.risks.length > 0 && (
          <div className="allowed-contexts__risks" role="alert">
            <strong>This address also:</strong>
            <ul>{confirming.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
      </ConfirmDialog>
    </form>
  )
}
