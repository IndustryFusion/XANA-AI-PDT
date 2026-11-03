import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { LIVE_UPDATE_MS } from '../../src/data/sources/mock/entitiesArea'
import { MAX_DEPTH } from '../../src/features/explorer/AttributeLine'
import { HIGHLIGHT_MS } from '../../src/features/explorer/EntityNode'
import { renderApp } from '../helpers'

const controls = { authEnabled: false }
const FACTORY = 'urn:ngsi-ld:Factory:plant-north'
const LINE_A = 'urn:ngsi-ld:ProductionLine:line-a'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'
const CHILLER = 'urn:ngsi-ld:Machine:chiller-01'
const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'

const open = (path, extra = {}) => renderApp({ path, controls: { ...controls, ...extra } })
const openEntity = (id, search = '') => open(`${paths.entity(id)}${search}`)
const listRegion = () => screen.findByRole('region', { name: 'Entities' })
/** Headers of the top-level entity nodes in the result list. */
const nodeHeadings = async () => within(await listRegion()).queryAllByRole('heading', { level: 3 })
const node = (id) => document.querySelector(`[data-entity="${id}"]`)
const attribute = (name, scope = document) => scope.querySelector(`[data-attribute="${name}"]`)
const lineOf = (name, scope) => attribute(name, scope).querySelector('.attr-line')
const entityStored = (id) => store.get().entities.find((e) => e.id === id)
const expandedNode = (name) => screen.findByRole('button', { name, expanded: true })
const addEntities = (...list) => store.update((s) => { s.entities.push(...list); return s })

describe('query entities', () => {
  test('by type: entities as nodes with ID, type and name, and the URL reflects the query', async () => {
    const user = userEvent.setup()
    open(paths.explorer())
    expect(await within(await listRegion()).findByText('No query yet.')).toBeVisible()
    const type = screen.getByLabelText('Entity type')
    await within(type).findByRole('option', { name: 'Machine' })
    await user.selectOptions(type, 'Machine')
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(8))
    expect(window.location.search).toBe('?type=Machine')
    const first = (await nodeHeadings())[0].closest('article')
    expect(first).toHaveTextContent('Laser cutter 01')
    expect(first).toHaveTextContent('Machine')
    expect(first).toHaveTextContent('urn:ngsi-ld:Machine:laser-cutter-01')
    expect(first).toHaveTextContent('7 attributes')
    expect(within(first).getByRole('button', { name: 'Laser cutter 01' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('8 entities')).toBeVisible()
  })

  test('attribute conditions combined with OR: only matching entities and the expression is shown', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`)
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(8))
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await waitFor(() => expect(within(screen.getByLabelText('Attribute of condition 1')).getAllByRole('option').length).toBeGreaterThan(5))
    await user.selectOptions(screen.getByLabelText('Attribute of condition 1'), 'machineType')
    await user.type(screen.getByLabelText('Value of condition 1'), 'Chiller')
    await user.selectOptions(screen.getByLabelText('Attribute of condition 2'), 'operatingMode')
    await user.type(screen.getByLabelText('Value of condition 2'), 'setup')
    await user.click(screen.getByLabelText('Any condition (OR)'))
    expect(screen.getByLabelText('Query expression')).toHaveTextContent('machineType=="Chiller"|operatingMode=="setup"')
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    await waitFor(async () => expect((await nodeHeadings()).map((h) => h.textContent)).toEqual([
      expect.stringContaining('Powder coating booth 01'), expect.stringContaining('Process chiller 01'),
    ]))
    expect(new URLSearchParams(window.location.search).get('q')).toBe('machineType=="Chiller"|operatingMode=="setup"')
    expect(screen.getByLabelText('Query expression')).toHaveTextContent('machineType=="Chiller"|operatingMode=="setup"')
    expect(screen.getByLabelText('Value of condition 2')).toHaveValue('setup')
  })

  test('no results', async () => {
    open(`${paths.explorer()}?type=Machine&q=${encodeURIComponent('status=="exploded"')}`)
    expect(await within(await listRegion()).findByText('No entities matched the query.')).toBeVisible()
  })

  test('an invalid query shows the reason next to the query bar and keeps the previous results', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Sensor`)
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(13))
    await user.type(screen.getByLabelText('ID pattern'), '[[unclosed')
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    const form = screen.getByRole('button', { name: 'Apply query' }).closest('form')
    expect(await within(form).findByRole('alert')).toHaveTextContent('The query was rejected: The ID pattern "[unclosed" is not a valid regular expression.')
    expect(await nodeHeadings()).toHaveLength(13)
  })
})

describe('entity nodes', () => {
  test('expanding a node sets the URL and keeps the query; several nodes stay open; collapsing clears the URL', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`)
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(8))
    await user.click(screen.getByRole('button', { name: 'Press brake 01' }))
    expect(screen.getByRole('button', { name: 'Press brake 01' })).toHaveAttribute('aria-expanded', 'true')
    expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${MACHINE}`)
    expect(window.location.search).toBe('?type=Machine')
    await waitFor(() => expect(attribute('status', node(MACHINE))).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'Process chiller 01' }))
    expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${CHILLER}`)
    expect(screen.getByRole('button', { name: 'Press brake 01' })).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(attribute('status', node(CHILLER))).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'Process chiller 01' }))
    expect(screen.getByRole('button', { name: 'Process chiller 01' })).toHaveAttribute('aria-expanded', 'false')
    expect(attribute('status', node(CHILLER))).toBeNull()
    expect(window.location.pathname).toBe('/explorer')
    expect(window.location.search).toBe('?type=Machine')
  })

  test('opening an entity URL expands that node and scrolls it into view', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled(this) }
    try {
      openEntity(MACHINE, '?type=Machine')
      expect(await expandedNode('Press brake 01')).toBeVisible()
      await waitFor(() => expect(scrolled).toHaveBeenCalledWith(node(MACHINE)))
      expect(screen.getByRole('button', { name: 'Laser cutter 01' })).toHaveAttribute('aria-expanded', 'false')
    } finally {
      delete Element.prototype.scrollIntoView
    }
  })

  test('an entity that is not among the results is shown as a single node above the list', async () => {
    openEntity(FACTORY, '?type=Machine')
    const list = await listRegion()
    expect(await within(list).findByText('Opened entity, not among the query results:')).toBeVisible()
    expect(await expandedNode('Plant North')).toBeVisible()
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(9))
    expect((await nodeHeadings())[0]).toHaveTextContent('Plant North')
  })

  test('the header offers the entity menu with copy and the node actions', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await expandedNode('Press brake 01')
    await user.click(within(node(MACHINE)).getByRole('button', { name: `Actions for ${MACHINE}` }))
    await user.click(within(node(MACHINE)).getByRole('button', { name: 'Copy identifier' }))
    expect(await navigator.clipboard.readText()).toBe(MACHINE)
    expect(within(node(MACHINE)).getByRole('button', { name: 'Add attribute to Press brake 01' })).toBeVisible()
    expect(within(node(MACHINE)).getByRole('button', { name: 'Delete entity Press brake 01' })).toBeVisible()
  })
})

describe('entity view', () => {
  test('typed attributes: each line shows its kind and a fitting presentation', async () => {
    openEntity(FACTORY)
    await expandedNode('Plant North')
    await waitFor(() => expect(attribute('location')).not.toBeNull())
    expect(within(lineOf('location')).getByText('Geo')).toHaveClass('kind-tag')
    expect(attribute('location')).toHaveTextContent('Point · 48.7758° N, 9.1829° E')
    expect(within(attribute('description')).getByText('Language')).toBeVisible()
    expect(within(attribute('description')).getByText('"Blechbearbeitung und Oberflächenveredelung"')).toHaveAttribute('lang', 'de')
    expect(within(attribute('address')).getByText('Property')).toBeVisible()
    expect(attribute('address')).toHaveTextContent('{ addressLocality: "Rivertown", addressCountry: "DE" }')
    expect(within(attribute('address')).getByText('"Rivertown"')).toHaveClass('tok--string')
  })

  test.each([
    ['urn:ngsi-ld:Machine:laser-cutter-01', [['operatingMode', 'Vocabulary', 'automatic'], ['configuration', 'JSON', 'maxPowerKw: 6'], ['partOf', 'Relationship', LINE_A]]],
    [LINE_A, [['shifts', 'List', '[ "early", "late", "night" ]']]],
    [SENSOR, [['installedOn', 'IRI', 'urn:ngsi-ld:Component:chiller-01-coolant-pump'], ['measures', 'Relationship', CHILLER]]],
  ])('%s: kinds and values', async (id, expected) => {
    openEntity(id)
    await waitFor(() => expect(node(id).querySelector('.entity-doc')).not.toBeNull())
    for (const [name, kind, text] of expected) {
      expect(within(lineOf(name)).getByText(kind)).toHaveClass('kind-tag')
      expect(attribute(name)).toHaveTextContent(text)
    }
  })

  test('the lines follow the entity\'s own attribute order, and values are syntax-coloured', async () => {
    openEntity(MACHINE)
    await waitFor(() => expect(node(MACHINE).querySelector('.entity-doc')).not.toBeNull())
    const shown = [...node(MACHINE).querySelectorAll('.entity-doc > li')].map((li) => li.dataset.attribute)
    expect(shown).toEqual(Object.keys(entityStored(MACHINE)).filter((k) => !['id', 'type'].includes(k)))
    expect(within(attribute('configuration')).getByText('2200')).toHaveClass('tok--number')
    expect(within(attribute('name')).getByText('"Press brake 01"')).toHaveClass('tok--string')
  })

  test('unit, observation time and dataset on the line; sub-attributes collapse behind a toggle with the count', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await expandedNode('Process chiller 01 flow')
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    const value = attribute('value')
    expect(value).toHaveTextContent(/\d+(\.\d)? l\/min/)
    expect(value).toHaveTextContent('Observed')
    expect(value).toHaveTextContent('dataset live')
    const toggle = within(value).getByRole('button', { name: '2 sub-attributes of value' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(attribute('value.accuracy')).toBeNull()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const subs = within(value).getByRole('list', { name: 'Sub-attributes of value' })
    expect(within(subs).getByText('accuracy')).toBeVisible()
    expect(within(subs).getByText('calibratedAt')).toBeVisible()
    expect(within(lineOf('value.accuracy')).getByText('Property')).toHaveClass('kind-tag')
  })

  test('multi-attributes show one line per instance with its dataset', async () => {
    openEntity(SENSOR)
    store.update((s) => {
      s.entities.find((e) => e.id === SENSOR).temperature = [
        { type: 'Property', value: 21.5, unitCode: 'CEL', datasetId: 'urn:ngsi-ld:Dataset:inlet' },
        { type: 'Property', value: 24, unitCode: 'CEL', datasetId: 'urn:ngsi-ld:Dataset:outlet' },
      ]
      return s
    })
    await waitFor(() => expect(attribute('temperature')).not.toBeNull())
    const lines = attribute('temperature').querySelectorAll('.attr-line:not(.attr-line--note)')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('temperature = 21.5 CEL dataset inlet')
    expect(lines[1]).toHaveTextContent('temperature = 24 CEL dataset outlet')
    expect(attribute('temperature')).toHaveTextContent('2 instances; edit them in the raw JSON.')
  })

  test('raw JSON can be shown and copied, and the URL names the entity', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await expandedNode('Press brake 01')
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Press brake 01' }))
    const raw = await screen.findByLabelText('Entity JSON')
    expect(JSON.parse(raw.value)).toMatchObject({ id: MACHINE, type: 'Machine' })
    expect(screen.getByRole('button', { name: 'Save JSON' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Copy JSON' }))
    expect(JSON.parse(await navigator.clipboard.readText()).id).toBe(MACHINE)
    expect(await screen.findByText('Entity JSON copied.')).toBeVisible()
    expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${MACHINE}`)
  })

  test('edit the raw JSON: added, changed and removed attributes are applied exactly as written', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await expandedNode('Process chiller 01 flow')
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Process chiller 01 flow' }))
    const raw = await screen.findByLabelText('Entity JSON')
    const edited = JSON.parse(raw.value)
    edited.value.value = 42.5
    delete edited.value.accuracy
    delete edited.value.unitCode
    edited.name.value = 'Chiller flow'
    delete edited.installedOn
    edited.note = { type: 'Property', value: 'Checked' }
    fireEvent.change(raw, { target: { value: JSON.stringify(edited, null, 2) } })
    await user.click(screen.getByRole('button', { name: 'Save JSON' }))
    expect(await screen.findByText('Entity JSON saved.')).toBeVisible()
    expect(entityStored(SENSOR)).toEqual(edited)
    await waitFor(() => expect(JSON.parse(screen.getByLabelText('Entity JSON').value)).toEqual(edited))
    expect(screen.getByRole('button', { name: 'Save JSON' })).toBeDisabled()
  })

  test.each([
    ['invalid JSON', (text) => text.slice(0, -2), /^The JSON is not valid/],
    ['a changed ID', (text) => text.replace(MACHINE, 'urn:ngsi-ld:Machine:other'), `The entity ID cannot be changed; it must stay ${MACHINE}.`],
    ['a changed type', (text) => text.replace('"Machine"', '"Robot"'), 'The entity type cannot be changed; it must stay Machine.'],
  ])('edit the raw JSON: %s is reported and nothing is saved', async (_name, change, message) => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await expandedNode('Press brake 01')
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Press brake 01' }))
    const raw = await screen.findByLabelText('Entity JSON')
    const before = structuredClone(entityStored(MACHINE))
    fireEvent.change(raw, { target: { value: change(raw.value).replace('"Press brake 01"', '"Renamed"') } })
    await user.click(screen.getByRole('button', { name: 'Save JSON' }))
    expect(await within(node(MACHINE)).findByRole('alert')).toHaveTextContent(message)
    expect(raw).toHaveAttribute('aria-invalid', 'true')
    expect(entityStored(MACHINE)).toEqual(before)
  })

  test('an unknown entity is not found and the query bar stays usable', async () => {
    const user = userEvent.setup()
    openEntity('urn:ngsi-ld:Machine:nope')
    expect(await screen.findByRole('heading', { name: 'Entity not found' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Entity type'), await within(screen.getByLabelText('Entity type')).findByRole('option', { name: 'Factory' }))
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    await waitFor(async () => expect((await nodeHeadings()).map((h) => h.textContent)).toEqual([expect.stringContaining('Plant North')]))
    expect(window.location.pathname).toBe('/explorer')
  })
})

describe('relationship and IRI navigation', () => {
  test('following a relationship opens the target, keeps the query, and back returns', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR, '?type=Sensor')
    await expandedNode('Process chiller 01 flow')
    await waitFor(() => expect(attribute('measures')).not.toBeNull())
    await user.click(within(attribute('measures')).getByRole('link', { name: CHILLER }))
    expect(await expandedNode('Process chiller 01')).toBeVisible()
    expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${CHILLER}`)
    expect(window.location.search).toBe('?type=Sensor')
    act(() => window.history.back())
    await waitFor(() => expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${SENSOR}`))
    expect(await expandedNode('Process chiller 01 flow')).toBeVisible()
    expect(screen.queryByText('Opened entity, not among the query results:')).not.toBeInTheDocument()
  })

  test('expanding a relationship shows the target nested and indented, and marks a target shown above', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    store.update((s) => {
      s.entities.find((e) => e.id === CHILLER).monitoredBy = { type: 'Relationship', object: SENSOR }
      return s
    })
    await expandedNode('Process chiller 01 flow')
    await waitFor(() => expect(attribute('measures')).not.toBeNull())
    const expand = within(attribute('measures')).getByRole('button', { name: `Expand ${CHILLER} in place` })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await user.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    const nested = await waitFor(() => {
      const el = attribute('measures').querySelector(`.attr-line__nested [data-entity="${CHILLER}"]`)
      expect(el).not.toBeNull()
      return el
    })
    expect(nested).toHaveClass('entity-node--depth-1')
    expect(await within(nested).findByRole('heading', { level: 4, name: 'Process chiller 01' })).toBeVisible()
    await waitFor(() => expect(attribute('monitoredBy', nested)).not.toBeNull())
    expect(attribute('monitoredBy', nested)).toHaveTextContent('shown above')
    expect(within(attribute('monitoredBy', nested)).queryByRole('button', { name: /in place$/ })).not.toBeInTheDocument()
    // The nested target's own relationship expands one level deeper.
    await user.click(within(attribute('partOf', nested)).getByRole('button', { name: `Expand ${LINE_A} in place` }))
    expect(await within(nested).findByRole('heading', { level: 5, name: /Line A/ })).toBeVisible()
    await user.click(expand)
    expect(attribute('measures').querySelector('.attr-line__nested')).toBeNull()
  })

  test('nesting stops at the depth limit', async () => {
    const user = userEvent.setup()
    const chain = Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `urn:ngsi-ld:Thing:t${i}`)
    openEntity(chain[0])
    addEntities(
      ...chain.map((id, i) => ({ id, type: 'Thing', name: { type: 'Property', value: `Thing ${i}` }, next: { type: 'Relationship', object: chain[i + 1] ?? chain[0] } })),
    )
    await expandedNode('Thing 0')
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const owner = node(chain[depth])
      await waitFor(() => expect(attribute('next', owner)).not.toBeNull())
      await user.click(within(attribute('next', owner)).getByRole('button', { name: `Expand ${chain[depth + 1]} in place` }))
    }
    const deepest = node(chain[MAX_DEPTH])
    expect(deepest).toHaveClass('entity-node--depth-0')
    await waitFor(() => expect(attribute('next', deepest)).not.toBeNull())
    expect(attribute('next', deepest)).toHaveTextContent('nesting limit')
    expect(within(attribute('next', deepest)).queryByRole('button', { name: /in place$/ })).not.toBeInTheDocument()
  })

  test('a missing relationship target is reported inline', async () => {
    const user = userEvent.setup()
    const LONELY = 'urn:ngsi-ld:Thing:lonely'
    openEntity(LONELY)
    addEntities({ id: LONELY, type: 'Thing', name: { type: 'Property', value: 'Lonely thing' }, next: { type: 'Relationship', object: 'urn:ngsi-ld:Thing:gone' } })
    await waitFor(() => expect(attribute('next')).not.toBeNull())
    await user.click(within(attribute('next')).getByRole('button', { name: 'Expand urn:ngsi-ld:Thing:gone in place' }))
    expect(await within(attribute('next')).findByText('was not found.', { exact: false })).toHaveTextContent('Entity urn:ngsi-ld:Thing:gone was not found.')
  })

  test('the context menu of an IRI offers open, copy, start incident, active incidents and history', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    const iri = 'urn:ngsi-ld:Component:chiller-01-coolant-pump'
    await expandedNode('Process chiller 01 flow')
    await waitFor(() => expect(attribute('installedOn')).not.toBeNull())
    await user.click(within(attribute('installedOn')).getByRole('button', { name: `Actions for ${iri}` }))
    const menu = within(attribute('installedOn')).getByRole('list')
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(['Open in data explorer', 'Start new incident', 'Show active incidents', 'Show incident history'])
    expect(within(menu).getByRole('link', { name: 'Start new incident' })).toHaveAttribute('href', paths.newIncident(iri))
    await user.click(within(menu).getByRole('button', { name: 'Copy identifier' }))
    expect(await navigator.clipboard.readText()).toBe(iri)
    expect(await screen.findByText(`Copied ${iri}`)).toBeVisible()
  })
})

describe('edit attributes', () => {
  test('selecting a value edits it in place with suggestions; Enter saves and updates the value shown', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await waitFor(() => expect(attribute('status')).not.toBeNull())
    await user.click(within(attribute('status')).getByRole('button', { name: /^Value of status:/ }))
    const input = within(attribute('status')).getByRole('combobox', { name: 'New value of status' })
    expect(input).toHaveFocus()
    const suggestions = await within(attribute('status')).findByRole('listbox', { name: 'Suggested values' })
    expect(within(suggestions).getByRole('option', { name: 'maintenance' })).toBeVisible()
    await user.click(within(suggestions).getByRole('option', { name: 'fault' }))
    expect(input).toHaveValue('fault')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(attribute('status')).toHaveTextContent('status = Value of status: "fault"'))
    expect(screen.queryByRole('combobox', { name: 'New value of status' })).not.toBeInTheDocument()
    expect(entityStored(MACHINE).status.value).toBe('fault')
  })

  test('the keyboard picks a suggestion with the arrow keys, and Escape cancels', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await waitFor(() => expect(attribute('status')).not.toBeNull())
    const before = entityStored(MACHINE).status.value
    within(attribute('status')).getByRole('button', { name: /^Value of status:/ }).focus()
    await user.keyboard('{Enter}')
    const input = within(attribute('status')).getByRole('combobox', { name: 'New value of status' })
    const options = await within(attribute('status')).findAllByRole('option')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(input).toHaveValue(options[0].textContent)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('combobox', { name: 'New value of status' })).not.toBeInTheDocument()
    expect(entityStored(MACHINE).status.value).toBe(before)
    expect(attribute('status')).toHaveTextContent(`"${before}"`)

    await user.click(within(attribute('status')).getByRole('button', { name: 'Edit status' }))
    await user.click(within(attribute('status')).getByRole('button', { name: 'Cancel editing status' }))
    expect(screen.queryByRole('combobox', { name: 'New value of status' })).not.toBeInTheDocument()
  })

  test('a rejected change keeps the input open with the entered value and the reason', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    await user.click(within(attribute('value')).getByRole('button', { name: 'Edit value' }))
    const input = screen.getByRole('combobox', { name: 'New value of value' })
    await user.clear(input)
    await user.type(input, 'high')
    await user.click(screen.getByRole('button', { name: 'Save value' }))
    expect(await within(attribute('value')).findByRole('alert')).toHaveTextContent('Not saved: value must be a number.')
    expect(screen.getByRole('combobox', { name: 'New value of value' })).toHaveValue('high')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  test('a sub-attribute value is edited in place', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    await user.click(within(attribute('value')).getByRole('button', { name: '2 sub-attributes of value' }))
    await user.click(screen.getByRole('button', { name: /^Value of sub-attribute accuracy of value:/ }))
    const input = screen.getByRole('combobox', { name: 'New value of accuracy of value' })
    await user.clear(input)
    await user.type(input, '0.5{Enter}')
    await waitFor(() => expect(entityStored(SENSOR).value.accuracy.value).toBe(0.5))
    expect(entityStored(SENSOR).value.accuracy.unitCode).toBe('l/min')
    expect(entityStored(SENSOR).value.calibratedAt).toBeDefined()
  })

  test('deleting a sub-attribute after confirmation removes only that sub-attribute', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    await user.click(within(attribute('value')).getByRole('button', { name: '2 sub-attributes of value' }))
    await user.click(screen.getByRole('button', { name: 'Delete sub-attribute accuracy of value' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete the sub-attribute accuracy?' })
    expect(dialog).toHaveTextContent('the attribute value remains')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(attribute('value.accuracy')).toBeNull())
    expect(attribute('value')).not.toBeNull()
    expect(attribute('value')).toHaveTextContent('1 sub-attribute')
    expect(entityStored(SENSOR).value.accuracy).toBeUndefined()
    expect(entityStored(SENSOR).value.calibratedAt).toBeDefined()
    expect(entityStored(SENSOR).value.value).toEqual(expect.any(Number))
  })

  test('adding an attribute and a sub-attribute with inline forms', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await waitFor(() => expect(attribute('status')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Add attribute to Press brake 01' }))
    let form = screen.getByRole('form', { name: 'Add an attribute to Press brake 01' })
    expect(within(form).getByLabelText('Name')).toHaveFocus()
    expect(form.compareDocumentPosition(node(MACHINE).querySelector('.entity-doc')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    await user.type(within(form).getByLabelText('Name'), 'maxStroke')
    await user.type(within(form).getByLabelText('Value'), '250')
    await user.type(within(form).getByLabelText('Unit (optional)'), 'mm')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(attribute('maxStroke')).toHaveTextContent('maxStroke = Value of maxStroke: 250 mm'))
    expect(screen.queryByRole('form', { name: 'Add an attribute to Press brake 01' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add sub-attribute to status' }))
    form = within(attribute('status')).getByRole('form', { name: 'Add a sub-attribute to status' })
    await user.type(within(form).getByLabelText('Name'), 'reason')
    await user.type(within(form).getByLabelText('Value'), 'Planned')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(attribute('status')).toHaveTextContent('1 sub-attribute'))
    await user.click(within(attribute('status')).getByRole('button', { name: '1 sub-attribute of status' }))
    expect(attribute('status.reason')).toHaveTextContent(/^Property reason = .*"Planned"/)
  })

  test('adding an existing attribute keeps the form open with the reason', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await user.click(await screen.findByRole('button', { name: 'Add attribute to Press brake 01' }))
    const form = await screen.findByRole('form', { name: 'Add an attribute to Press brake 01' })
    await user.type(within(form).getByLabelText('Name'), 'status')
    await user.type(within(form).getByLabelText('Value'), 'x')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(`${MACHINE} already has an attribute status.`)
    expect(within(form).getByLabelText('Name')).toHaveValue('status')
  })

  test('deleting an attribute and the entity, each after confirmation', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE, '?type=Machine')
    await waitFor(() => expect(attribute('manufacturer')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Delete manufacturer' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete the attribute manufacturer?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(attribute('manufacturer')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Delete entity Press brake 01' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this entity?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(window.location.pathname).toBe('/explorer'))
    expect(window.location.search).toBe('?type=Machine')
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(7))
    expect(entityStored(MACHINE)).toBeUndefined()
  })
})

describe('attribute history', () => {
  test('numeric history: chart and table with the unit over the chosen range, below the line', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'History of value' }))
    const pane = await screen.findByRole('region', { name: 'History of value' })
    expect(attribute('value')).toContainElement(pane)
    expect(within(pane).getByRole('heading', { level: 4, name: 'History of value' })).toBeVisible()
    await user.selectOptions(within(pane).getByLabelText('Time range'), 'Last hour')
    const table = await within(pane).findByRole('table')
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThanOrEqual(12))
    expect(within(table).getByRole('columnheader', { name: 'Value (l/min)' })).toBeVisible()
    expect(within(table).getByText(/values from .* newest first \(the same values as in the chart\)/)).toBeVisible()
    expect(await within(pane).findByRole('img', { name: /^Line chart of value in l\/min from/ })).toBeVisible()
  })

  test('text history is shown as a table only', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await user.click(await screen.findByRole('button', { name: 'History of status' }))
    const pane = await screen.findByRole('region', { name: 'History of status' })
    await within(pane).findByRole('table')
    expect(within(pane).queryByRole('img')).not.toBeInTheDocument()
  })

  test('a range without recorded values says so', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await user.click(await screen.findByRole('button', { name: 'History of value' }))
    const pane = await screen.findByRole('region', { name: 'History of value' })
    await within(pane).findByRole('table')
    await user.selectOptions(within(pane).getByLabelText('Time range'), 'Custom range')
    fireEvent.change(within(pane).getByLabelText('From'), { target: { value: '2020-01-01T00:00' } })
    fireEvent.change(within(pane).getByLabelText('To'), { target: { value: '2020-01-02T00:00' } })
    await user.click(within(pane).getByRole('button', { name: 'Show range' }))
    expect(await within(pane).findByText('There is no data in this time range.')).toBeVisible()
  })
})

describe('time-shift', () => {
  test('a past moment shows types and entities as they were, without editing, and a way back', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR, '?type=Sensor')
    await screen.findByRole('button', { name: 'Edit value' })
    const moment = new Date(Date.now() - 3 * 24 * 3600_000)
    const local = new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    fireEvent.change(screen.getByLabelText('View as of'), { target: { value: local } })
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const banner = await screen.findByRole('region', { name: 'Historical view' })
    expect(banner).toHaveTextContent('Historical view: entity types and entities as they were on')
    expect(banner).toHaveTextContent('Editing is disabled.')
    expect(new URLSearchParams(window.location.search).get('at')).toBe(new Date(local).toISOString())
    await expandedNode('Process chiller 01 flow')
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Edit value' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Value of value/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete entity/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add attribute/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'History of value' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Raw JSON of Process chiller 01 flow' }))
    expect(screen.getByLabelText('Entity JSON')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save JSON' })).not.toBeInTheDocument()
    await within(screen.getByLabelText('Entity type')).findByRole('option', { name: 'Camera' })
    await waitFor(async () => expect((await nodeHeadings()).map((h) => h.textContent).join()).toContain('Press brake 01 noise'))
    expect((await nodeHeadings()).map((h) => h.textContent).join()).not.toContain('Laser cutter 02 power')
    expect(screen.getByText('Live updates paused (historical view)')).toBeVisible()

    await user.click(within(banner).getByRole('button', { name: 'Return to the present' }))
    expect(screen.queryByRole('region', { name: 'Historical view' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Edit value' })).toBeVisible()
    expect(window.location.search).toBe('?type=Sensor')
  })

  test('a moment in the future is refused', async () => {
    const user = userEvent.setup()
    open(paths.explorer())
    fireEvent.change(await screen.findByLabelText('View as of'), { target: { value: '2999-01-01T00:00' } })
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('Choose a moment in the past.')).toBeVisible()
    expect(window.location.search).toBe('')
  })
})

describe('import and bulk delete', () => {
  const file = (text, name = 'entities.json') => new File([text], name, { type: 'application/json' })

  test('import from a file: preview, then the result per entity', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`)
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(8))
    await user.click(screen.getByRole('button', { name: 'Import…' }))
    const dialog = screen.getByRole('dialog', { name: 'Import entities' })
    const doc = [
      { id: 'urn:ngsi-ld:Machine:saw-01', type: 'Machine', name: { type: 'Property', value: 'Band saw 01' } },
      { id: MACHINE, type: 'Machine', name: { type: 'Property', value: 'Press brake 01 (renamed)' } },
      { id: 'urn:ngsi-ld:Machine:bad-01', type: 'Machine', status: { type: 'Relationship', object: 'not a uri' } },
    ]
    await user.upload(within(dialog).getByLabelText('File with NGSI-LD entities (JSON)'), file(JSON.stringify(doc)))
    const preview = await within(dialog).findByRole('region', { name: 'Preview' })
    expect(preview).toHaveTextContent('3 entities are ready to import.')
    expect(within(preview).getAllByRole('row')).toHaveLength(4)
    await user.click(within(dialog).getByRole('button', { name: 'Import 3 entities' }))
    const results = await within(dialog).findByRole('region', { name: 'Import results' })
    expect(results).toHaveTextContent('Import finished: 1 created, 1 updated, 1 failed.')
    const rows = within(results).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows[0]).toContain('Created')
    expect(rows[1]).toContain('Updated')
    expect(rows[2]).toMatch(/Failed.*must be an entity ID/)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(9))
  })

  test.each([
    ['not JSON', '{ "id": ', 'The file is not valid JSON'],
    ['without type', JSON.stringify([{ id: 'urn:ngsi-ld:Machine:x' }]), 'Entry 1 (urn:ngsi-ld:Machine:x) has no type.'],
    ['without ID', JSON.stringify([{ type: 'Machine' }]), 'Entry 1 has no ID'],
  ])('an invalid file (%s) is explained and import is not offered', async (_name, text, problem) => {
    const user = userEvent.setup()
    open(paths.explorer())
    await user.click(await screen.findByRole('button', { name: 'Import…' }))
    const dialog = screen.getByRole('dialog', { name: 'Import entities' })
    await user.upload(within(dialog).getByLabelText('File with NGSI-LD entities (JSON)'), file(text))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(problem)
    expect(within(dialog).queryByRole('button', { name: /^Import \d+/ })).not.toBeInTheDocument()
  })

  test('import from a URL', async () => {
    const user = userEvent.setup()
    open(paths.explorer())
    await user.click(await screen.findByRole('button', { name: 'Import…' }))
    const dialog = screen.getByRole('dialog', { name: 'Import entities' })
    await user.click(within(dialog).getByLabelText('URL'))
    await user.type(within(dialog).getByLabelText('Document URL'), 'https://elsewhere.example.org/x.json')
    await user.click(within(dialog).getByRole('button', { name: 'Fetch' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be fetched')
    await user.clear(within(dialog).getByLabelText('Document URL'))
    await user.type(within(dialog).getByLabelText('Document URL'), 'https://samples.example.org/ngsi-ld/line-d.json')
    await user.click(within(dialog).getByRole('button', { name: 'Fetch' }))
    expect(await within(dialog).findByText('3 entities are ready to import.', { exact: false })).toBeVisible()
  })

  test('delete by type: confirmation, then the number deleted per type and a refreshed list', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Sensor`)
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(13))
    await user.click(screen.getByRole('button', { name: 'Delete by type…' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete entities by type' })
    await user.click(within(dialog).getByLabelText('Sensor'))
    await user.click(within(dialog).getByLabelText('Component'))
    await user.click(within(dialog).getByRole('button', { name: 'Delete entities…' }))
    expect(dialog).toHaveTextContent('All entities of the types Sensor, Component are deleted. This cannot be undone.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete all' }))
    const done = await within(dialog).findByRole('region', { name: 'Deleted entities' })
    expect(done).toHaveTextContent('Sensor: 13 entities deleted')
    expect(done).toHaveTextContent('Component: 18 entities deleted')
    expect(await within(await listRegion()).findByText('No entities matched the query.')).toBeVisible()
  })
})

describe('live updates', () => {
  afterEach(() => vi.useRealTimers())

  test('a changed value appears without reload and is highlighted briefly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    openEntity(SENSOR)
    writeControls({ speed: 10 })
    await waitFor(() => expect(attribute('value')).not.toBeNull())
    expect(await screen.findByText('Live updates working')).toBeVisible()
    const before = entityStored(SENSOR).value.value
    await act(() => vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 + 50))
    const after = entityStored(SENSOR).value.value
    expect(after).not.toBe(before)
    await waitFor(() => expect(attribute('value')).toHaveTextContent(`value = Value of value: ${after} l/min`))
    expect(lineOf('value')).toHaveClass('attr-line--changed')
    expect(within(attribute('value')).getByText('Updated')).toBeVisible()
    writeControls({ liveUpdates: 'unavailable' })
    await act(() => vi.advanceTimersByTimeAsync(HIGHLIGHT_MS + 50))
    expect(lineOf('value')).not.toHaveClass('attr-line--changed')
  })

  test('every expanded node receives live updates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const OTHER = 'urn:ngsi-ld:Sensor:chiller-01-coolant-temperature'
    openEntity(SENSOR, '?type=Sensor')
    writeControls({ speed: 10 })
    await screen.findByText('Live updates working')
    await user.click(await screen.findByRole('button', { name: 'Process chiller 01 coolant temperature' }))
    await waitFor(() => expect(attribute('value', node(OTHER))).not.toBeNull())
    await act(() => vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 + 50))
    await waitFor(() => expect(lineOf('value', node(OTHER))).toHaveClass('attr-line--changed'))
    expect(lineOf('value', node(SENSOR))).toHaveClass('attr-line--changed')
  })

  test('when live updates cannot be delivered the indicator says so and the explorer keeps working', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`, { liveUpdates: 'unavailable' })
    expect(await screen.findByText('Live updates unavailable')).toBeVisible()
    await waitFor(async () => expect(await nodeHeadings()).toHaveLength(8))
    await user.click(screen.getByRole('button', { name: 'Laser cutter 01' }))
    await waitFor(() => expect(attribute('status', node('urn:ngsi-ld:Machine:laser-cutter-01'))).not.toBeNull())
  })

  test('live updates can be switched off', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await screen.findByText('Live updates working')
    await user.click(screen.getByLabelText('Live updates'))
    expect(screen.getByText('Live updates off')).toBeVisible()
  })
})

