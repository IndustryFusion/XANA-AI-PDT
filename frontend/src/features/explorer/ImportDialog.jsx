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

import { useEffect, useId, useState } from 'react'
import { entities } from '../../data'
import { Button, Dialog, StatusBadge } from '../../ui/components'
import { Iri, shortenText } from './Iri'

const URI = /^[a-z][\w+.-]*:\S+$/i
const PREVIEW_ROWS = 50

/**
 * Checks a parsed document before import: a list of NGSI-LD entities (or a
 * single entity), each with an ID (URI) and a type. Returns the entities and
 * the problems found.
 */
export function checkDocument(document) {
  const list = Array.isArray(document) ? document : document && typeof document === 'object' ? [document] : null
  if (!list) return { entities: [], problems: ['The document is not an NGSI-LD entity or a list of entities.'] }
  if (list.length === 0) return { entities: [], problems: ['The document contains no entities.'] }
  const problems = []
  list.forEach((e, i) => {
    const label = `Entry ${i + 1}${typeof e?.id === 'string' ? ` (${shortenText(e.id)})` : ''}`
    if (!e || typeof e !== 'object' || Array.isArray(e)) problems.push(`${label} is not an entity object.`)
    else if (typeof e.id !== 'string' || !URI.test(e.id)) problems.push(`${label} has no ID; an entity ID must be a URI such as urn:ngsi-ld:Machine:m-01.`)
    else if (typeof e.type !== 'string' || !e.type) problems.push(`${label} has no type.`)
  })
  return { entities: list, problems }
}

/** Parses file text into the preview state. */
export function previewText(text, source) {
  try {
    return { source, ...checkDocument(JSON.parse(text)) }
  } catch (err) {
    return { source, entities: [], problems: [`The file is not valid JSON: ${err.message}`] }
  }
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

const attributeCount = (e) => Object.keys(e).filter((k) => !['id', 'type', '@context'].includes(k)).length

/**
 * Import of entities from a JSON file or a URL: preview with validation,
 * then the result per entity.
 */
export default function ImportDialog({ open, onClose, onImported }) {
  const [mode, setMode] = useState('file')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ids = { file: useId(), url: useId(), mode: useId() }

  useEffect(() => {
    if (!open) return
    setMode('file')
    setUrl('')
    setPreview(null)
    setResults(null)
    setError(null)
  }, [open])

  async function onFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setError(null)
    setResults(null)
    setPreview(previewText(await readText(file), file.name))
  }

  async function fetchUrl(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const { url: fetched, document } = await entities.fetchImportDocument(url)
      setPreview({ source: fetched, ...checkDocument(document) })
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      setResults(await entities.importEntities(preview.entities))
      onImported()
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  const canImport = preview && preview.problems.length === 0 && !results
  const counts = results && ['created', 'updated', 'failed'].map((r) => `${results.filter((x) => x.result === r).length} ${r}`).join(', ')

  return (
    <Dialog
      open={open}
      title="Import entities"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>{results ? 'Done' : 'Cancel'}</Button>
          {canImport && <Button variant="primary" onClick={runImport} disabled={busy}>{busy ? 'Importing…' : `Import ${preview.entities.length} entities`}</Button>}
        </>
      )}
    >
      <div className="stack">
        {!results && (
          <>
            <fieldset className="plain-fieldset row" aria-labelledby={ids.mode}>
              <legend id={ids.mode} className="field__label">Source</legend>
              <label className="row"><input type="radio" name="import-mode" checked={mode === 'file'} onChange={() => { setMode('file'); setPreview(null); setError(null) }} /> JSON file</label>
              <label className="row"><input type="radio" name="import-mode" checked={mode === 'url'} onChange={() => { setMode('url'); setPreview(null); setError(null) }} /> URL</label>
            </fieldset>
            {mode === 'file' ? (
              <div className="field">
                <label className="field__label" htmlFor={ids.file}>File with NGSI-LD entities (JSON)</label>
                <input id={ids.file} type="file" accept=".json,.jsonld,application/json,application/ld+json" onChange={onFile} />
              </div>
            ) : (
              <form className="form-row import__url" onSubmit={fetchUrl}>
                <div className="field">
                  <label className="field__label" htmlFor={ids.url}>Document URL</label>
                  <input id={ids.url} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
                </div>
                <Button type="submit" disabled={busy || !url.trim()}>Fetch</Button>
              </form>
            )}
          </>
        )}

        {error && <p className="form-error" role="alert">{shortenText(error.message)}</p>}

        {preview && !results && (
          <section className="stack" aria-label="Preview">
            <h3 className="details__title">Preview of {preview.source}</h3>
            {preview.problems.length > 0 ? (
              <div role="alert" className="stack">
                <p className="form-error">This document cannot be imported:</p>
                <ul className="import__problems">{preview.problems.map((p) => <li key={p}>{shortenText(p)}</li>)}</ul>
              </div>
            ) : (
              <>
                <p>{preview.entities.length} entities are ready to import. <strong>Import replaces:</strong> an existing entity with the same ID is replaced by the one in the file, and its attributes that are not in the file are removed.</p>
                <div className="table-wrap">
                  <table className="table">
                    <caption className="visually-hidden">Entities to import</caption>
                    <thead><tr><th scope="col">ID</th><th scope="col">Type</th><th scope="col">Attributes</th></tr></thead>
                    <tbody>
                      {preview.entities.slice(0, PREVIEW_ROWS).map((e, i) => (
                        <tr key={`${e.id}-${i}`}><td className="mono"><Iri value={String(e.id)} /></td><td><Iri value={String(e.type)} /></td><td>{attributeCount(e)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.entities.length > PREVIEW_ROWS && <p className="muted">And {preview.entities.length - PREVIEW_ROWS} more.</p>}
              </>
            )}
          </section>
        )}

        {results && (
          <section className="stack" aria-label="Import results">
            <p role="status">Import finished: {counts}.</p>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Result per entity</caption>
                <thead><tr><th scope="col">ID</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={`${r.id}-${i}`}>
                      <td className="mono">{r.id ? <Iri value={r.id} /> : `Entry ${i + 1}`}</td>
                      <td><StatusBadge kind="import" value={r.result} /></td>
                      <td>{shortenText(r.reason ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  )
}
