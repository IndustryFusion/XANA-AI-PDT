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

import { DataError } from '../../errors'
import { applyControls, currentControls } from './controls'
import { chunkCount, KB_SIZE_LIMIT, PIPELINES } from './kbContent'

/**
 * Mock implementation of the `knowledgeBase` area: documents per ingestion
 * pipeline, simulated ingestion jobs and retrieval by term overlap.
 */

/** Ingestion advances in steps of this duration (divided by the playback speed). */
export const INGEST_STEP_MS = 800
const STEPS = 5
/** Ingestion of a file whose name contains this word fails, to demonstrate failure. */
export const FAILING_NAME = 'corrupt'
export const FAILURE_REASON = 'The document could not be parsed: the file is damaged or encrypted.'
const MAX_RESULTS = 5

export const DOCUMENT_TYPES = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  markdown: ['text/markdown', 'text/x-markdown', 'text/plain'],
}

/** Why a file cannot be ingested, or null. Accepted by extension and MIME type. */
export function fileProblem({ name, type, size }) {
  const ext = String(name ?? '').toLowerCase().split('.').pop()
  const types = DOCUMENT_TYPES[ext]
  if (!types || (type && !types.includes(type))) return 'Only PDF, Word (.docx) and Markdown documents can be ingested.'
  if (size > KB_SIZE_LIMIT) return 'The file is larger than 50 MB.'
  return null
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'what', 'when', 'how', 'why', 'does', 'are', 'was', 'from', 'that', 'this', 'which', 'after', 'before', 'into', 'our'])
const terms = (text) => [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length > 2 && !STOP_WORDS.has(t))

/** Passages of an ingested file: Markdown is split into its sections; other files yield their title. */
function extractPassages({ name, type, dataUrl }) {
  const markdown = /\.(md|markdown)$/i.test(name) || type === 'text/markdown'
  const text = markdown ? decodeDataUrl(dataUrl) : null
  if (!text) return [{ location: 'page 1', text: `${name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}.` }]
  const sections = []
  let current = { location: 'section 1', lines: [] }
  for (const line of text.slice(0, 20_000).split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      if (current.lines.join(' ').trim()) sections.push(current)
      current = { location: `section ${heading[1].trim()}`, lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.join(' ').trim()) sections.push(current)
  return sections.map((s) => ({ location: s.location, text: s.lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600) }))
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:[^,]*?(;base64)?,(.*)$/s)
  if (!match) return null
  try {
    if (!match[1]) return decodeURIComponent(match[2])
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function createKnowledgeBaseArea(store) {
  const withControls = (fn) => async (...args) => {
    await applyControls('knowledgeBase')
    advance()
    return fn(...args)
  }
  const fail = (kind, message) => new DataError('knowledgeBase', kind, message)
  const speed = () => Number(currentControls().speed) || 1

  function pipelineOf(pipeline) {
    const p = pipeline ?? 'base'
    if (!PIPELINES.includes(p)) throw fail('invalid', `Unknown pipeline ${p}; use ${PIPELINES.join(' or ')}.`)
    return p
  }

  /** Moves every running job forward according to the time elapsed since it started. */
  function advance() {
    const now = Date.now()
    const running = Object.values(store.get().kb.jobs).filter((j) => ['queued', 'processing'].includes(j.status))
    if (running.length === 0) return
    store.update((s) => {
      for (const job of Object.values(s.kb.jobs)) {
        if (!['queued', 'processing'].includes(job.status)) continue
        const step = Math.min(STEPS, Math.floor(((now - job.startedAt) * speed()) / INGEST_STEP_MS))
        job.progress = step / STEPS
        job.status = step === 0 ? 'queued' : 'processing'
        const doc = s.kb.documents.find((d) => d.jobId === job.jobId)
        if (job.fails && step >= 3) {
          Object.assign(job, { status: 'failed', error: FAILURE_REASON, passages: [] })
        } else if (step === STEPS) {
          job.status = 'done'
          job.chunks = chunkCount(job.size, job.passages.length)
          s.kb.passages.push(...job.passages.map((p) => ({ document: job.name, pipeline: job.pipeline, ...p })))
          job.passages = []
        }
        if (doc) Object.assign(doc, { status: job.status, chunks: job.chunks ?? 0, error: job.error ?? null })
      }
      return s
    })
  }

  const findDocument = (name, pipeline) => store.get().kb.documents.find((d) => d.name === name && d.pipeline === pipeline)
  const jobResult = ({ jobId, name, pipeline, status, progress, error, chunks }) =>
    ({ jobId, name, pipeline, status, progress, error: error ?? null, chunks: chunks ?? null })

  return {
    listDocuments: withControls(({ pipeline } = {}) => {
      const p = pipelineOf(pipeline)
      const { documents, jobs } = store.get().kb
      return documents
        .filter((d) => d.pipeline === p)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.name.localeCompare(b.name))
        .map((d) => ({ ...structuredClone(d), progress: d.jobId && jobs[d.jobId] ? jobs[d.jobId].progress : null }))
    }),

    uploadDocument: withControls(({ file, pipeline } = {}) => {
      const p = pipelineOf(pipeline)
      if (!file?.name) throw fail('invalid', 'Choose a file to upload.')
      const problem = fileProblem(file)
      if (problem) throw fail('invalid', `${file.name}: ${problem}`)
      if (findDocument(file.name, p)) throw fail('conflict', `${file.name} is already in this pipeline; delete it first to ingest it again.`)
      let jobId
      store.update((s) => {
        jobId = `job-${s.counters.job++}`
        s.kb.jobs[jobId] = {
          jobId, name: file.name, pipeline: p, status: 'queued', progress: 0, error: null, chunks: null,
          size: file.size, startedAt: Date.now(), fails: file.name.toLowerCase().includes(FAILING_NAME), passages: extractPassages(file),
        }
        s.kb.documents.push({ name: file.name, pipeline: p, status: 'queued', uploadedAt: new Date().toISOString(), size: file.size, chunks: 0, description: '', error: null, jobId })
        return s
      })
      return { jobId }
    }),

    getIngestJob: withControls((jobId) => {
      const job = store.get().kb.jobs[jobId]
      if (!job) throw fail('not_found', `Ingestion job ${jobId} does not exist.`)
      return jobResult(job)
    }),

    updateDescription: withControls((name, description, { pipeline } = {}) => {
      const p = pipelineOf(pipeline)
      if (!findDocument(name, p)) throw fail('not_found', `${name} is not in the ${p} pipeline.`)
      store.update((s) => {
        s.kb.documents.find((d) => d.name === name && d.pipeline === p).description = String(description ?? '').trim()
        return s
      })
    }),

    deleteDocument: withControls((name, { pipeline } = {}) => {
      const p = pipelineOf(pipeline)
      const doc = findDocument(name, p)
      if (!doc) throw fail('not_found', `${name} is not in the ${p} pipeline.`)
      store.update((s) => {
        s.kb.documents = s.kb.documents.filter((d) => !(d.name === name && d.pipeline === p))
        s.kb.passages = s.kb.passages.filter((x) => !(x.document === name && x.pipeline === p))
        if (doc.jobId) delete s.kb.jobs[doc.jobId]
        return s
      })
    }),

    query: withControls(({ text, pipeline } = {}) => {
      const p = pipelineOf(pipeline)
      const wanted = terms(text)
      if (wanted.length === 0) throw fail('invalid', 'Enter a question.')
      const done = new Set(store.get().kb.documents.filter((d) => d.pipeline === p && d.status === 'done').map((d) => d.name))
      return store.get().kb.passages
        .filter((x) => x.pipeline === p && done.has(x.document))
        .map((x) => {
          const words = terms(`${x.location} ${x.text}`)
          const hits = wanted.filter((t) => words.some((w) => w === t || (t.length > 4 && w.startsWith(t.slice(0, -1)))))
          return { document: x.document, location: x.location, text: x.text, score: Math.round((hits.length / wanted.length) * 100) / 100 }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.document.localeCompare(b.document) || a.location.localeCompare(b.location))
        .slice(0, MAX_RESULTS)
    }),
  }
}
