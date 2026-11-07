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

import { screen } from '@testing-library/react'
import * as backend from '../../src/data/sources/backend'
import * as mock from '../../src/data/sources/mock'
import { areas, KNOWLEDGE_BASE_ENABLED, bindArea } from '../../src/data'
import { AREAS, OPERATIONS } from '../../src/data/interface'
import { analysis } from '../../src/data/sources/mock/scenarios/stages'
import { contentFor } from '../../src/data/sources/mock/scenarios/content'
import { renderApp, resetMock } from '../helpers'

const openSystem = () => renderApp({ path: '/system', controls: { authEnabled: false } })

const analysisOf = () => {
  const content = contentFor('urn:ngsi-ld:Machine:laser-cutter-01')
  return { content, events: analysis({ run: { round: 1, rejected: [], issue: 'Burr on the parts' }, content }) }
}

beforeEach(() => resetMock())

describe.skipIf(KNOWLEDGE_BASE_ENABLED)('knowledge base off (default)', () => {
  test('the setting is off', () => {
    expect(import.meta.env.VITE_KNOWLEDGE_BASE).toBeUndefined()
    expect(KNOWLEDGE_BASE_ENABLED).toBe(false)
  })

  test('the data layer has no knowledge base area on either source', () => {
    expect(AREAS).not.toContain('knowledgeBase')
    expect(OPERATIONS.knowledgeBase).toBeUndefined()
    expect(areas.knowledgeBase).toBeUndefined()
    expect(mock.knowledgeBase).toBeUndefined()
    expect(backend.knowledgeBase).toBeUndefined()
  })

  test('the mock holds no documents, so a backend build cannot show any', () => {
    expect(mock.store.get().kb).toBeUndefined()
  })

  test('health has no knowledge base check', async () => {
    const health = await areas.system.getHealth()
    expect(health.checks.map((c) => c.id)).not.toContain('knowledge-base')
  })

  test('the System screen shows no knowledge base', async () => {
    openSystem()
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Knowledge base' })).not.toBeInTheDocument()
    expect(screen.queryByText(/knowledge base/i)).not.toBeInTheDocument()
  })

  test('a simulated run retrieves no documents and cites no manuals', () => {
    const { content, events } = analysisOf()
    const steps = events.map((e) => e.step?.node).filter(Boolean)
    expect(steps).not.toContain('retrieve_documents')
    const text = JSON.stringify(events)
    for (const manual of content.manuals) expect(text).not.toContain(manual)
  })

  test('a simulated run still looks up similar incidents', () => {
    const steps = analysisOf().events.map((e) => e.step?.node)
    expect(steps).toContain('retrieve_similar_incidents')
  })
})

describe.runIf(KNOWLEDGE_BASE_ENABLED)('knowledge base on', () => {
  test('the setting is on', () => {
    expect(import.meta.env.VITE_KNOWLEDGE_BASE).toBe('on')
  })

  test('the area exists, on the backend source only to say that it is not available', async () => {
    expect(AREAS).toContain('knowledgeBase')
    expect(typeof areas.knowledgeBase.listDocuments).toBe('function')
    expect(typeof mock.knowledgeBase.listDocuments).toBe('function')
    expect(backend.knowledgeBase).toBeUndefined()
    await expect(bindArea('knowledgeBase', backend.knowledgeBase).listDocuments()).rejects.toMatchObject({ kind: 'unavailable' })
  })

  test('the System screen shows the knowledge base', async () => {
    openSystem()
    expect(await screen.findByRole('region', { name: 'Knowledge base' })).toBeInTheDocument()
  })

  test('health has a knowledge base check', async () => {
    const health = await areas.system.getHealth()
    expect(health.checks.map((c) => c.id)).toContain('knowledge-base')
  })

  test('a simulated run retrieves documents and still looks up similar incidents', () => {
    const steps = analysisOf().events.map((e) => e.step?.node)
    expect(steps).toContain('retrieve_documents')
    expect(steps).toContain('retrieve_similar_incidents')
  })
})
