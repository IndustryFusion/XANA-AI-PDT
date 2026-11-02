import { useEffect, useId, useState } from 'react'
import { knowledgeBase } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, EmptyState, ErrorState, LoadingState, StatusBadge, useToast } from '../../ui/components'
import { formatDate, formatSize } from '../../ui/format'
import { ConfirmDialog } from '../../ui/structured'
import { ACCEPT, ACTIVE_INGEST, documentProblem, INGEST_POLL_MS, PIPELINE_INFO, readAsDataUrl } from './documents'

/**
 * Knowledge base: documents of the selected ingestion pipeline, upload by
 * drop or file picker with progress, description edit, delete, and a test
 * query showing the ranked passages retrieval returns.
 */
export default function KnowledgeBase() {
  const [pipeline, setPipeline] = useState('base')
  const docs = useData('knowledgeBase', 'listDocuments', [{ pipeline }])
  const jobs = useIngestJobs(docs)
  const [refused, setRefused] = useState([])
  const [deleting, setDeleting] = useState(null)
  const notify = useToast()
  const info = PIPELINE_INFO.find((p) => p.id === pipeline)

  async function addFiles(fileList) {
    const problems = []
    let added = 0
    for (const file of [...fileList]) {
      const problem = documentProblem(file)
      if (problem) {
        problems.push(`${file.name} was refused: ${problem}.`)
        continue
      }
      try {
        const dataUrl = await readAsDataUrl(file)
        await knowledgeBase.uploadDocument({ file: { name: file.name, type: file.type, size: file.size, dataUrl }, pipeline })
        added++
      } catch (err) {
        problems.push(`${file.name} was not uploaded: ${err.message}`)
      }
    }
    setRefused(problems)
    if (added) {
      notify(`${added} ${added === 1 ? 'document' : 'documents'} added to the ${info.label.toLowerCase()}; ingestion started.`)
      docs.refresh()
    }
  }

  return (
    <Card title="Knowledge base" className="knowledge-base">
      <div className="stack">
        <p className="muted">Manuals, maintenance procedures and specification sheets the agent retrieves from when it reasons about an incident.</p>
        <fieldset className="pipeline-switch">
          <legend className="field__label">Ingestion pipeline</legend>
          {PIPELINE_INFO.map((p) => (
            <label key={p.id} className="pipeline-option">
              <input type="radio" name="kb-pipeline" value={p.id} checked={pipeline === p.id} onChange={() => { setPipeline(p.id); setRefused([]) }} />
              <span className="pipeline-option__text">
                <strong>{p.label}</strong>
                <span className="muted">{p.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <DropZone onFiles={addFiles} pipelineLabel={info.label} />
        {refused.length > 0 && (
          <div className="form-error" role="alert">
            <ul className="plain-list" aria-label="Files not added">
              {refused.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}

        <DataView
          result={docs}
          errorTitle="Could not load the documents"
          isEmpty={(list) => list.length === 0}
          empty={<EmptyState title="No documents have been ingested yet.">Drop documents above or choose files to add them to the {info.label.toLowerCase()}.</EmptyState>}
        >
          {(list) => (
            <DocumentTable
              key={pipeline} documents={list} jobs={jobs} pipeline={pipeline}
              caption={`Documents in the ${info.label.toLowerCase()}`}
              onChanged={docs.refresh} onDelete={setDeleting}
            />
          )}
        </DataView>

        <TestQuery key={pipeline} pipeline={pipeline} pipelineLabel={info.label} />
      </div>
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        confirmLabel="Delete"
        variant="danger"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await knowledgeBase.deleteDocument(deleting.name, { pipeline: deleting.pipeline })
          notify(`${deleting.name} was deleted.`)
          docs.refresh()
        }}
      >
        {deleting && <p>{deleting.name} is removed from the {PIPELINE_INFO.find((p) => p.id === deleting.pipeline)?.label.toLowerCase()}; retrieval no longer returns its passages.</p>}
      </ConfirmDialog>
    </Card>
  )
}

/** Polls the ingestion jobs of listed documents every second until they finish, then reloads the list. */
function useIngestJobs(docs) {
  const [jobs, setJobs] = useState({})
  const active = (docs.data ?? []).filter((d) => d.jobId && ACTIVE_INGEST.includes(d.status)).map((d) => d.jobId)
  const activeKey = active.join(',')
  const { refresh } = docs

  useEffect(() => {
    if (!activeKey) return undefined
    const ids = activeKey.split(',')
    let cancelled = false
    const id = setInterval(async () => {
      const settled = await Promise.allSettled(ids.map((jobId) => knowledgeBase.getIngestJob(jobId)))
      if (cancelled) return
      const found = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)
      setJobs((all) => ({ ...all, ...Object.fromEntries(found.map((j) => [j.jobId, j])) }))
      if (found.length < ids.length || found.some((j) => !ACTIVE_INGEST.includes(j.status))) refresh()
    }, INGEST_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeKey, refresh])

  return jobs
}

function DropZone({ onFiles, pipelineLabel }) {
  const [dragging, setDragging] = useState(false)
  const inputId = useId()
  const hintId = useId()

  function drop(e) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files)
  }

  return (
    <div
      className={`drop-zone${dragging ? ' drop-zone--active' : ''}`}
      role="group" aria-label="Add documents"
      onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <p className="drop-zone__title">Drop documents here to add them to the {pipelineLabel.toLowerCase()}</p>
      <p id={hintId} className="muted">PDF, Word (.docx) or Markdown, up to 50 MB each.</p>
      <label className="field drop-zone__picker" htmlFor={inputId}>
        <span className="field__label">Or choose files</span>
        <input
          id={inputId} type="file" multiple accept={ACCEPT} aria-describedby={hintId}
          onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; onFiles(files) }}
        />
      </label>
    </div>
  )
}

function DocumentTable({ documents, jobs, pipeline, caption, onChanged, onDelete }) {
  return (
    <div className="table-wrap">
      <table className="table document-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Status</th>
            <th scope="col">Added</th>
            <th scope="col">Chunks</th>
            <th scope="col">Description</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => {
            const job = d.jobId ? jobs[d.jobId] : null
            const status = job && ACTIVE_INGEST.includes(d.status) ? job.status : d.status
            const progress = job?.progress ?? d.progress
            return (
              <tr key={d.name} data-document={d.name}>
                <th scope="row">
                  {d.name}
                  <span className="muted document-table__size">{formatSize(d.size)}</span>
                </th>
                <td>
                  <StatusBadge kind="ingest" value={status} />
                  {ACTIVE_INGEST.includes(status) && progress != null && (
                    <span className="ingest-progress">
                      <progress max="100" value={Math.round(progress * 100)} aria-label={`Ingestion progress of ${d.name}`} />
                      <span>{Math.round(progress * 100)} %</span>
                    </span>
                  )}
                  {status === 'failed' && d.error && <span className="field__error document-table__error">{d.error}</span>}
                </td>
                <td><time dateTime={d.uploadedAt}>{formatDate(d.uploadedAt)}</time></td>
                <td>{d.status === 'done' ? d.chunks : <span className="muted">—</span>}</td>
                <td><Description document={d} pipeline={pipeline} onSaved={onChanged} /></td>
                <td><Button size="sm" onClick={() => onDelete(d)} aria-label={`Delete ${d.name}`}>Delete…</Button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Description({ document: doc, pipeline, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(doc.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputId = useId()

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await knowledgeBase.updateDescription(doc.name, text, { pipeline })
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="description">
        {doc.description ? <span>{doc.description}</span> : <span className="muted">No description.</span>}
        <Button size="sm" variant="ghost" onClick={() => { setText(doc.description); setEditing(true) }} aria-label={`Edit description of ${doc.name}`}>Edit</Button>
      </div>
    )
  }
  return (
    <form className="stack description__form" onSubmit={save} aria-label={`Editing the description of ${doc.name}`}>
      <label className="visually-hidden" htmlFor={inputId}>Description of {doc.name}</label>
      <textarea id={inputId} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus rows={2} />
      {error && <span className="field__error" role="alert">{error}</span>}
      <div className="row">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>Save description</Button>
        <Button size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}

function TestQuery({ pipeline, pipelineLabel }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  const inputId = useId()

  async function run(e) {
    e.preventDefault()
    if (!text.trim()) {
      setState({ status: 'invalid' })
      return
    }
    setState({ status: 'loading' })
    try {
      setState({ status: 'success', results: await knowledgeBase.query({ text, pipeline }) })
    } catch (error) {
      setState({ status: 'error', error })
    }
  }

  return (
    <section className="stack test-query" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`}>Test retrieval</h3>
      <form className="row test-query__form" onSubmit={run} noValidate>
        <div className="field test-query__field">
          <label className="field__label" htmlFor={inputId}>Question</label>
          <input id={inputId} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. burr on 3 mm steel" aria-invalid={state.status === 'invalid' ? 'true' : undefined} />
        </div>
        <Button type="submit" variant="primary">Run test query</Button>
      </form>
      <p className="muted">Searches the {pipelineLabel.toLowerCase()} and shows the passages retrieval returns, most relevant first.</p>
      {state.status === 'invalid' && <p className="form-error" role="alert">Enter a question.</p>}
      {state.status === 'loading' && <LoadingState label="Searching…" />}
      {state.status === 'error' && <ErrorState title="The test query failed" error={state.error} />}
      {state.status === 'success' && (state.results.length === 0
        ? <EmptyState title="No passages were found." />
        : (
          <ol className="passages" aria-label="Retrieved passages">
            {state.results.map((r, i) => (
              <li key={`${r.document}-${r.location}`} className="passage">
                <div className="row passage__head">
                  <strong>{r.document}</strong>
                  <span className="muted">{r.location}</span>
                  <span className="passage__score">Score {r.score.toFixed(2)}</span>
                  <span className="visually-hidden">, rank {i + 1}</span>
                </div>
                <blockquote className="passage__text">{r.text}</blockquote>
              </li>
            ))}
          </ol>
        ))}
    </section>
  )
}
