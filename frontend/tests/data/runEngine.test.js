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

import { createStore } from '../../src/data/sources/mock/store'
import { createRunEngine } from '../../src/data/sources/mock/runEngine'
import { createRunRecord } from '../../src/data/sources/mock/runCore'

const NOW = Date.parse('2026-11-02T12:00:00Z')

function memoryStorage() {
  const data = new Map()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
}

function setup({ speed = 1, scenario = 'happy_path', storage = memoryStorage() } = {}) {
  const store = createStore({ storage, now: NOW })
  const speedRef = { value: speed }
  const engine = createRunEngine(store, { speed: () => speedRef.value })
  const run = createRunRecord({ runId: 'run-t1', machineId: 'urn:ngsi-ld:Machine:press-brake-01', issue: 'Test', scenario, at: new Date(NOW).toISOString() })
  engine.add(run)
  const events = []
  const unsubscribe = engine.subscribe('run-t1', (e) => events.push(e))
  return { store, engine, events, speedRef, storage, unsubscribe }
}

const stored = (store) => store.get().runs.find((r) => r.runId === 'run-t1')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('steps and status events arrive over time in the documented order, then the run waits', async () => {
  const { events, store } = setup()
  expect(events).toEqual([])
  await vi.advanceTimersByTimeAsync(899)
  expect(events).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(events.map((e) => e.node ?? e.status)).toEqual(['observe'])

  await vi.advanceTimersByTimeAsync(20_000)
  expect(events.map((e) => (e.type === 'step' ? e.node : `status:${e.status}`))).toEqual([
    'observe', 'retrieve_documents', 'hypothesize', 'retrieve_similar_incidents', 'validate', 'decide', 'status:awaiting_confirmation',
  ])
  expect(events.at(-1)).toMatchObject({ type: 'status', data: { rootCause: expect.any(String), confidence: expect.any(Number) }, summary: { runId: 'run-t1', status: 'awaiting_confirmation' } })

  await vi.advanceTimersByTimeAsync(60_000)
  expect(events).toHaveLength(7)
  expect(stored(store)).toMatchObject({ status: 'awaiting_confirmation', wait: 'start' })
})

test('every change is stored, so getRun and a reload see the same state', async () => {
  const { store, events } = setup()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(stored(store).steps.map((s) => s.node)).toEqual(events.filter((e) => e.type === 'step').map((e) => e.node))
  expect(stored(store).incidentId).toEqual(expect.any(Number))
})

test('an operator action continues a waiting run', async () => {
  const { engine, events } = setup()
  await vi.advanceTimersByTimeAsync(20_000)
  events.length = 0
  expect(engine.perform('run-t1', 'confirmResolution', { confirmed: true })).toEqual({ status: 'running' })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(events.map((e) => e.node ?? e.status)).toEqual(['resolution', 'running', 'act', 'completed'])
})

test('a run waiting for the confirmation of a resolution can be escalated to the machine builder', async () => {
  const { engine } = setup()
  await vi.advanceTimersByTimeAsync(20_000)
  const result = engine.perform('run-t1', 'escalate')
  expect(result).toMatchObject({ status: 'awaiting_machine_builder', escalationRef: expect.stringMatching(/^ESC-/) })
})

test('actions that the waiting stage does not accept are conflicts', async () => {
  const { engine } = setup()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(() => engine.perform('run-t1', 'clarify', { text: 'x' })).toThrow(expect.objectContaining({ kind: 'conflict' }))
})

test('playback speed scales the delays between events', async () => {
  const { events } = setup({ speed: 10 })
  await vi.advanceTimersByTimeAsync(89)
  expect(events).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(events).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(events.at(-1)).toMatchObject({ type: 'status', status: 'awaiting_confirmation' })
})

test('an interrupted connection delivers nothing, then a snapshot with what changed meanwhile', async () => {
  const { engine, events } = setup({ scenario: 'escalation_within_tier' })
  await vi.advanceTimersByTimeAsync(20_000)
  engine.perform('run-t1', 'escalate')
  await vi.advanceTimersByTimeAsync(20_000)
  events.length = 0

  engine.interrupt('run-t1')
  expect(events).toEqual([{ type: 'connection', state: 'reconnecting' }])
  engine.perform('run-t1', 'sendConversationAct', { act: 'request', text: 'Is a spare part needed?' })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(events).toHaveLength(1)

  engine.restore('run-t1')
  const snapshot = events.at(-1)
  expect(snapshot.type).toBe('snapshot')
  const messages = snapshot.run.steps.filter((s) => s.node === 'message').map((s) => s.output)
  expect(messages.at(-1)).toMatchObject({ sender: 'machine_builder', act: 'request' })
  expect(snapshot.run.outbox.at(-1).status).toBe('delivered')
})

test('after a reload, a new engine resumes the stored run', async () => {
  const storage = memoryStorage()
  const first = setup({ storage })
  await vi.advanceTimersByTimeAsync(2_500)
  first.engine.reset()
  const played = stored(first.store).steps.length
  expect(played).toBeGreaterThan(0)

  const store = createStore({ storage, now: NOW })
  const engine = createRunEngine(store, { speed: () => 1 })
  engine.ensure('run-t1')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(stored(store).status).toBe('awaiting_confirmation')
  expect(stored(store).steps.length).toBeGreaterThan(played)
})

test('reset stops all timers', async () => {
  const { engine, events } = setup()
  engine.reset()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(events).toEqual([])
})
