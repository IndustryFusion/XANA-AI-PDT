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

import { areas } from '../../src/data'
import { addressProblem } from '../../src/data/sources/mock/systemArea'
import { writeControls } from '../../src/data/sources/mock/controls'
import { resetMock } from '../helpers'

const { system } = areas
const check = async (id) => (await system.getHealth()).checks.find((c) => c.id === id)
const setting = async (key) => (await system.getServiceSettings()).find((s) => s.key === key)

beforeEach(() => resetMock())

describe('health', () => {
  test('all dependencies OK by default, with latency and the address in use', async () => {
    const health = await system.getHealth()
    expect(health.overall).toBe('ok')
    expect(health.checks.map((c) => c.id)).toEqual(['context-broker', 'timeseries', 'memory', 'alerts', 'message-broker', 'llm', 'gateway', 'knowledge-base'])
    expect(health.checks.every((c) => c.status === 'ok' && c.latencyMs > 0)).toBe(true)
    expect(await check('message-broker')).toMatchObject({ detail: 'Reached at mqtt://message-broker.example.org:1883' })
  })

  test('one failing dependency makes the overall health degraded', async () => {
    writeControls({ gatewayReachable: false })
    const health = await system.getHealth()
    expect(health.overall).toBe('degraded')
    expect(health.checks.find((c) => c.id === 'gateway')).toMatchObject({ status: 'error', latencyMs: null, detail: expect.any(String) })
    expect(health.checks.filter((c) => c.status === 'ok')).toHaveLength(7)
  })
})

describe('service settings', () => {
  test('deployment values, unchanged', async () => {
    const settings = await system.getServiceSettings()
    expect(settings.map((s) => s.label)).toEqual(['Context broker', 'Time-series store', 'Message broker', 'Alert manager'])
    expect(settings.every((s) => !s.changed && s.value === s.deploymentValue)).toBe(true)
  })

  test('a saved address is marked as changed and used by the next health check', async () => {
    const saved = await system.saveServiceSettings({ contextBroker: 'https://broker-2.example.org/ngsi-ld/v1' })
    expect(saved.find((s) => s.key === 'contextBroker')).toMatchObject({ value: 'https://broker-2.example.org/ngsi-ld/v1', changed: true })
    expect((await check('context-broker')).detail).toBe('Reached at https://broker-2.example.org/ngsi-ld/v1')
  })

  test('an address that does not answer shows as an error', async () => {
    await system.saveServiceSettings({ alertManager: 'http://alerts.invalid:8080' })
    expect(await check('alerts')).toMatchObject({ status: 'error', detail: 'No response from http://alerts.invalid:8080.' })
    expect((await system.getHealth()).overall).toBe('degraded')
  })

  test('reset returns to the deployment value', async () => {
    await system.saveServiceSettings({ messageBroker: 'mqtt://other.example.org:1883' })
    await system.saveServiceSettings({ messageBroker: null })
    expect(await setting('messageBroker')).toMatchObject({ value: 'mqtt://message-broker.example.org:1883', changed: false })
  })

  test('invalid addresses and unknown settings are refused and nothing is saved', async () => {
    await expect(system.saveServiceSettings({ contextBroker: 'broker:9090 ' , timeseriesStore: 'https://ok.example.org' })).rejects.toMatchObject({ kind: 'invalid' })
    expect((await setting('timeseriesStore')).changed).toBe(false)
    await expect(system.saveServiceSettings({ database: 'http://x.example.org' })).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('accepted schemes', () => {
    for (const ok of ['http://a.example.org', 'https://a.example.org:1', 'ws://a.example.org', 'wss://a.example.org', 'mqtt://a.example.org:1883']) expect(addressProblem(ok)).toBeNull()
    expect(addressProblem('ftp://a.example.org')).toMatch(/Use one of/)
    expect(addressProblem('not a url')).toBe('Not a valid URL.')
  })
})
