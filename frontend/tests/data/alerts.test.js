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
import { raiseAlert, store } from '../../src/data/sources/mock'
import { SEVERITY_RANK } from '../../src/data/sources/mock/alertsArea'
import { resetMock } from '../helpers'

const { alerts } = areas

beforeEach(() => resetMock())

const byStatus = (status) => store.get().alerts.filter((a) => a.status === status)

describe('listAlerts', () => {
  test('defaults to open and acknowledged alerts, most severe and newest first', async () => {
    const { alerts: list, total } = await alerts.listAlerts()
    expect(total).toBe(byStatus('open').length + byStatus('ack').length)
    expect(list.every((a) => ['open', 'ack'].includes(a.status))).toBe(true)
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]]
      const order = SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity)
      expect(order < 0 || (order === 0 && a.createTime >= b.createTime)).toBe(true)
    }
    expect(list[0].history).toBeUndefined()
  })

  test('filters by status, severity, environment, service and text', async () => {
    const all = (await alerts.listAlerts({ status: ['open', 'ack', 'shelved', 'closed'] })).alerts
    expect(all).toHaveLength(16)
    const env = (await alerts.listAlerts({ status: 'open,ack,shelved,closed', environment: 'Commissioning' })).alerts
    expect(env.length).toBeGreaterThan(0)
    expect(env.every((a) => a.environment === 'Commissioning')).toBe(true)
    const service = (await alerts.listAlerts({ service: 'Line B' })).alerts
    expect(service.every((a) => a.service.includes('Line B'))).toBe(true)
    const text = (await alerts.listAlerts({ status: ['open', 'ack', 'shelved', 'closed'], text: 'chiller' })).alerts
    expect(text.length).toBeGreaterThan(0)
    expect(text.every((a) => /chiller/i.test(a.text + a.resource))).toBe(true)
    const severity = all[0].severity
    const sev = await alerts.listAlerts({ status: 'open,ack,shelved,closed', severity })
    expect(sev.alerts.every((a) => a.severity === severity)).toBe(true)
    expect(sev.bySeverity).toEqual((await alerts.listAlerts({ status: 'open,ack,shelved,closed' })).bySeverity)
    expect((await alerts.listAlerts({ text: 'no such alert' })).total).toBe(0)
  })

  test('sorts by time when asked and pages results', async () => {
    const status = ['open', 'ack', 'shelved', 'closed']
    const { alerts: list } = await alerts.listAlerts({ status, sort: 'time' })
    expect(list.map((a) => a.createTime)).toEqual([...list.map((a) => a.createTime)].sort().reverse())
    const page2 = await alerts.listAlerts({ status, sort: 'time', page: 2, pageSize: 5 })
    expect(page2.alerts.map((a) => a.id)).toEqual(list.slice(5, 10).map((a) => a.id))
    expect(page2.total).toBe(16)
  })

  test('environments and services', async () => {
    expect(await alerts.listEnvironments()).toEqual(['Commissioning', 'Production'])
    expect(await alerts.listServices()).toEqual(['Line A', 'Line B', 'Line C'])
  })

  test('a raised alert is listed as open', async () => {
    const alert = raiseAlert()
    expect(alert).toMatchObject({ id: 'alert-017', status: 'open' })
    expect((await alerts.listAlerts()).alerts.map((a) => a.id)).toContain('alert-017')
  })
})

describe('actions', () => {
  test('acknowledge appends to the history', async () => {
    const [open] = byStatus('open')
    const updated = await alerts.applyAlertAction(open.id, { action: 'ack', text: 'On my way.' })
    expect(updated.status).toBe('ack')
    expect(updated.history.at(-1)).toMatchObject({ type: 'status', status: 'ack', text: 'On my way.', user: 'Alex Operator' })
    expect((await alerts.getAlert(open.id)).status).toBe('ack')
  })

  test.each([
    ['ack', 'open', 'ack'], ['unack', 'ack', 'open'], ['shelve', 'open', 'shelved'],
    ['unshelve', 'shelved', 'open'], ['close', 'ack', 'closed'], ['open', 'closed', 'open'],
  ])('%s turns %s into %s', async (action, from, to) => {
    const [alert] = byStatus(from)
    expect((await alerts.applyAlertAction(alert.id, { action })).status).toBe(to)
  })

  test('actions that do not fit the status are conflicts', async () => {
    const [ack] = byStatus('ack')
    await expect(alerts.applyAlertAction(ack.id, { action: 'ack' })).rejects.toMatchObject({ kind: 'conflict', message: 'The alert is acknowledged and cannot be acknowledged.' })
    await expect(alerts.applyAlertAction('alert-999', { action: 'ack' })).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('alert detail has its ordered history', async () => {
    const [closed] = byStatus('closed')
    const detail = await alerts.getAlert(closed.id)
    expect(detail.history.map((h) => h.status)).toEqual(['open', 'ack', 'closed'])
  })
})
