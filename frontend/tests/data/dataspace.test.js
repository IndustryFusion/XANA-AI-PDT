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

import { areas, CONNECTION_CHANGED, onDataEvent } from '../../src/data'
import { engine, store } from '../../src/data/sources/mock'
import { MOCK_DATASPACE_SECRET } from '../../src/data/sources/mock/dataspaceArea'
import { readControls, writeControls } from '../../src/data/sources/mock/controls'
import { resetMock } from '../helpers'

const { dataspace } = areas
const request = (id) => store.get().dataspace.capabilityRequests.find((r) => r.id === id)
const here = async (peerId, capability) => (await dataspace.getPeerCapabilities(peerId)).here.find((c) => c.capability === capability).status

beforeEach(() => resetMock())

describe('connection', () => {
  test('connected by default, with participant, expiry and the configured tier', async () => {
    expect(await dataspace.getConnection()).toMatchObject({
      state: 'connected', participantId: 'participant-plant-north', expiresAt: expect.any(String), credentialConfigured: false, sharingTier: 'minimal',
    })
  })

  test('disconnect, then connect with the credential', async () => {
    await dataspace.disconnect()
    expect(await dataspace.getConnection()).toMatchObject({ state: 'disconnected', expiresAt: null })
    await expect(dataspace.listPeers()).rejects.toMatchObject({ kind: 'unavailable' })
    const connection = await dataspace.connect({ secret: MOCK_DATASPACE_SECRET })
    expect(connection.state).toBe('connected')
    expect(Date.parse(connection.expiresAt)).toBeGreaterThan(Date.now())
    expect(await dataspace.listPeers()).toHaveLength(4)
  })

  test('a rejected credential and an unreachable gateway are distinct errors', async () => {
    await dataspace.disconnect()
    await expect(dataspace.connect({ secret: 'wrong' })).rejects.toMatchObject({ area: 'dataspace', kind: 'unauthorized' })
    writeControls({ gatewayReachable: false })
    await expect(dataspace.connect({ secret: MOCK_DATASPACE_SECRET })).rejects.toMatchObject({ kind: 'unavailable' })
    expect((await dataspace.getConnection()).state).toBe('disconnected')
  })

  test('no credential is needed when the configuration provides it', async () => {
    writeControls({ credentialConfigured: true })
    await dataspace.disconnect()
    expect((await dataspace.getConnection()).credentialConfigured).toBe(true)
    expect((await dataspace.connect()).state).toBe('connected')
  })

  test('connecting replaces a preset state of the development controls', async () => {
    writeControls({ connection: 'expired' })
    expect((await dataspace.getConnection()).state).toBe('expired')
    await dataspace.connect({ secret: MOCK_DATASPACE_SECRET })
    expect(readControls().connection).toBeNull()
    expect((await dataspace.getConnection()).state).toBe('connected')
  })

  test('a session past its expiry is expired', async () => {
    store.update((s) => { s.connection.expiresAt = new Date(Date.now() - 1000).toISOString(); return s })
    expect((await dataspace.getConnection()).state).toBe('expired')
  })

  test('not configured: no identity, and connect or disconnect are conflicts', async () => {
    writeControls({ connection: 'not_configured' })
    expect(await dataspace.getConnection()).toMatchObject({ state: 'not_configured', participantId: null, sharingTier: null })
    await expect(dataspace.connect({ secret: MOCK_DATASPACE_SECRET })).rejects.toMatchObject({ kind: 'conflict' })
    await expect(dataspace.disconnect()).rejects.toMatchObject({ kind: 'conflict' })
  })

  test('the facade announces successful connection changes only', async () => {
    const changes = vi.fn()
    const off = onDataEvent(CONNECTION_CHANGED, changes)
    await dataspace.disconnect()
    await dataspace.connect({ secret: 'wrong' }).catch(() => {})
    expect(changes).toHaveBeenCalledTimes(1)
    await dataspace.connect({ secret: MOCK_DATASPACE_SECRET })
    expect(changes).toHaveBeenCalledTimes(2)
    off()
  })

  test('runs cannot escalate while disconnected', async () => {
    await dataspace.disconnect()
    engine.reset()
    expect((await areas.runs.escalationPreflight('run-1002')).possible).toBe(false)
  })
})

describe('peers and policies', () => {
  test('capabilities in both directions with granted, denied or default status', async () => {
    const caps = await dataspace.getPeerCapabilities('peer-formwerk')
    expect(caps).toMatchObject({ peerId: 'peer-formwerk', name: 'Formwerk Press Technology' })
    expect(caps.atPeer).toEqual([{ capability: 'twin:direct', status: 'granted' }, { capability: 'twin:adjacents', status: 'default' }])
    expect(caps.here).toEqual([
      { capability: 'twin:direct', status: 'granted' },
      { capability: 'twin:adjacents', status: 'default' },
      { capability: 'twin:history', status: 'denied' },
    ])
    await expect(dataspace.getPeerCapabilities('peer-nope')).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('grant, deny and reset a capability', async () => {
    const policy = (action) => dataspace.setCapabilityPolicy({ peerId: 'peer-surfacetec', capability: 'twin:history', action })
    await policy('grant')
    expect(await here('peer-surfacetec', 'twin:history')).toBe('granted')
    await policy('deny')
    expect(await here('peer-surfacetec', 'twin:history')).toBe('denied')
    await policy('reset')
    expect(await here('peer-surfacetec', 'twin:history')).toBe('default')
  })

  test('invalid policy changes are rejected', async () => {
    await expect(dataspace.setCapabilityPolicy({ peerId: 'peer-formwerk', capability: 'twin:history', action: 'allow' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(dataspace.setCapabilityPolicy({ peerId: 'peer-formwerk', capability: 'twin:everything', action: 'grant' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(dataspace.setCapabilityPolicy({ peerId: 'peer-nope', capability: 'twin:history', action: 'grant' })).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('capability requests', () => {
  test('pending requests first, newest first', async () => {
    const list = await dataspace.listCapabilityRequests()
    expect(list.map((r) => r.status)).toEqual(['pending', 'pending', 'pending', 'approved', 'denied'])
    expect(list[0]).toMatchObject({ id: 'req-005', requesterId: 'peer-formwerk', capability: 'twin:history' })
  })

  test('approving grants the capability to the requester', async () => {
    expect(await here('peer-formwerk', 'twin:history')).toBe('denied')
    const updated = await dataspace.decideCapabilityRequest('req-005', { approved: true, note: ' For the service visit. ' })
    expect(updated).toMatchObject({ status: 'approved', note: 'For the service visit.', decidedAt: expect.any(String) })
    expect(await here('peer-formwerk', 'twin:history')).toBe('granted')
  })

  test('denying leaves the policy unchanged', async () => {
    await dataspace.decideCapabilityRequest('req-004', { approved: false })
    expect(request('req-004')).toMatchObject({ status: 'denied', note: null })
    expect(await here('peer-surfacetec', 'twin:adjacents')).toBe('default')
  })

  test('a request decided meanwhile is a conflict and stays as decided', async () => {
    await dataspace.decideCapabilityRequest('req-003', { approved: false })
    await expect(dataspace.decideCapabilityRequest('req-003', { approved: true })).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('already denied') })
    expect(request('req-003').status).toBe('denied')
    await expect(dataspace.decideCapabilityRequest('req-nope', { approved: true })).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('registry', () => {
  test('resolves participant names and machine builders; unknown IDs are omitted', async () => {
    expect(await dataspace.resolveNames(['peer-hydroservice', 'peer-formwerk', 'peer-unknown'])).toEqual({
      'peer-hydroservice': 'HydroService Maintenance', 'peer-formwerk': 'Formwerk Press Technology',
    })
    expect(await dataspace.resolveBuilders(['urn:ngsi-ld:Machine:chiller-01', 'urn:ngsi-ld:Machine:nope'])).toEqual({
      'urn:ngsi-ld:Machine:chiller-01': 'CoolFlow Process Cooling',
    })
  })
})
