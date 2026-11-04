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

import { paths } from '../../app/router'

/**
 * Alerts area state: filters in the URL, and the actions an operator can
 * take on an alert in each status.
 */
export const DEFAULT_STATUS = 'open,ack'
export const STATUS_FILTERS = [
  { value: 'open,ack', label: 'Open and acknowledged' },
  { value: 'open', label: 'Open' },
  { value: 'ack', label: 'Acknowledged' },
  { value: 'shelved', label: 'Shelved' },
  { value: 'closed', label: 'Closed' },
  { value: 'open,ack,shelved,closed', label: 'All' },
]
export const SORTS = [
  { value: 'severity', label: 'Most severe first' },
  { value: 'time', label: 'Newest first' },
]
const KEYS = ['status', 'severity', 'environment', 'service', 'text', 'sort']

export function readFilters(urlQuery) {
  return {
    status: urlQuery.status || DEFAULT_STATUS,
    severity: urlQuery.severity ?? '',
    environment: urlQuery.environment ?? '',
    service: urlQuery.service ?? '',
    text: urlQuery.text ?? '',
    sort: urlQuery.sort || 'severity',
  }
}

/** The filter as `listAlerts` expects it. */
export function toRequest(filters) {
  const request = { status: filters.status.split(','), sort: filters.sort }
  for (const key of ['severity', 'environment', 'service', 'text']) if (filters[key]) request[key] = filters[key]
  return request
}

export function toSearch(filters) {
  const params = new URLSearchParams()
  for (const key of KEYS) {
    const value = filters[key]
    if (!value || (key === 'status' && value === DEFAULT_STATUS) || (key === 'sort' && value === 'severity')) continue
    params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const alertsPath = (filters) => `${paths.alerts()}${toSearch(filters)}`
export const alertPath = (id, filters) => `${paths.alert(id)}${toSearch(filters)}`

/** Alert actions with their labels and the statuses they apply to. */
export const ACTIONS = [
  { action: 'ack', label: 'Acknowledge', done: 'Acknowledged', from: ['open'] },
  { action: 'unack', label: 'Unacknowledge', done: 'Unacknowledged', from: ['ack'] },
  { action: 'shelve', label: 'Shelve', done: 'Shelved', from: ['open', 'ack'] },
  { action: 'unshelve', label: 'Unshelve', done: 'Unshelved', from: ['shelved'] },
  { action: 'close', label: 'Close', done: 'Closed', from: ['open', 'ack', 'shelved'] },
  { action: 'open', label: 'Reopen', done: 'Reopened', from: ['closed'] },
]
export const actionInfo = (action) => ACTIONS.find((a) => a.action === action)
export const actionsFor = (status) => ACTIONS.filter((a) => a.from.includes(status))
