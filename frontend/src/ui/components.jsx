import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { describeStatus } from './status'

/* ── Button ─────────────────────────────────────────────────────────────── */

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }) {
  return <button type={type} className={`btn btn--${variant} btn--${size} ${className}`.trim()} {...props} />
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

/** Status badge: always carries a text label; the tone only adds colour. */
export function StatusBadge({ kind, value, label, tone, className = '' }) {
  const described = describeStatus(kind, value)
  const text = label ?? described.label
  return (
    <span className={`badge badge--${tone ?? described.tone}${described.pulse ? ' badge--pulse' : ''} ${className}`.trim()} data-status={value}>
      <span className="badge__dot" aria-hidden="true" />
      {text}
    </span>
  )
}

/* ── Card ───────────────────────────────────────────────────────────────── */

export function Card({ title, titleId, actions, headingLevel = 2, children, className = '', ...props }) {
  const generatedId = useId()
  const headingId = titleId ?? generatedId
  const Heading = `h${headingLevel}`
  return (
    <section className={`card ${className}`.trim()} aria-labelledby={title ? headingId : undefined} {...props}>
      {(title || actions) && (
        <header className="card__header">
          {title && <Heading id={headingId} className="card__title">{title}</Heading>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  )
}

/* ── Table ──────────────────────────────────────────────────────────────── */

/**
 * columns: [{ key, header, render?(row) }]. The caption names the table for
 * assistive technology; pass hideCaption to keep it off screen.
 */
export function Table({ caption, hideCaption = false, columns, rows, rowKey = 'id', empty = 'No entries.' }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className={hideCaption ? 'visually-hidden' : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="muted">{empty}</td></tr>
          ) : rows.map((row) => (
            <tr key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey]}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

/** tabs: [{ id, label, content }]. Arrow keys move between tabs. */
export function Tabs({ label, tabs, value, onChange }) {
  const [internal, setInternal] = useState(tabs[0]?.id)
  const active = value ?? internal
  const select = onChange ?? setInternal
  const baseId = useId()
  const refs = useRef({})

  function onKeyDown(e) {
    const index = tabs.findIndex((t) => t.id === active)
    let next = null
    if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]
    if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]
    if (e.key === 'Home') next = tabs[0]
    if (e.key === 'End') next = tabs[tabs.length - 1]
    if (next) {
      e.preventDefault()
      select(next.id)
      refs.current[next.id]?.focus()
    }
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el }}
            role="tab"
            type="button"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            className="tabs__tab"
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.filter((t) => t.id === active).map((t) => (
        <div key={t.id} role="tabpanel" id={`${baseId}-panel-${t.id}`} aria-labelledby={`${baseId}-tab-${t.id}`} className="tabs__panel">
          {t.content}
        </div>
      ))}
    </div>
  )
}

/* ── Dialog ─────────────────────────────────────────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog. Focus moves in on open, is trapped while open, Escape closes
 * it unless `busy`, and focus returns to the opener on close.
 */
export function Dialog({ open, title, onClose, busy = false, children, footer }) {
  const ref = useRef(null)
  const titleId = useId()
  const openerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement
    const node = ref.current
    const first = node?.querySelector(FOCUSABLE)
    ;(first ?? node)?.focus()
    return () => {
      const opener = openerRef.current
      if (opener && typeof opener.focus === 'function') opener.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busy) onClose?.()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...ref.current.querySelectorAll(FOCUSABLE)]
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="dialog-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className="dialog" onKeyDown={onKeyDown}>
        <header className="dialog__header">
          <h2 id={titleId} className="dialog__title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close dialog">✕</Button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/* ── Toast ──────────────────────────────────────────────────────────────── */

const ToastContext = createContext(() => {})

export function ToastProvider({ children, timeoutMs = 5000 }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const notify = useCallback((message, tone = 'info') => {
    const id = nextId.current++
    setToasts((all) => [...all, { id, message, tone }])
    if (timeoutMs > 0) setTimeout(() => dismiss(id), timeoutMs)
  }, [dismiss, timeoutMs])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <span>{t.message}</span>
            <Button variant="ghost" size="sm" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">✕</Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/* ── Data state views ───────────────────────────────────────────────────── */

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {children && <div className="muted">{children}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Could not load data', error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{title}</p>
      {error?.message && <p className="muted">{error.message}</p>}
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  )
}

/**
 * Renders the standard loading / error / empty states for a data result from
 * useData, and the children (a function of the data) otherwise.
 */
export function DataView({ result, isEmpty, empty, errorTitle, loadingLabel, children }) {
  if (result.status === 'loading' && result.data === undefined) return <LoadingState label={loadingLabel} />
  if (result.status === 'error') return <ErrorState title={errorTitle} error={result.error} onRetry={result.retry} />
  if (isEmpty?.(result.data)) return empty
  return children(result.data)
}
