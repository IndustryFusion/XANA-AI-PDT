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

import { Fragment, useEffect, useId, useState } from 'react'
import { Button, Dialog } from './components'
import { formatSize, humanize, percent } from './format'
import { CONFIDENCE, confidenceLevel } from './status'

/* ── ConfidenceMeter ────────────────────────────────────────────────────── */

/**
 * Confidence as percentage text, a bar and its level (high, medium, low),
 * coloured by level; the text carries the meaning.
 */
export function ConfidenceMeter({ value, label = 'Confidence' }) {
  if (value == null) return null
  const pct = Math.max(0, Math.min(1, Number(value)))
  const level = confidenceLevel(pct)
  const { label: levelLabel, tone } = CONFIDENCE[level]
  return (
    <span className={`confidence confidence--${tone}`} data-level={level}>
      {label && <span className="confidence__label">{label}</span>}
      <strong className="confidence__value">{percent(pct)}</strong>
      <span className="confidence__bar" aria-hidden="true"><span style={{ width: percent(pct) }} /></span>
      <span className="confidence__level">{levelLabel}</span>
    </span>
  )
}

/* ── StructuredFields ───────────────────────────────────────────────────── */

const RATIO_KEYS = /confidence|relevance|similarity|threshold/i
const isPlain = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

function FieldValue({ name, value }) {
  if (value === null || value === undefined || value === '') return <span className="muted">None</span>
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && RATIO_KEYS.test(name) && value <= 1) return percent(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">None</span>
    if (value.every(isPlain)) return <ul className="structured__list">{value.map((v, i) => <li key={i}><FieldValue name={name} value={v} /></li>)}</ul>
    return <ol className="structured__list structured__list--items">{value.map((v, i) => <li key={i}><StructuredFields value={v} /></li>)}</ol>
  }
  if (typeof value === 'object') return <StructuredFields value={value} />
  return String(value)
}

/** Structured output as labelled fields (never raw JSON). */
export function StructuredFields({ value, omit = [] }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return <FieldValue name="" value={value} />
  const entries = Object.entries(value).filter(([k]) => !omit.includes(k))
  if (entries.length === 0) return <span className="muted">No details.</span>
  return (
    <dl className="structured">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{humanize(k)}</dt>
          <dd><FieldValue name={k} value={v} /></dd>
        </Fragment>
      ))}
    </dl>
  )
}

/* ── ConfirmDialog ──────────────────────────────────────────────────────── */

/**
 * Asks for confirmation before an action. While `onConfirm` runs the dialog
 * is busy; if it fails, the dialog stays open and shows the reason.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary', onConfirm, onClose, canConfirm = true }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { if (open) setError(null) }, [open])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      setBusy(false)
      onClose()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={title}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          {canConfirm && <Button variant={variant} onClick={confirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>}
        </>
      )}
    >
      <div className="stack">
        {children}
        {error && <p className="form-error" role="alert">{error.message}</p>}
      </div>
    </Dialog>
  )
}

/* ── FileAttachments ────────────────────────────────────────────────────── */

export const FILE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxFiles: 5, accept: 'image/*,application/pdf,text/plain' }

const allowedType = (type) => type.startsWith('image/') || type === 'application/pdf' || type === 'text/plain'

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * File picker for clarifications and rejections. Files are read in the
 * browser into `{ name, type, size, dataUrl }`; size, count and type limits
 * are enforced here.
 */
export function FileAttachments({ files, onChange, disabled = false }) {
  const [problems, setProblems] = useState([])
  const inputId = useId()

  async function onSelect(e) {
    const selected = [...e.target.files]
    e.target.value = ''
    const rejected = []
    const accepted = []
    for (const file of selected) {
      if (files.length + accepted.length >= FILE_LIMITS.maxFiles) rejected.push(`${file.name} was not added: at most ${FILE_LIMITS.maxFiles} files per submission.`)
      else if (file.size > FILE_LIMITS.maxBytes) rejected.push(`${file.name} is larger than 10 MB.`)
      else if (!allowedType(file.type)) rejected.push(`${file.name} is not an image, PDF or text file.`)
      else accepted.push({ name: file.name, type: file.type, size: file.size, dataUrl: await readAsDataUrl(file) })
    }
    setProblems(rejected)
    if (accepted.length) onChange([...files, ...accepted])
  }

  return (
    <div className="files">
      <label className="field" htmlFor={inputId}>
        <span className="field__label">Attach files (optional)</span>
        <input id={inputId} type="file" multiple accept={FILE_LIMITS.accept} onChange={onSelect} disabled={disabled} />
      </label>
      <p className="muted files__hint">Images, PDF or text; up to {FILE_LIMITS.maxFiles} files of 10 MB each.</p>
      {problems.length > 0 && (
        <ul className="form-error files__problems" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {files.length > 0 && (
        <ul className="files__list" aria-label="Attached files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="row">
              <span>{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
