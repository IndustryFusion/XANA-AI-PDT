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

import { act, renderHook, waitFor } from '@testing-library/react'
import { entities } from '../../src/data'
import { GAVE_UP, healthState, RECONNECT_MS, STABLE_MS, useLiveUpdates } from '../../src/features/explorer/useLiveUpdates'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('live-update indicator', () => {
  test('the backend state decides: active works, setting up is connecting, anything else is unavailable', () => {
    expect(healthState({ status: 'ok', state: 'active' })).toBe('ok')
    expect(healthState({ status: 'unavailable', state: 'connecting' })).toBe('connecting')
    expect(healthState({ status: 'unavailable', state: 'waiting_for_sign_in' })).toBe('connecting')
    expect(healthState({ status: 'unavailable', state: 'subscription_failed' })).toBe('unavailable')
    expect(healthState({ status: 'ok' })).toBe('ok')
  })

  test('just after sign-in the indicator says connecting, not unavailable', async () => {
    vi.spyOn(entities, 'getLiveUpdateHealth').mockResolvedValue({ status: 'unavailable', state: 'waiting_for_sign_in', detail: 'Live updates start after sign-in.' })
    vi.spyOn(entities, 'subscribeEntities').mockReturnValue(() => {})
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'] }))
    await waitFor(() => expect(entities.getLiveUpdateHealth).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.status).toBe('connecting')
  })

  test('unavailable shows the backend reason', async () => {
    vi.spyOn(entities, 'getLiveUpdateHealth').mockResolvedValue({ status: 'unavailable', state: 'subscription_failed', detail: 'Live updates could not be set up.' })
    vi.spyOn(entities, 'subscribeEntities').mockReturnValue(() => {})
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'] }))
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.detail).toBe('Live updates could not be set up.')
  })

  test('after the stream closes it checks again with a back-off and reconnects, reading what is shown again', async () => {
    vi.useFakeTimers()
    const health = vi.spyOn(entities, 'getLiveUpdateHealth').mockResolvedValue({ status: 'ok', state: 'active', detail: null })
    const handlers = []
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => { handlers.push(onEvent); return () => {} })
    const onResync = vi.fn()
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'], onResync }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('ok')
    expect(handlers).toHaveLength(1)

    act(() => handlers[0]({ type: 'error', error: new Error('The live updates connection was lost.') }))
    expect(result.current.status).toBe('unavailable')
    expect(result.current.detail).toBe('The live updates connection was lost.')
    const before = health.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_MS[0]) })
    expect(health.mock.calls.length).toBe(before + 1)
    expect(result.current.status).toBe('ok')
    expect(handlers).toHaveLength(2)
    expect(onResync).toHaveBeenCalledTimes(1)
  })

  test('a recovery through connecting also reconnects and reads again; the back-off starts afresh', async () => {
    vi.useFakeTimers()
    const answers = [{ status: 'ok', state: 'active' }]
    const health = vi.spyOn(entities, 'getLiveUpdateHealth').mockImplementation(async () => ({ detail: null, ...answers.at(-1) }))
    const handlers = []
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => { handlers.push(onEvent); return () => {} })
    const onResync = vi.fn()
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'], onResync }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(handlers).toHaveLength(1)

    answers.push({ status: 'unavailable', state: 'connecting' })
    act(() => handlers[0]({ type: 'error', error: new Error('lost') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_MS[0]) })
    expect(result.current.status).toBe('connecting')
    expect(handlers).toHaveLength(1)

    answers.push({ status: 'ok', state: 'active' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.status).toBe('ok')
    expect(handlers).toHaveLength(2)
    expect(onResync).toHaveBeenCalledTimes(1)

    // The reopened stream stays open long enough to count as working: a later outage gets the fast first retry again.
    await act(async () => { await vi.advanceTimersByTimeAsync(STABLE_MS) })
    const before = health.mock.calls.length
    act(() => handlers[1]({ type: 'error', error: new Error('lost again') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_MS[0]) })
    expect(health.mock.calls.length).toBe(before + 1)
    expect(handlers).toHaveLength(3)
  })

  test('an outage reported only by the health check, with the stream still open, also reads again', async () => {
    vi.useFakeTimers()
    const answers = [{ status: 'ok', state: 'active' }]
    vi.spyOn(entities, 'getLiveUpdateHealth').mockImplementation(async () => ({ detail: null, ...answers.at(-1) }))
    const handlers = []
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => { handlers.push(onEvent); return () => {} })
    const onResync = vi.fn()
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'], onResync }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    answers.push({ status: 'unavailable', state: 'broker_unavailable' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.status).toBe('unavailable')
    answers.push({ status: 'ok', state: 'active' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.status).toBe('ok')
    expect(onResync).toHaveBeenCalledTimes(1)
    expect(handlers).toHaveLength(2)
  })

  test('a stream that fails at once while the health says working is retried with a thinning back-off, then given up', async () => {
    vi.useFakeTimers()
    const health = vi.spyOn(entities, 'getLiveUpdateHealth').mockResolvedValue({ status: 'ok', state: 'active', detail: null })
    const handlers = []
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => {
      handlers.push(onEvent)
      queueMicrotask(() => onEvent({ type: 'error', error: new Error('refused') }))
      return () => {}
    })
    const onResync = vi.fn()
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'], onResync }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const opened = []
    for (const wait of [...RECONNECT_MS, 10_000, 10_000, 10_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(wait) })
      opened.push(handlers.length)
    }
    // Opened once, then once after each step of the back-off, and then no more.
    expect(handlers).toHaveLength(1 + RECONNECT_MS.length)
    expect(opened.at(-1)).toBe(opened.at(-3))
    expect(result.current.status).toBe('unavailable')
    expect(result.current.detail).toBe(GAVE_UP)
    expect(onResync).toHaveBeenCalledTimes(RECONNECT_MS.length)
    expect(health).toHaveBeenCalled()
  })

  test('after giving up, an outage the backend reports is tried again once it is over', async () => {
    vi.useFakeTimers()
    const answers = [{ status: 'ok', state: 'active' }]
    vi.spyOn(entities, 'getLiveUpdateHealth').mockImplementation(async () => ({ detail: null, ...answers.at(-1) }))
    let failing = true
    const handlers = []
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => {
      handlers.push(onEvent)
      if (failing) queueMicrotask(() => onEvent({ type: 'error', error: new Error('refused') }))
      return () => {}
    })
    const { result } = renderHook(() => useLiveUpdates({ enabled: true, ids: ['urn:a'] }))
    for (let i = 0; i < 12; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.detail).toBe(GAVE_UP)
    const given = handlers.length
    failing = false
    answers.push({ status: 'unavailable', state: 'broker_unavailable' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    answers.push({ status: 'ok', state: 'active' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(handlers.length).toBe(given + 1)
    expect(result.current.status).toBe('ok')
  })

  async function givenUp(answers, extra = {}) {
    vi.spyOn(entities, 'getLiveUpdateHealth').mockImplementation(async () => ({ detail: null, ...answers.at(-1) }))
    const control = { failing: true, handlers: [] }
    vi.spyOn(entities, 'subscribeEntities').mockImplementation((_params, onEvent) => {
      control.handlers.push(onEvent)
      if (control.failing) queueMicrotask(() => onEvent({ type: 'error', error: new Error('refused') }))
      return () => {}
    })
    const hook = renderHook((props) => useLiveUpdates({ ids: ['urn:a'], ...props }), { initialProps: { enabled: true, ...extra } })
    for (let i = 0; i < 12; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(hook.result.current.detail).toBe(GAVE_UP)
    return { ...hook, control }
  }

  test('switching live updates off and on again starts afresh after giving up', async () => {
    vi.useFakeTimers()
    const { result, rerender, control } = await givenUp([{ status: 'ok', state: 'active' }])
    control.failing = false
    rerender({ enabled: false })
    expect(result.current.status).toBe('off')
    rerender({ enabled: true })
    expect(result.current.status).toBe('connecting')
    expect(result.current.detail).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.status).toBe('ok')
    expect(result.current.detail).toBeNull()
  })

  test('after giving up, a recovery through connecting is tried again', async () => {
    vi.useFakeTimers()
    const answers = [{ status: 'ok', state: 'active' }]
    const { result, control } = await givenUp(answers)
    const given = control.handlers.length
    control.failing = false
    answers.push({ status: 'unavailable', state: 'connecting' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.status).toBe('connecting')
    answers.push({ status: 'ok', state: 'active' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(control.handlers.length).toBe(given + 1)
    expect(result.current.status).toBe('ok')
  })
})
