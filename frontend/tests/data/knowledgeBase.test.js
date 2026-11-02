import { areas } from '../../src/data'
import { store } from '../../src/data/sources/mock'
import { FAILURE_REASON, fileProblem, INGEST_STEP_MS } from '../../src/data/sources/mock/knowledgeBaseArea'
import { writeControls } from '../../src/data/sources/mock/controls'
import { resetMock } from '../helpers'

const { knowledgeBase: kb } = areas
const MB = 1024 * 1024

const markdown = (name, text) => ({ name, type: 'text/markdown', size: text.length, dataUrl: `data:text/markdown;base64,${btoa(text)}` })
const pdf = (name, size = 2 * MB) => ({ name, type: 'application/pdf', size, dataUrl: 'data:application/pdf;base64,JVBERi0=' })

beforeEach(() => resetMock())
afterEach(() => vi.useRealTimers())

describe('documents per pipeline', () => {
  test('each pipeline lists its own documents, newest first', async () => {
    const base = await kb.listDocuments({ pipeline: 'base' })
    const structured = await kb.listDocuments({ pipeline: 'structured' })
    expect(base.map((d) => d.name)).toContain('PB-2200 hydraulic maintenance.pdf')
    expect(structured.map((d) => d.name)).toContain('PB-2200 spare parts catalogue.pdf')
    expect(base.every((d) => d.pipeline === 'base')).toBe(true)
    expect([...base].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))).toEqual(base)
    expect(base.find((d) => d.status === 'failed')).toMatchObject({ name: 'Scanned wiring diagrams.pdf', error: expect.stringContaining('scanned images') })
  })

  test('an unknown pipeline is invalid', async () => {
    await expect(kb.listDocuments({ pipeline: 'fast' })).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('description edit and delete', async () => {
    await kb.updateDescription('Shift handover checklist.md', '  Checks per line.  ', { pipeline: 'base' })
    expect((await kb.listDocuments()).find((d) => d.name === 'Shift handover checklist.md').description).toBe('Checks per line.')
    await kb.deleteDocument('Shift handover checklist.md', { pipeline: 'base' })
    expect((await kb.listDocuments()).map((d) => d.name)).not.toContain('Shift handover checklist.md')
    await expect(kb.deleteDocument('Shift handover checklist.md', { pipeline: 'base' })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(kb.updateDescription('nope.pdf', 'x', { pipeline: 'base' })).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('upload and ingestion', () => {
  test('progress advances in steps until done, with chunks; the document becomes searchable', async () => {
    vi.useFakeTimers()
    const { jobId } = await kb.uploadDocument({ file: markdown('Torque table.md', '# Torque values\nTighten the gauge screws with 12 Nm.\n# Lubrication\nGrease the ball screw monthly.'), pipeline: 'base' })
    expect(await kb.getIngestJob(jobId)).toMatchObject({ status: 'queued', progress: 0 })
    expect((await kb.listDocuments()).find((d) => d.name === 'Torque table.md')).toMatchObject({ status: 'queued', jobId, progress: 0 })
    const documents = async (pipeline) => (await kb.query({ text: 'gauge screws torque', pipeline })).map((r) => r.document)
    expect(await documents('base')).not.toContain('Torque table.md')

    vi.advanceTimersByTime(INGEST_STEP_MS * 2)
    expect(await kb.getIngestJob(jobId)).toMatchObject({ status: 'processing', progress: 0.4 })
    vi.advanceTimersByTime(INGEST_STEP_MS * 3)
    const job = await kb.getIngestJob(jobId)
    expect(job).toMatchObject({ status: 'done', progress: 1, chunks: 2, error: null })
    expect((await kb.listDocuments()).find((d) => d.name === 'Torque table.md')).toMatchObject({ status: 'done', chunks: 2 })

    const [top] = await kb.query({ text: 'gauge screws torque', pipeline: 'base' })
    expect(top).toMatchObject({ document: 'Torque table.md', location: 'section Torque values', score: 1 })
    expect(await documents('structured')).not.toContain('Torque table.md')
  })

  test('the playback speed shortens ingestion', async () => {
    vi.useFakeTimers()
    writeControls({ speed: 25 })
    const { jobId } = await kb.uploadDocument({ file: pdf('Valve datasheet.pdf'), pipeline: 'structured' })
    vi.advanceTimersByTime(200)
    expect((await kb.getIngestJob(jobId)).status).toBe('done')
  })

  test('a corrupt file fails with the reason and can be removed', async () => {
    vi.useFakeTimers()
    const { jobId } = await kb.uploadDocument({ file: pdf('corrupt-manual.pdf'), pipeline: 'base' })
    vi.advanceTimersByTime(INGEST_STEP_MS * 5)
    expect(await kb.getIngestJob(jobId)).toMatchObject({ status: 'failed', error: FAILURE_REASON })
    expect((await kb.listDocuments()).find((d) => d.name === 'corrupt-manual.pdf')).toMatchObject({ status: 'failed', error: FAILURE_REASON })
    await kb.deleteDocument('corrupt-manual.pdf', { pipeline: 'base' })
    await expect(kb.getIngestJob(jobId)).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('unsupported types, oversized files and duplicates are refused', async () => {
    await expect(kb.uploadDocument({ file: { name: 'photo.png', type: 'image/png', size: 10 }, pipeline: 'base' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(kb.uploadDocument({ file: pdf('huge.pdf', 51 * MB), pipeline: 'base' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('50 MB') })
    await expect(kb.uploadDocument({ file: pdf('PB-2200 hydraulic maintenance.pdf'), pipeline: 'base' })).rejects.toMatchObject({ kind: 'conflict' })
    expect(Object.keys(store.get().kb.jobs)).toHaveLength(0)
  })

  test('files are accepted by extension and MIME type', () => {
    expect(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 1 })).toBeNull()
    expect(fileProblem({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1 })).toBeNull()
    expect(fileProblem({ name: 'a.md', type: '', size: 1 })).toBeNull()
    expect(fileProblem({ name: 'a.pdf', type: 'image/png', size: 1 })).toMatch(/Only PDF/)
    expect(fileProblem({ name: 'a.doc', type: 'application/msword', size: 1 })).toMatch(/Only PDF/)
  })
})

describe('test retrieval', () => {
  test('ranks passages by term overlap, with document, location and score', async () => {
    const results = await kb.query({ text: 'Burr on the parts: protective window?', pipeline: 'base' })
    expect(results[0]).toMatchObject({ document: 'LC-3015 operating manual.pdf', location: 'page 112' })
    expect(results.map((r) => r.score)).toEqual([...results.map((r) => r.score)].sort((a, b) => b - a))
    expect(results.every((r) => r.score > 0 && r.score <= 1)).toBe(true)
  })

  test('is deterministic', async () => {
    const q = { text: 'hydraulic pressure drop valve', pipeline: 'base' }
    expect(await kb.query(q)).toEqual(await kb.query(q))
  })

  test('nothing found, and an empty question', async () => {
    expect(await kb.query({ text: 'xylophone zeppelin', pipeline: 'structured' })).toEqual([])
    await expect(kb.query({ text: '  ', pipeline: 'base' })).rejects.toMatchObject({ kind: 'invalid' })
  })
})
