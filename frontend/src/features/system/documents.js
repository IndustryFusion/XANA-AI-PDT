/** Upload rules of the knowledge base: PDF, Word and Markdown, by extension and MIME type, up to 50 MB. */

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

const MARKDOWN = ['text/markdown', 'text/x-markdown', 'text/plain']
export const DOCUMENT_TYPES = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  md: MARKDOWN,
  markdown: MARKDOWN,
}

export const ACCEPT = [...Object.keys(DOCUMENT_TYPES).map((ext) => `.${ext}`), ...new Set(Object.values(DOCUMENT_TYPES).flat())].join(',')

/** Why a file is refused, or null. An empty MIME type (unknown to the browser) is judged by the extension. */
export function documentProblem(file) {
  const ext = file.name.toLowerCase().split('.').pop()
  const types = DOCUMENT_TYPES[ext]
  if (!types || (file.type && !types.includes(file.type))) return 'only PDF, Word (.docx) and Markdown documents can be added'
  if (file.size > MAX_DOCUMENT_BYTES) return 'the file is larger than 50 MB'
  return null
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** The ingestion pipelines and what each is suited for. */
export const PIPELINE_INFO = [
  { id: 'base', label: 'Base pipeline', description: 'Indexes the text of each page. Faster; suited to manuals and procedures that are mostly running text.' },
  { id: 'structured', label: 'Structured pipeline', description: 'Section-aware. Slower; better for documents with tables and diagrams, such as specification sheets and spare-part lists.' },
]

export const ACTIVE_INGEST = ['queued', 'processing']
export const INGEST_POLL_MS = 1000
