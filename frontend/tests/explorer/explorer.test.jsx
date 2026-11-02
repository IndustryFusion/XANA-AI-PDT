import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { LIVE_UPDATE_MS } from '../../src/data/sources/mock/entitiesArea'
import { HIGHLIGHT_MS } from '../../src/features/explorer/EntityView'
import { renderApp } from '../helpers'

const controls = { authEnabled: false }
const FACTORY = 'urn:ngsi-ld:Factory:plant-north'
const LINE_A = 'urn:ngsi-ld:ProductionLine:line-a'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'
const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'

const open = (path, extra = {}) => renderApp({ path, controls: { ...controls, ...extra } })
const openEntity = (id, search = '') => open(`${paths.entity(id)}${search}`)
const listRegion = () => screen.findByRole('region', { name: 'Entities' })
const entityLinks = async () => within(await listRegion()).queryAllByRole('link')
const attribute = (name) => document.querySelector(`[data-attribute="${name}"]`)
const entityStored = (id) => store.get().entities.find((e) => e.id === id)

describe('query entities', () => {
  test('by type: entities with ID, type and name, and the URL reflects the query', async () => {
    const user = userEvent.setup()
    open(paths.explorer())
    expect(await within(await listRegion()).findByText('No query yet.')).toBeVisible()
    const type = screen.getByLabelText('Entity type')
    await within(type).findByRole('option', { name: 'Machine' })
    await user.selectOptions(type, 'Machine')
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    await waitFor(async () => expect(await entityLinks()).toHaveLength(8))
    expect(window.location.search).toBe('?type=Machine')
    const first = (await entityLinks())[0]
    expect(first).toHaveTextContent('Laser cutter 01')
    expect(first).toHaveTextContent('Machine')
    expect(first).toHaveTextContent('urn:ngsi-ld:Machine:laser-cutter-01')
    expect(screen.getByText('8 entities')).toBeVisible()
  })

  test('attribute conditions combined with OR: only matching entities and the expression is shown', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`)
    await waitFor(async () => expect(await entityLinks()).toHaveLength(8))
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
    await waitFor(async () => expect((await entityLinks()).map((l) => l.textContent)).toEqual([
      expect.stringContaining('Powder coating booth 01'), expect.stringContaining('Process chiller 01'),
    ]))
    expect(new URLSearchParams(window.location.search).get('q')).toBe('machineType=="Chiller"|operatingMode=="setup"')
    // The builder is restored from the URL.
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
    await waitFor(async () => expect(await entityLinks()).toHaveLength(13))
    await user.type(screen.getByLabelText('ID pattern'), '[[unclosed')
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    const form = screen.getByRole('button', { name: 'Apply query' }).closest('form')
    expect(await within(form).findByRole('alert')).toHaveTextContent('The query was rejected: The ID pattern "[unclosed" is not a valid regular expression.')
    expect(await entityLinks()).toHaveLength(13)
  })
})

describe('entity view', () => {
  test('typed attributes: each shows its kind and a fitting presentation', async () => {
    openEntity(FACTORY)
    expect(await screen.findByRole('heading', { level: 2, name: 'Plant North' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 3, name: 'Geo properties' })).toBeVisible()
    expect(within(attribute('location')).getByText('Geo')).toBeVisible()
    expect(attribute('location')).toHaveTextContent('Point · 48.7758° N, 9.1829° E')
    expect(within(attribute('description')).getByText('Language')).toBeVisible()
    expect(within(attribute('description')).getByText('Blechbearbeitung und Oberflächenveredelung')).toHaveAttribute('lang', 'de')
    expect(within(attribute('address')).getByText('Property')).toBeVisible()
    expect(attribute('address')).toHaveTextContent('addressLocalityRivertown')
  })

  test.each([
    ['urn:ngsi-ld:Machine:laser-cutter-01', [['operatingMode', 'Vocabulary', 'automatic'], ['configuration', 'JSON', 'maxPowerKw6'], ['partOf', 'Relationship', LINE_A]]],
    [LINE_A, [['shifts', 'List', 'earlylatenight']]],
    [SENSOR, [['installedOn', 'IRI', 'urn:ngsi-ld:Component:chiller-01-coolant-pump'], ['measures', 'Relationship', 'urn:ngsi-ld:Machine:chiller-01']]],
  ])('%s: kinds and values', async (id, expected) => {
    openEntity(id)
    await screen.findByRole('tab', { name: 'Attributes' })
    for (const [name, kind, text] of expected) {
      await waitFor(() => expect(attribute(name)).not.toBeNull())
      expect(within(attribute(name)).getAllByText(kind)[0]).toHaveClass('kind-tag')
      expect(attribute(name)).toHaveTextContent(text)
    }
  })

  test('values with unit, observation time, dataset and sub-attributes', async () => {
    openEntity(SENSOR)
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    const value = attribute('value')
    expect(value).toHaveTextContent(/\d+(\.\d)? l\/min/)
    expect(value).toHaveTextContent('Unit l/min')
    expect(value).toHaveTextContent('Observed')
    expect(value).toHaveTextContent('Dataset urn:ngsi-ld:Dataset:live')
    const subs = within(value).getByRole('list', { name: 'Sub-attributes of value' })
    expect(within(subs).getByText('accuracy')).toBeVisible()
    expect(within(subs).getByText('calibratedAt')).toBeVisible()
  })

  test('raw JSON can be shown and copied, and the URL names the entity', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await user.click(await screen.findByRole('tab', { name: 'Raw JSON' }))
    const raw = screen.getByLabelText('Entity JSON')
    expect(JSON.parse(raw.textContent)).toMatchObject({ id: MACHINE, type: 'Machine' })
    await user.click(screen.getByRole('button', { name: 'Copy JSON' }))
    expect(JSON.parse(await navigator.clipboard.readText()).id).toBe(MACHINE)
    expect(await screen.findByText('Entity JSON copied.')).toBeVisible()
    expect(decodeURIComponent(window.location.pathname)).toBe(`/explorer/${MACHINE}`)
  })

  test('an unknown entity is not found and the query bar stays usable', async () => {
    const user = userEvent.setup()
    openEntity('urn:ngsi-ld:Machine:nope')
    expect(await screen.findByRole('heading', { name: 'Entity not found' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Entity type'), await within(screen.getByLabelText('Entity type')).findByRole('option', { name: 'Factory' }))
    await user.click(screen.getByRole('button', { name: 'Apply query' }))
    await waitFor(async () => expect(await entityLinks()).toHaveLength(1))
  })
})

describe('relationship and IRI navigation', () => {
  test('following a relationship opens the target, keeps the query, and back returns', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR, '?type=Sensor')
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    await user.click(within(attribute('measures')).getByRole('link', { name: 'urn:ngsi-ld:Machine:chiller-01' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Process chiller 01' })).toBeVisible()
    expect(window.location.search).toBe('?type=Sensor')
    act(() => window.history.back())
    expect(await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })).toBeVisible()
  })

  test('the context menu of an IRI offers open, copy, start incident, active incidents and history', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    const iri = 'urn:ngsi-ld:Component:chiller-01-coolant-pump'
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
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
  test('suggested values are offered and saving updates the value shown', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await screen.findByRole('heading', { level: 2, name: 'Press brake 01' })
    await user.click(screen.getByRole('button', { name: 'Edit status' }))
    const suggestions = await screen.findByRole('group', { name: 'Suggested values' })
    expect(within(suggestions).getByRole('button', { name: 'maintenance' })).toBeVisible()
    await user.click(within(suggestions).getByRole('button', { name: 'fault' }))
    expect(screen.getByLabelText('New value of status')).toHaveValue('fault')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(attribute('status')).toHaveTextContent('fault'))
    expect(screen.queryByLabelText('New value of status')).not.toBeInTheDocument()
    expect(entityStored(MACHINE).status.value).toBe('fault')
  })

  test('a rejected change keeps the editor open with the entered value and the reason', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    await user.click(screen.getByRole('button', { name: 'Edit value' }))
    const input = screen.getByLabelText('New value of value (l/min)')
    await user.clear(input)
    await user.type(input, 'high')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Not saved: value must be a number.')).toBeVisible()
    expect(screen.getByLabelText('New value of value (l/min)')).toHaveValue('high')
  })

  test('deleting a sub-attribute after confirmation removes only that sub-attribute', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    await user.click(screen.getByRole('button', { name: 'Delete sub-attribute accuracy of value' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete the sub-attribute accuracy?' })
    expect(dialog).toHaveTextContent('the attribute value remains')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(attribute('value.accuracy')).toBeNull())
    expect(attribute('value')).not.toBeNull()
    expect(attribute('value.calibratedAt')).not.toBeNull()
    expect(entityStored(SENSOR).value.accuracy).toBeUndefined()
    expect(entityStored(SENSOR).value.value).toEqual(expect.any(Number))
  })

  test('adding an attribute and a sub-attribute', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await screen.findByRole('heading', { level: 2, name: 'Press brake 01' })
    await user.click(screen.getByRole('button', { name: 'Add attribute…' }))
    let dialog = screen.getByRole('dialog', { name: 'Add an attribute' })
    await user.type(within(dialog).getByLabelText('Name'), 'maxStroke')
    await user.type(within(dialog).getByLabelText('Value'), '250')
    await user.type(within(dialog).getByLabelText('Unit (optional)'), 'mm')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(attribute('maxStroke')).toHaveTextContent('250 mm'))

    await user.click(screen.getByRole('button', { name: 'Add sub-attribute to status' }))
    dialog = screen.getByRole('dialog', { name: 'Add a sub-attribute to status' })
    await user.type(within(dialog).getByLabelText('Name'), 'reason')
    await user.type(within(dialog).getByLabelText('Value'), 'Planned')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(attribute('status.reason')).toHaveTextContent('Planned'))
  })

  test('adding an existing attribute keeps the dialog open with the reason', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE)
    await user.click(await screen.findByRole('button', { name: 'Add attribute…' }))
    const dialog = screen.getByRole('dialog', { name: 'Add an attribute' })
    await user.type(within(dialog).getByLabelText('Name'), 'status')
    await user.type(within(dialog).getByLabelText('Value'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(`${MACHINE} already has an attribute status.`)
  })

  test('deleting an attribute and the entity, each after confirmation', async () => {
    const user = userEvent.setup()
    openEntity(MACHINE, '?type=Machine')
    await screen.findByRole('heading', { level: 2, name: 'Press brake 01' })
    await user.click(screen.getByRole('button', { name: 'Delete manufacturer' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete the attribute manufacturer?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(attribute('manufacturer')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Delete entity…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this entity?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(window.location.pathname).toBe('/explorer'))
    expect(window.location.search).toBe('?type=Machine')
    await waitFor(async () => expect(await entityLinks()).toHaveLength(7))
    expect(entityStored(MACHINE)).toBeUndefined()
  })
})

describe('attribute history', () => {
  test('numeric history: chart and table with the unit over the chosen range', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await user.click(await screen.findByRole('button', { name: 'History of value' }))
    const pane = await screen.findByRole('region', { name: 'History of value' })
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
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    expect(screen.queryByRole('button', { name: 'Edit value' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete entity…' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import…' })).toBeDisabled()
    await within(screen.getByLabelText('Entity type')).findByRole('option', { name: 'Camera' })
    await waitFor(async () => expect((await entityLinks()).map((l) => l.textContent).join()).toContain('Press brake 01 noise'))
    expect((await entityLinks()).map((l) => l.textContent).join()).not.toContain('Laser cutter 02 power')
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
    await waitFor(async () => expect(await entityLinks()).toHaveLength(8))
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
    await waitFor(async () => expect(await entityLinks()).toHaveLength(9))
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
    await waitFor(async () => expect(await entityLinks()).toHaveLength(13))
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
    openEntity(SENSOR, '', )
    writeControls({ speed: 10 })
    await screen.findByRole('heading', { level: 2, name: 'Process chiller 01 flow' })
    expect(await screen.findByText('Live updates working')).toBeVisible()
    const before = entityStored(SENSOR).value.value
    await act(() => vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 + 50))
    const after = entityStored(SENSOR).value.value
    expect(after).not.toBe(before)
    await waitFor(() => expect(attribute('value')).toHaveTextContent(`${after} l/min`))
    expect(attribute('value')).toHaveClass('attr--changed')
    expect(within(attribute('value')).getByText('Updated')).toBeVisible()
    writeControls({ liveUpdates: 'unavailable' })
    await act(() => vi.advanceTimersByTimeAsync(HIGHLIGHT_MS + 50))
    expect(attribute('value')).not.toHaveClass('attr--changed')
  })

  test('when live updates cannot be delivered the indicator says so and the explorer keeps working', async () => {
    const user = userEvent.setup()
    open(`${paths.explorer()}?type=Machine`, { liveUpdates: 'unavailable' })
    expect(await screen.findByText('Live updates unavailable')).toBeVisible()
    await waitFor(async () => expect(await entityLinks()).toHaveLength(8))
    await user.click((await entityLinks())[0])
    expect(await screen.findByRole('heading', { level: 2, name: 'Laser cutter 01' })).toBeVisible()
  })

  test('live updates can be switched off', async () => {
    const user = userEvent.setup()
    openEntity(SENSOR)
    await screen.findByText('Live updates working')
    await user.click(screen.getByLabelText('Live updates'))
    expect(screen.getByText('Live updates off')).toBeVisible()
  })
})
