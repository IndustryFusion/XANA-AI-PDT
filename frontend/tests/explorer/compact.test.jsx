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

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { entities } from '../../src/data'
import { store } from '../../src/data/sources/mock'
import { PINS_KEY, resetExplorerState } from '../../src/features/explorer/store'
import { renderApp, renderAppWith } from '../helpers'

const controls = { authEnabled: false }
const PUMPS = 'http://opcfoundation.org/UA/Pumps/'
const PUMP = 'urn:ngsi-ld:Pump:p-1'
const PUMP2 = 'urn:ngsi-ld:Pump:p-2'
const CHILLER = 'urn:ngsi-ld:Machine:chiller-01'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'
const now = new Date(Date.now() - 60_000).toISOString()

/** An entity as the platform has them: type and attribute names are full IRIs, three levels deep. */
const pump = (id = PUMP, name = 'Pump 1') => ({
  id,
  type: `${PUMPS}Pump`,
  name: { type: 'Property', value: name },
  [`${PUMPS}FlowRate`]: {
    type: 'Property', value: 12, unitCode: 'MQH', observedAt: now,
    [`${PUMPS}Quality`]: {
      type: 'Property', value: 'good', observedAt: now,
      [`${PUMPS}Source`]: { type: 'Property', value: 'sensor', observedAt: now },
    },
  },
  [`${PUMPS}Mode`]: { type: 'VocabularyProperty', vocab: `${PUMPS}Automatic` },
  [`${PUMPS}Settings`]: { type: 'JsonProperty', json: { link: 'http://example.org', kind: `${PUMPS}Kind` } },
  [`${PUMPS}Tags`]: { type: 'ListProperty', valueList: ['https://schema.org/Thing', 'plain'] },
  [`${PUMPS}Location`]: { type: 'Relationship', object: CHILLER },
  [`${PUMPS}Doc`]: { type: 'Property', value: { '@id': 'http://example.org/docs/pump' } },
})

const withPumps = (...list) => () => store.update((s) => { s.entities.push(...(list.length ? list : [pump()])); return s })
const openWith = (arrange, path) => renderAppWith(arrange, { path, controls })
const node = (id) => document.querySelector(`[data-entity="${id}"]`)
const attr = (name, scope = document) => scope.querySelector(`[data-attribute="${name}"]`)
const lineOf = (name, scope) => attr(name, scope).querySelector('.attr-line')
const stored = (id) => store.get().entities.find((e) => e.id === id)
const contextMenu = (element) => { fireEvent.contextMenu(element, { clientX: 10, clientY: 10 }); return screen.getByRole('menu') }
const moreFilters = async (user) => user.click(await screen.findByRole('button', { name: 'More filters' }))
const F = (local) => `${PUMPS}${local}`

/** Text nodes in the page that hold an http(s) IRI, outside the raw JSON editor. */
function fullIrisShown(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const found = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('textarea, script, style, .dev-controls')) continue
    if (/https?:\/\//.test(n.textContent)) found.push(n.textContent)
  }
  return found
}

async function openPump(user) {
  openWith(withPumps(), `${paths.entity(PUMP)}?type=${encodeURIComponent(F('Pump'))}`)
  await waitFor(() => expect(attr(F('FlowRate'))).not.toBeNull())
  return user
}

describe('short names for IRIs', () => {
  test('platform data is shown with short names, with the full IRI on hover, and no full IRI anywhere', async () => {
    await openPump(userEvent.setup())
    const article = node(PUMP)
    expect(within(article.querySelector('.entity-node__type')).getByText('pumps:Pump')).toHaveAttribute('title', F('Pump'))
    expect(within(lineOf(F('FlowRate'))).getByText('pumps:FlowRate')).toHaveAttribute('title', F('FlowRate'))
    await waitFor(() => expect(fullIrisShown()).toEqual([]))
  })

  test('clicking a short name keeps it short; the context menu shows and copies the full IRI', async () => {
    const user = userEvent.setup()
    await openPump(user)
    const type = within(node(PUMP).querySelector('.entity-node__type')).getByText('pumps:Pump')
    await user.click(type)
    expect(type).toHaveTextContent('pumps:Pump')
    let menu = contextMenu(type)
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Copy short name', 'Show full IRI', 'Copy full IRI'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Show full IRI' }))
    const popover = screen.getByRole('dialog', { name: 'Full IRI' })
    expect(within(popover).getByLabelText('Full IRI')).toHaveValue(F('Pump'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Full IRI' })).not.toBeInTheDocument()
    expect(type).toHaveFocus()
    menu = contextMenu(type)
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy full IRI' }))
    expect(await navigator.clipboard.readText()).toBe(F('Pump'))
    menu = contextMenu(type)
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy short name' }))
    expect(await navigator.clipboard.readText()).toBe('pumps:Pump')
  })

  test('the context menu of an attribute and of an entity ID', async () => {
    const user = userEvent.setup()
    await openPump(user)
    let menu = contextMenu(lineOf(F('FlowRate')))
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Copy short name', 'Show full IRI', 'Copy full IRI', 'Copy value'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy value' }))
    expect(await navigator.clipboard.readText()).toBe('12')
    menu = contextMenu(within(node(PUMP).querySelector('.entity-node__id')).getByRole('link'))
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Copy identifier', 'Open in data explorer', 'Start new incident', 'Show active incidents', 'Show incident history',
    ])
  })

  test('Shift+F10 opens the menu from the keyboard, and Escape returns focus', async () => {
    const user = userEvent.setup()
    await openPump(user)
    const name = within(lineOf(F('FlowRate'))).getByText('pumps:FlowRate')
    const value = within(lineOf(F('Mode'))).getByText('pumps:Automatic')
    value.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menu')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(value).toHaveFocus()
    expect(name).toBeVisible()
  })

  test('the legend lists prefixes and where they come from, with no namespace as text', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prefix legend' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Prefix legend' }))
    const legend = screen.getByRole('dialog', { name: 'Prefixes' })
    await waitFor(() => expect(within(legend).getByText('samples:')).toBeVisible())
    const row = (prefix) => within(legend).getByText(prefix).closest('tr')
    expect(row('samples:')).toHaveTextContent('configured context')
    expect(row('pumps:')).toHaveTextContent('well-known')
    expect(within(legend).getByText('pumps:')).toHaveAttribute('title', PUMPS)
    expect(fullIrisShown(legend)).toEqual([])
  })

  test('IRIs inside JSON, List and Vocabulary values, IRI values and the title from an http ID', async () => {
    const httpId = 'http://example.org/things/pump-9'
    const { name: _name, ...unnamed } = pump(httpId)
    openWith(withPumps(unnamed), `${paths.entity(httpId)}`)
    await waitFor(() => expect(attr(F('Settings'))).not.toBeNull())
    expect(attr(F('Settings'))).toHaveTextContent('link: "example:"')
    expect(attr(F('Settings'))).toHaveTextContent('kind: "pumps:Kind"')
    expect(attr(F('Tags'))).toHaveTextContent('[ "schema:Thing", "plain" ]')
    expect(attr(F('Mode'))).toHaveTextContent('pumps:Automatic')
    expect(attr(F('Doc'))).toHaveTextContent('example:docs/pump')
    expect(screen.getByRole('button', { name: 'things:pump-9', expanded: true })).toBeVisible()
    expect(fullIrisShown()).toEqual([])
  })

  test('raw JSON is the one place with full IRIs', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Pump 1' }))
    expect(screen.getByLabelText('Entity JSON').value).toContain(F('FlowRate'))
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Pump 1' }))
    expect(within(lineOf(F('FlowRate'))).getByText('pumps:FlowRate')).toBeVisible()
  })
})

describe('short names in every part of the explorer', () => {
  test('query bar: type options, has-attribute, attributes to return, conditions and chips', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}&hasAttr=${encodeURIComponent(F('Mode'))}&attrs=${encodeURIComponent(F('Mode'))}&q=${encodeURIComponent(`${F('FlowRate')}>5`)}`)
    expect(await screen.findByLabelText('Entity type')).toHaveValue('pumps:Pump')
    const options = () => [...document.querySelectorAll('datalist option')].map((o) => o.value)
    await waitFor(() => expect(options()).toContain('pumps:Pump'))
    expect(options().some((v) => /^https?:/.test(v))).toBe(false)
    const chips = screen.getByRole('list', { name: 'Filters' })
    expect(chips).toHaveTextContent('has pumps:Mode')
    expect(chips).toHaveTextContent('returns pumps:Mode')
    expect(chips).toHaveTextContent('where pumps:FlowRate>5')
    await moreFilters(user)
    expect(screen.getByLabelText('Has attribute')).toHaveValue('pumps:Mode')
    expect(screen.getByLabelText('Attribute of condition 1').selectedOptions[0]).toHaveTextContent('pumps:FlowRate')
    expect(screen.getByLabelText('Query expression')).toHaveTextContent('pumps:FlowRate>5')
    expect(fullIrisShown(document.querySelector('.query-bar'))).toEqual([])
  })

  test('removing a chip clears its filter and applies the query', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}&hasAttr=${encodeURIComponent(F('Mode'))}&limit=20`)
    await user.click(await screen.findByRole('button', { name: 'Remove filter has pumps:Mode' }))
    await waitFor(() => expect(window.location.search).not.toContain('hasAttr'))
    expect(window.location.search).toContain('limit=20')
    expect(screen.getByRole('list', { name: 'Filters' })).toHaveTextContent('limit 20')
  })

  test('add form: the relationship target, and value suggestions as short names', async () => {
    const user = userEvent.setup()
    await openPump(user)
    vi.spyOn(entities, 'getValueHints').mockResolvedValue({
      hintType: 'enum', values: [F('Automatic'), F('Manual')], minimum: null, maximum: null, minimumExclusive: false, maximumExclusive: false, datatype: null, detail: null,
    })
    await user.click(screen.getByRole('button', { name: 'Edit pumps:Mode' }))
    const list = await screen.findByRole('listbox', { name: 'Suggested values' })
    expect(within(list).getByRole('option', { name: 'pumps:Manual' })).toHaveAttribute('title', F('Manual'))
    expect(screen.getByRole('combobox', { name: 'New value of pumps:Mode' })).toHaveValue('pumps:Automatic')
    await user.click(within(list).getByRole('option', { name: 'pumps:Manual' }))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(stored(PUMP)[F('Mode')].vocab).toBe(F('Manual')))
    vi.restoreAllMocks()

    await user.click(screen.getByRole('button', { name: 'Add attribute to Pump 1' }))
    const form = screen.getByRole('form', { name: 'Add an attribute to Pump 1' })
    await user.type(within(form).getByLabelText('Name'), 'pumps:Feeds')
    await user.selectOptions(within(form).getByLabelText('Kind'), 'Relationship')
    await user.type(within(form).getByLabelText('Target entity ID'), MACHINE)
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(stored(PUMP)[F('Feeds')]).toEqual({ type: 'Relationship', object: MACHINE }))
    expect(within(lineOf(F('Feeds'))).getByText('pumps:Feeds')).toBeVisible()
  })

  test('history pane: title and IRI values in the table', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(screen.getByRole('button', { name: 'History of pumps:FlowRate' }))
    expect(await screen.findByRole('heading', { name: 'History of pumps:FlowRate' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close history of pumps:FlowRate' })).toBeVisible()
  })

  test('time-shift banner, import preview and results, delete-by-type dialog and messages', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}`)
    await waitFor(() => expect(node(PUMP)).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'Delete by type…' }))
    const del = await screen.findByRole('dialog', { name: 'Delete entities by type' })
    expect(within(del).getByText('pumps:Pump')).toHaveAttribute('title', F('Pump'))
    expect(fullIrisShown(del)).toEqual([])
    await user.click(within(del).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Import…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import entities' })
    const file = new File([JSON.stringify([{ ...pump(PUMP2, 'Pump 2') }])], 'p.json', { type: 'application/json' })
    await user.upload(within(dialog).getByLabelText('File with NGSI-LD entities (JSON)'), file)
    expect(await within(dialog).findByText(/Import replaces:/)).toBeVisible()
    expect(fullIrisShown(dialog)).toEqual([])
    expect(within(dialog).getByText('pumps:Pump')).toBeVisible()

    await user.keyboard('{Escape}')
    await user.click(within(node(PUMP).querySelector('.entity-node__header')).getByRole('button', { name: 'Pump 1' }))
    await waitFor(() => expect(attr(F('FlowRate'))).not.toBeNull())
    vi.spyOn(entities, 'updateAttributes').mockRejectedValue(new Error(`${F('FlowRate')} must be a number.`))
    await user.click(screen.getByRole('button', { name: 'Edit pumps:FlowRate' }))
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Not saved: pumps:FlowRate must be a number.')).toBeVisible()
    vi.restoreAllMocks()
    expect(fullIrisShown()).toEqual([])
  })

  test('time-shift banner names the type by its short name', async () => {
    const at = new Date(Date.now() - 3600_000).toISOString()
    renderApp({ path: `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}&at=${encodeURIComponent(at)}`, controls })
    const banner = await screen.findByRole('region', { name: 'Historical view' })
    expect(banner).toHaveTextContent('entities of the type pumps:Pump as they were')
    expect(fullIrisShown(banner)).toEqual([])
  })
})

describe('short names as input', () => {
  test('a known prefix is expanded before the query; a URN is sent as typed', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), paths.explorer())
    const spy = vi.spyOn(entities, 'queryEntities')
    await user.type(await screen.findByLabelText('Entity type'), 'pumps:Pump')
    await user.type(screen.getByLabelText('Entity ID'), PUMP)
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: F('Pump'), id: PUMP })))
    expect(new URLSearchParams(window.location.search).get('type')).toBe(F('Pump'))
    vi.restoreAllMocks()
  })

  test('an entity ID in another URI scheme is sent as typed', async () => {
    const user = userEvent.setup()
    openWith(withPumps({ ...pump('did:example:123') }), paths.explorer())
    await user.type(await screen.findByLabelText('Entity ID'), 'did:example:123')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('id')).toBe('did:example:123'))
  })

  test('an unknown prefix in a name field is refused with the reason, and nothing is sent', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), paths.explorer())
    await user.type(await screen.findByLabelText('Entity type'), 'nope:Pump')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/The prefix nope: is unknown/)).toBeVisible()
    expect(screen.getByLabelText('Entity type')).toHaveAttribute('aria-invalid', 'true')
    expect(window.location.search).toBe('')
  })

  test('condition values: text with a colon is sent unchanged, an IRI value is expanded', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}`)
    await moreFilters(user)
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await waitFor(() => expect(within(screen.getByLabelText('Attribute of condition 1')).getAllByRole('option').length).toBeGreaterThan(3))
    await user.selectOptions(screen.getByLabelText('Attribute of condition 1'), F('Mode'))
    await user.type(screen.getByLabelText('Value of condition 1'), 'pumps:x')
    expect(screen.getByLabelText('Query expression')).toHaveTextContent('pumps:Mode=="pumps:x"')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe(`${F('Mode')}=="pumps:x"`))

    await user.click(screen.getByLabelText('IRI'))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe(`${F('Mode')}=="${F('x')}"`))

    await user.click(screen.getByLabelText('IRI'))
    await user.clear(screen.getByLabelText('Value of condition 1'))
    await user.type(screen.getByLabelText('Value of condition 1'), '10:30')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe(`${F('Mode')}=="10:30"`))
  })

  test('the start of the ID pattern, its namespace matched literally', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), paths.explorer())
    await moreFilters(user)
    await user.type(screen.getByLabelText('ID pattern'), 'pumps:P.*')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('idPattern')).toBe('http://opcfoundation\\.org/UA/Pumps/P.*'))
  })
})

describe('the same row at every depth', () => {
  test('sub-attributes three levels deep: one expand control per level, with tree lines', async () => {
    const user = userEvent.setup()
    await openPump(user)
    const top = attr(F('FlowRate'))
    await user.click(within(top).getByRole('button', { name: '1 sub-attribute of pumps:FlowRate' }))
    const quality = `${F('FlowRate')}.${F('Quality')}`
    await user.click(within(attr(quality)).getByRole('button', { name: /^1 sub-attribute of sub-attribute pumps:Quality/ }))
    const source = `${quality}.${F('Source')}`
    expect(within(lineOf(source)).getByText('pumps:Source')).toBeVisible()
    expect(within(lineOf(source)).getByText('Property')).toHaveClass('kind-tag')
    expect(attr(source).closest('.attr-subs')).not.toBeNull()
  })

  test('change, add, delete and history at depth 3, each with its path', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(within(attr(F('FlowRate'))).getByRole('button', { name: /^1 sub-attribute/ }))
    const quality = `${F('FlowRate')}.${F('Quality')}`
    await user.click(within(attr(quality)).getByRole('button', { name: /^1 sub-attribute/ }))
    const source = `${quality}.${F('Source')}`
    const line = () => lineOf(source)
    const spy = { update: vi.spyOn(entities, 'updateAttributes'), append: vi.spyOn(entities, 'appendAttributes'), del: vi.spyOn(entities, 'deleteAttribute'), history: vi.spyOn(entities, 'getAttributeHistory') }

    await user.click(within(line()).getByRole('button', { name: /^Edit sub-attribute pumps:Source/ }))
    const input = screen.getByRole('combobox', { name: /^New value of pumps:Source/ })
    await user.clear(input)
    await user.type(input, 'model{Enter}')
    await waitFor(() => expect(stored(PUMP)[F('FlowRate')][F('Quality')][F('Source')].value).toBe('model'))
    expect(spy.update).toHaveBeenCalledWith(PUMP, { [F('FlowRate')]: { value: 'model' } }, { path: [F('Quality'), F('Source')] })
    expect(stored(PUMP)[F('FlowRate')].value).toBe(12)
    expect(stored(PUMP)[F('FlowRate')][F('Quality')].value).toBe('good')

    await user.click(within(line()).getByRole('button', { name: /^Add sub-attribute to sub-attribute pumps:Source/ }))
    const form = screen.getByRole('form', { name: /^Add a sub-attribute to sub-attribute pumps:Source/ })
    await user.type(within(form).getByLabelText('Name'), 'pumps:Note')
    await user.type(within(form).getByLabelText('Value'), 'checked')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(stored(PUMP)[F('FlowRate')][F('Quality')][F('Source')][F('Note')]).toEqual({ type: 'Property', value: 'checked' }))
    expect(spy.append).toHaveBeenCalledWith(PUMP, { [F('FlowRate')]: { [F('Note')]: { type: 'Property', value: 'checked' } } }, { path: [F('Quality'), F('Source')] })

    await user.click(within(line()).getByRole('button', { name: /^History of sub-attribute pumps:Source/ }))
    expect(await screen.findByRole('heading', { name: 'History of pumps:FlowRate.pumps:Quality.pumps:Source' })).toBeVisible()
    expect(spy.history).toHaveBeenCalledWith(PUMP, F('FlowRate'), expect.objectContaining({ path: [F('Quality'), F('Source')] }))

    await user.click(within(line()).getByRole('button', { name: /^Delete sub-attribute pumps:Source/ }))
    const dialog = screen.getByRole('dialog', { name: 'Delete the sub-attribute pumps:Source?' })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveTextContent('Delete')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(stored(PUMP)[F('FlowRate')][F('Quality')][F('Source')]).toBeUndefined())
    expect(spy.del).toHaveBeenCalledWith(PUMP, F('FlowRate'), { path: [F('Quality'), F('Source')] })
    expect(stored(PUMP)[F('FlowRate')][F('Quality')].value).toBe('good')
    vi.restoreAllMocks()
  })

  test('the add form offers every NGSI-LD kind, and saves the name as the full IRI', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(screen.getByRole('button', { name: 'Add attribute to Pump 1' }))
    const form = screen.getByRole('form', { name: 'Add an attribute to Pump 1' })
    expect(within(within(form).getByLabelText('Kind')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Property', 'Relationship', 'GeoProperty', 'JsonProperty', 'LanguageProperty', 'ListProperty', 'VocabularyProperty',
    ])
    await user.selectOptions(within(form).getByLabelText('Prefix'), 'pumps')
    await user.type(within(form).getByLabelText('Name'), 'Spot')
    expect(within(form).getByLabelText('Name')).toHaveValue('pumps:Spot')
    await user.selectOptions(within(form).getByLabelText('Kind'), 'GeoProperty')
    await user.type(within(form).getByLabelText('Longitude'), '9.18')
    await user.type(within(form).getByLabelText('Latitude'), '48.77')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(stored(PUMP)[F('Spot')]).toEqual({ type: 'GeoProperty', value: { type: 'Point', coordinates: [9.18, 48.77] } }))

    for (const [kind, fill, expected] of [
      ['JsonProperty', { 'JSON value': '{{"a":1}' }, { type: 'JsonProperty', json: { a: 1 } }],
      ['LanguageProperty', { Text: 'Hallo', Language: 'de' }, { type: 'LanguageProperty', languageMap: { de: 'Hallo' } }],
      ['ListProperty', { 'List (JSON array)': '[[1,2]' }, { type: 'ListProperty', valueList: [1, 2] }],
      ['VocabularyProperty', { 'Vocabulary term': 'pumps:Auto' }, { type: 'VocabularyProperty', vocab: F('Auto') }],
    ]) {
      await user.click(screen.getByRole('button', { name: 'Add attribute to Pump 1' }))
      const f = screen.getByRole('form', { name: 'Add an attribute to Pump 1' })
      await user.type(within(f).getByLabelText('Name'), `pumps:${kind}`)
      await user.selectOptions(within(f).getByLabelText('Kind'), kind)
      for (const [label, text] of Object.entries(fill)) {
        await user.clear(within(f).getByLabelText(label))
        await user.type(within(f).getByLabelText(label), text)
      }
      await user.click(within(f).getByRole('button', { name: 'Add' }))
      await waitFor(() => expect(stored(PUMP)[F(kind)]).toEqual(expected))
    }
  })

  test('an unknown prefix in the add form is refused', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(screen.getByRole('button', { name: 'Add attribute to Pump 1' }))
    const form = screen.getByRole('form', { name: 'Add an attribute to Pump 1' })
    await user.type(within(form).getByLabelText('Name'), 'nope:X')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('The prefix nope: is unknown')
  })
})

describe('review fixes', () => {
  test('the message after saving names a full-IRI attribute by its short name', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(screen.getByRole('button', { name: 'Edit pumps:FlowRate' }))
    await user.keyboard('{Control>}a{/Control}13{Enter}')
    expect(await screen.findByText('pumps:FlowRate saved.')).toBeVisible()
    expect(fullIrisShown()).toEqual([])
  })

  test('sub-attributes of a multi-attribute are read-only, and their history opens once', async () => {
    const multi = { ...pump(), [F('Temp')]: [
      { type: 'Property', value: 1, datasetId: 'urn:ngsi-ld:Dataset:a', [F('Acc')]: { type: 'Property', value: 0.1, observedAt: now } },
      { type: 'Property', value: 2, datasetId: 'urn:ngsi-ld:Dataset:b', [F('Acc')]: { type: 'Property', value: 0.2, observedAt: now } },
    ] }
    const user = userEvent.setup()
    openWith(withPumps(multi), `${paths.entity(PUMP)}`)
    await waitFor(() => expect(attr(F('Temp'))).not.toBeNull())
    // The instances share their expansion: one toggle opens both.
    await user.click(within(attr(F('Temp'))).getAllByRole('button', { name: /^1 sub-attribute/ })[0])
    const subs = attr(F('Temp')).querySelectorAll('.attr-subs .attr-line')
    expect(subs).toHaveLength(2)
    for (const line of subs) expect(within(line).queryAllByRole('button', { name: /^(History|Edit|Delete|Add sub-attribute)/ })).toHaveLength(0)
  })

  test('an expanded ID pattern is shown as the short name again, in the field and its chip', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?idPattern=${encodeURIComponent('http://opcfoundation\\.org/UA/Pumps/P.*')}`)
    expect(await screen.findByRole('list', { name: 'Filters' })).toHaveTextContent('ID pattern pumps:P.*')
    await moreFilters(user)
    expect(screen.getByLabelText('ID pattern')).toHaveValue('pumps:P.*')
    expect(fullIrisShown(document.querySelector('.query-bar'))).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('idPattern')).toBe('http://opcfoundation\\.org/UA/Pumps/P.*'))
  })

  test('after a reload, an ID pattern in a namespace not shown yet still has its short name', async () => {
    openWith(withPumps(), `${paths.explorer()}?idPattern=${encodeURIComponent('https://example\\.com/plant/v1/Pump.*')}`)
    expect(await screen.findByRole('list', { name: 'Filters' })).toHaveTextContent('ID pattern plant:Pump.*')
    expect(fullIrisShown(document.querySelector('.query-bar'))).toEqual([])
  })

  test('removing the conditions chip with an unknown prefix in another field says why nothing was applied', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=Machine&q=${encodeURIComponent('status=="idle"')}`)
    const type = await screen.findByLabelText('Entity type')
    await user.clear(type)
    await user.type(type, 'nope:Pump')
    await user.click(screen.getByRole('button', { name: /^Remove filter where / }))
    expect(await screen.findByText(/The prefix nope: is unknown/)).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('q')).toBe('status=="idle"')
  })
})

describe('icon actions', () => {
  test('no row or header holds a text button; confirm dialogs do', async () => {
    const user = userEvent.setup()
    await openPump(user)
    await user.click(within(attr(F('FlowRate'))).getByRole('button', { name: /^1 sub-attribute/ }))
    await user.click(screen.getByRole('button', { name: 'History of pumps:FlowRate' }))
    await screen.findByRole('heading', { name: 'History of pumps:FlowRate' })
    const scopes = [...document.querySelectorAll('.attr-line__actions, .entity-node__actions, .attr-line__target, .history .card__header')]
    expect(scopes.length).toBeGreaterThan(3)
    for (const button of scopes.flatMap((s) => [...s.querySelectorAll('button')])) {
      expect(button.textContent.trim(), button.outerHTML).toBe('')
      expect(button).toHaveAccessibleName()
      expect(button).toHaveAttribute('title')
    }
    for (const name of ['Add attribute to Pump 1', 'Delete entity Pump 1', 'Pin Pump 1', `Expand ${CHILLER} in place`, 'Close history of pumps:FlowRate']) {
      expect(screen.getByRole('button', { name })).toHaveClass('icon-button')
    }
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Pump 1' }))
    for (const name of ['Copy JSON', 'Save JSON', 'Cancel editing the JSON']) expect(screen.getByRole('button', { name })).toHaveClass('icon-button')
    await user.click(screen.getByRole('button', { name: 'Delete entity Pump 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this entity?' })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveTextContent('Delete')
  })

  test('the row actions are reachable from the keyboard', async () => {
    const user = userEvent.setup()
    await openPump(user)
    const history = screen.getByRole('button', { name: 'History of pumps:FlowRate' })
    history.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'History of pumps:FlowRate' })).toBeVisible()
    await user.tab()
    expect(document.activeElement).toHaveClass('icon-button')
  })
})

describe('nested entities, unnest and re-nest', () => {
  async function expandChiller(user) {
    await openPump(user)
    await user.click(screen.getByRole('button', { name: `Expand ${CHILLER} in place` }))
    await waitFor(() => expect(document.querySelector(`.attr-line__nested [data-entity="${CHILLER}"] [data-attribute="status"]`)).not.toBeNull())
    return document.querySelector(`.attr-line__nested [data-entity="${CHILLER}"]`)
  }

  test('a nested entity offers no delete, raw JSON or incident controls in the rows', async () => {
    const user = userEvent.setup()
    const nested = await expandChiller(user)
    expect(within(nested).queryByRole('button', { name: /^Delete entity/ })).not.toBeInTheDocument()
    expect(within(nested).queryByRole('button', { name: /^Raw JSON/ })).not.toBeInTheDocument()
    expect(within(nested).getByRole('button', { name: 'Unnest Process chiller 01' })).toBeVisible()
    expect(document.querySelector('.entity-ref__toggle')).toBeNull()
  })

  test('unnest moves it after the results without a write; the relationship links to it; re-nest puts it back', async () => {
    const user = userEvent.setup()
    await expandChiller(user)
    const writes = ['updateAttributes', 'appendAttributes', 'deleteAttribute', 'deleteEntity'].map((op) => vi.spyOn(entities, op))
    await user.click(screen.getByRole('button', { name: 'Unnest Process chiller 01' }))
    const out = await screen.findByRole('region', { name: 'Unnested entities' })
    expect(within(out).getByRole('button', { name: 'Process chiller 01' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector(`.attr-line__nested [data-entity="${CHILLER}"]`)).toBeNull()
    Element.prototype.scrollIntoView = vi.fn()
    await user.click(screen.getByRole('button', { name: `Go to ${CHILLER}, moved out of the tree` }))
    expect(within(out).getByRole('button', { name: 'Process chiller 01' })).toHaveFocus()
    await user.click(within(out).getByRole('button', { name: 'Re-nest Process chiller 01' }))
    await waitFor(() => expect(document.querySelector(`.attr-line__nested [data-entity="${CHILLER}"]`)).not.toBeNull())
    expect(screen.queryByRole('region', { name: 'Unnested entities' })).not.toBeInTheDocument()
    for (const w of writes) expect(w).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  test('a new query removes unnested entities, but a pinned one stays listed', async () => {
    const user = userEvent.setup()
    await expandChiller(user)
    await user.click(screen.getByRole('button', { name: 'Unnest Process chiller 01' }))
    const out = await screen.findByRole('region', { name: 'Unnested entities' })
    await user.click(within(out).getByRole('button', { name: 'Pin Process chiller 01' }))
    await user.clear(screen.getByLabelText('Entity type'))
    await user.type(screen.getByLabelText('Entity type'), 'Sensor')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unnested entities' })).not.toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'Pinned entities' })).getByRole('button', { name: 'Process chiller 01' })).toBeVisible()
  })
})

describe('pinning', () => {
  test('a pinned entity stays at the top for a query that does not match it, and the list says how many', async () => {
    const user = userEvent.setup()
    openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}`)
    await user.click(await screen.findByRole('button', { name: 'Pin Pump 1' }))
    await user.clear(screen.getByLabelText('Entity type'))
    await user.type(screen.getByLabelText('Entity type'), 'Factory')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const pinned = await screen.findByRole('region', { name: 'Pinned entities' })
    expect(within(pinned).getByText('1 pinned')).toBeVisible()
    expect(within(pinned).getByRole('button', { name: 'Pump 1' })).toBeVisible()
    expect(within(pinned).getByText('Pinned')).toBeVisible()
    const order = [...document.querySelectorAll('.entity-list article')].map((a) => a.dataset.entity)
    expect(order[0]).toBe(PUMP)
    expect(JSON.parse(localStorage.getItem(PINS_KEY))).toEqual([PUMP])
  })

  test('unpinning a selection', async () => {
    const user = userEvent.setup()
    localStorage.setItem(PINS_KEY, JSON.stringify([PUMP, PUMP2]))
    resetExplorerState()
    openWith(withPumps(pump(), pump(PUMP2, 'Pump 2')), `${paths.explorer()}?type=Factory`)
    const pinned = await screen.findByRole('region', { name: 'Pinned entities' })
    await waitFor(() => expect(within(pinned).getByText('2 pinned')).toBeVisible())
    await user.click(await within(pinned).findByRole('checkbox', { name: 'Select Pump 1' }))
    await user.click(await within(pinned).findByRole('checkbox', { name: 'Select Pump 2' }))
    await user.click(within(pinned).getByRole('button', { name: 'Unpin 2 selected' }))
    expect(screen.queryByRole('region', { name: 'Pinned entities' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(PINS_KEY))).toEqual([])
  })

  test('after a reload, pinned entities are read again; a gone one is not found and can be unpinned', async () => {
    const user = userEvent.setup()
    localStorage.setItem(PINS_KEY, JSON.stringify([PUMP, 'urn:ngsi-ld:Pump:gone']))
    resetExplorerState()
    openWith(withPumps(), paths.explorer())
    const pinned = await screen.findByRole('region', { name: 'Pinned entities' })
    expect(await within(pinned).findByRole('button', { name: 'Pump 1' })).toBeVisible()
    expect(await within(pinned).findByText('Entity not found')).toBeVisible()
    await user.click(within(pinned).getByRole('button', { name: 'Unpin urn:ngsi-ld:Pump:gone' }))
    expect(JSON.parse(localStorage.getItem(PINS_KEY))).toEqual([PUMP])
  })

  test('storage that throws: pins still work until the page is reloaded', async () => {
    const user = userEvent.setup()
    const { getItem, setItem } = Storage.prototype
    const blocked = (fn) => function guarded(key, ...rest) { if (key === PINS_KEY) throw new Error('blocked'); return fn.call(this, key, ...rest) }
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked(getItem))
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked(setItem))
    try {
      resetExplorerState()
      openWith(withPumps(), `${paths.explorer()}?type=${encodeURIComponent(F('Pump'))}`)
      await user.click(await screen.findByRole('button', { name: 'Pin Pump 1' }))
      expect(await screen.findByRole('region', { name: 'Pinned entities' })).toBeVisible()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})

describe('explorer state is kept', () => {
  async function arrange(user) {
    await openPump(user)
    await user.click(within(attr(F('FlowRate'))).getByRole('button', { name: /^1 sub-attribute/ }))
    await user.click(screen.getByRole('button', { name: `Expand ${CHILLER} in place` }))
    await waitFor(() => expect(document.querySelector(`.attr-line__nested [data-entity="${CHILLER}"] [data-attribute="status"]`)).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Unnest Process chiller 01' }))
    await screen.findByRole('region', { name: 'Unnested entities' })
  }

  const expectSameView = async () => {
    await waitFor(() => expect(attr(`${F('FlowRate')}.${F('Quality')}`)).not.toBeNull())
    expect(within(screen.getByRole('region', { name: 'Unnested entities' })).getByRole('button', { name: 'Process chiller 01' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Pump 1' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Entity type')).toHaveValue('pumps:Pump')
  }

  test('back through the navigation', async () => {
    const user = userEvent.setup()
    await arrange(user)
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav.getByRole('link', { name: 'Alerts' }))
    await screen.findByRole('heading', { level: 1, name: 'Alerts' })
    expect(nav.getByRole('link', { name: 'Data explorer' })).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(PUMP)))
    const reads = vi.spyOn(entities, 'queryEntities')
    await user.click(nav.getByRole('link', { name: 'Data explorer' }))
    await expectSameView()
    await waitFor(() => expect(reads).toHaveBeenCalled())
    vi.restoreAllMocks()
  })

  test('back with the browser', async () => {
    const user = userEvent.setup()
    await arrange(user)
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Alerts' }))
    await screen.findByRole('heading', { level: 1, name: 'Alerts' })
    act(() => { window.history.back() })
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    await expectSameView()
  })

  test('values are brought up to date on return', async () => {
    const user = userEvent.setup()
    await arrange(user)
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Alerts' }))
    await screen.findByRole('heading', { level: 1, name: 'Alerts' })
    act(() => { store.update((s) => { s.entities.find((e) => e.id === PUMP).name.value = 'Pump renamed'; return s }) })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Data explorer' }))
    expect(await screen.findByRole('button', { name: 'Pump renamed' })).toBeVisible()
  })
})
