import { COMPONENTS, LINES, MACHINES, PEERS, SENSORS, urn } from './catalog'
import { applyNext, createRunRecord, incidentFromRun, initialCounters, simulate } from './runCore'
import { machineStatusAt, sensorValueAt } from './history'
import { buildKnowledgeBase } from './kbContent'

export { PEERS }

/**
 * Deterministic seed for the mock data source. The same seed always yields
 * the same data (given the same `now`), and every reference between areas
 * (runs, incidents and alerts → machines, machines → lines → factory) resolves.
 * Runs and past incidents are produced by playing their scenarios with the
 * run engine, so their steps, states and conversations are consistent.
 */

/** Small deterministic PRNG (mulberry32). */
export function createRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
  }
}

export const SEED = 20261102
/** Stored state with another version is discarded and rebuilt from the seed. */
export const SEED_VERSION = 4
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const prop = (value, extra = {}) => ({ type: 'Property', value, ...extra })
const rel = (object) => ({ type: 'Relationship', object })
const iri = (id) => prop({ '@id': id })

/** Line shifts (list attribute) and machine configurations (JSON attribute). */
const SHIFTS = { 'line-a': ['early', 'late', 'night'], 'line-b': ['early', 'late'], 'line-c': ['early'] }
const CONFIGURATION = {
  LaserCutter: { firmware: '5.4.2', maxPowerKw: 6, assistGases: ['O2', 'N2'], nozzleChangerSlots: 8 },
  PressBrake: { firmware: '3.1.0', maxForceKn: 2200, axes: ['Y1', 'Y2', 'X', 'R'] },
  Deburring: { firmware: '2.0.7', brushes: 4, beltSpeedMPerMin: 6 },
  Coating: { firmware: '1.9.3', guns: 2, cureTemperatureC: 180 },
  Chiller: { firmware: '4.0.1', setPointC: 18, refrigerant: 'R-513A' },
  Extractor: { firmware: '2.2.0', filterClass: 'H13', fanStages: 3 },
}

function buildEntities(rng, now) {
  const observedAt = new Date(now).toISOString()
  const factoryId = urn('Factory', 'plant-north')
  const entities = [{
    id: factoryId,
    type: 'Factory',
    name: prop('Plant North'),
    description: { type: 'LanguageProperty', languageMap: { en: 'Sheet metal fabrication and finishing', de: 'Blechbearbeitung und Oberflächenveredelung' } },
    address: prop({ addressLocality: 'Rivertown', addressCountry: 'DE' }),
    location: { type: 'GeoProperty', value: { type: 'Point', coordinates: [9.1829, 48.7758] } },
  }]

  for (const line of LINES) {
    entities.push({
      id: urn('ProductionLine', line.id),
      type: 'ProductionLine',
      name: prop(line.name),
      shifts: { type: 'ListProperty', valueList: SHIFTS[line.id] },
      partOf: rel(factoryId),
    })
  }

  for (const m of MACHINES) {
    const machineId = urn('Machine', m.id)
    rng.pick([0]) // keeps the random sequence of earlier seed versions
    entities.push({
      id: machineId,
      type: 'Machine',
      name: prop(m.name),
      machineType: prop(m.kind),
      status: prop(machineStatusAt(machineId, now), { observedAt }),
      operatingMode: { type: 'VocabularyProperty', vocab: m.id === 'coating-01' ? 'setup' : 'automatic' },
      configuration: { type: 'JsonProperty', json: CONFIGURATION[m.kind] },
      partOf: rel(urn('ProductionLine', m.line)),
      manufacturer: prop(PEERS.find((p) => p.id === m.builder).name),
    })
    const components = COMPONENTS[m.kind].map(([cid]) => urn('Component', `${m.id}-${cid}`))
    for (const [cid, cname] of COMPONENTS[m.kind]) {
      entities.push({ id: urn('Component', `${m.id}-${cid}`), type: 'Component', name: prop(cname), partOf: rel(machineId) })
    }
    SENSORS[m.kind].forEach(([sid, unit, lo, hi], i) => {
      const id = urn('Sensor', `${m.id}-${sid}`)
      rng.next() // keeps the random sequence of earlier seed versions
      entities.push({
        id,
        type: 'Sensor',
        name: prop(`${m.name} ${sid.replace(/-/g, ' ')}`),
        value: prop(sensorValueAt(id, now), {
          unitCode: unit,
          observedAt,
          datasetId: 'urn:ngsi-ld:Dataset:live',
          accuracy: prop(Math.round((hi - lo) * 0.01 * 100) / 100, { unitCode: unit }),
          calibratedAt: prop(new Date(now - (30 + i * 11) * DAY).toISOString().slice(0, 10)),
        }),
        installedOn: iri(components[i % components.length]),
        measures: rel(machineId),
      })
    })
  }
  return entities
}

/**
 * Creation and deletion records, so time-shift can rebuild earlier states:
 * a retrofitted sensor created two days ago, and entities deleted yesterday.
 */
function buildEntityLog(now) {
  const machine = urn('Machine', 'press-brake-01')
  return {
    created: { [urn('Sensor', 'laser-cutter-02-power')]: new Date(now - 2 * DAY).toISOString() },
    deleted: [
      {
        at: new Date(now - DAY).toISOString(),
        entity: { id: urn('Sensor', 'press-brake-01-noise'), type: 'Sensor', name: prop('Press brake 01 noise'), value: prop(71.5, { unitCode: 'dB', observedAt: new Date(now - DAY - 10 * MINUTE).toISOString() }), measures: rel(machine) },
      },
      {
        at: new Date(now - DAY).toISOString(),
        entity: { id: urn('Camera', 'line-a-inspection'), type: 'Camera', name: prop('Line A inspection camera'), resolution: prop('4K'), partOf: rel(urn('ProductionLine', 'line-a')) },
      },
    ],
  }
}

const confirm = ['confirmResolution', { confirmed: true }]
const escalate = ['escalate']
const act = (a, extra = {}) => ['sendConversationAct', { act: a, ...extra }]

/** Past incidents: scenario, operator actions and age in days. */
const INCIDENT_TEMPLATES = [
  ['press-brake-01', 'Back gauge positions parts 0.3 mm short on long flanges', 'happy_path', [confirm], 44],
  ['laser-cutter-02', 'Piercing takes twice as long on 8 mm stainless steel', 'low_confidence', [['clarify', { text: 'Only on sheets from the new supplier; the protective window was replaced last week.' }], confirm], 39],
  ['chiller-01', 'Coolant flow alarm after weekend start-up', 'mb_recommendation', [escalate, ['replyToRecommendation', { action: 'resolved' }]], 33],
  ['deburring-01', 'Brush unit vibrates above limit at full speed', 'rejected_resolution', [['confirmResolution', { confirmed: false, text: 'The brush roller was replaced two days ago.' }], confirm], 28],
  ['coating-01', 'Powder output fluctuates on the right spray gun', 'failure', [], 24],
  ['extractor-01', 'Extraction volume too low while laser cutter 01 is running', 'mb_closes', [escalate, ['refreshConversationStatus']], 20],
  ['laser-cutter-01', 'Cutting head collision alarm without visible contact', 'direct_contact', [escalate, act('escalate'), act('close', { outcome: 'escalated' })], 16],
  ['press-brake-02', 'Oil temperature reaches 60 °C after two hours', 'degraded_data', [confirm], 12],
  ['laser-cutter-02', 'Assist gas consumption 20 % above normal', 'request_beyond_tier', [escalate, ['approveDataRequest', { approved: true }], act('close', { outcome: 'resolved' })], 9],
  ['deburring-01', 'Conveyor stops intermittently at the infeed', 'stop_and_reopen', [escalate, ['stopRun']], 6],
  ['chiller-01', 'Compressor short-cycling during the night shift', 'escalation_within_tier', [escalate, act('request', { text: 'Do you expect a spare part to be needed?' }), act('grant'), act('close', { outcome: 'resolved' })], 4],
  ['coating-01', 'Curing oven reaches temperature 10 minutes late', 'happy_path', [confirm], 2],
]

/** Open runs: scenario, operator actions so far, age in minutes; `partial` plays only the first events. */
const RUN_TEMPLATES = [
  { machine: 'laser-cutter-01', issue: 'Cut quality degraded: burr formation on 3 mm steel since shift start', scenario: 'happy_path', ageMin: 4, partial: 3 },
  { machine: 'press-brake-02', issue: 'Hydraulic pressure drops intermittently during bending cycle', scenario: 'low_confidence', ageMin: 38 },
  { machine: 'chiller-01', issue: 'Coolant temperature above set point, laser source derating', scenario: 'escalation_within_tier', ageMin: 190, actions: [escalate] },
  { machine: 'coating-01', issue: 'Uneven coating thickness on left side of parts', scenario: 'rejected_resolution', ageMin: 75 },
]

/** Builds past incidents and open runs by playing their scenarios with the run engine. */
function buildRunsAndIncidents(now) {
  const state = { counters: { ...initialCounters(), run: 901, incident: 30 } }
  const env = { state, connected: true }

  const incidents = INCIDENT_TEMPLATES.map(([machine, issue, scenario, actions, ageDays]) => {
    const clock = { t: now - ageDays * DAY, scale: 60 }
    const run = createRunRecord({ runId: `run-${state.counters.run++}`, machineId: urn('Machine', machine), issue, scenario, at: new Date(clock.t).toISOString() })
    simulate(run, env, actions, clock)
    return incidentFromRun(run, new Date(clock.t + 10 * MINUTE).toISOString())
  }).reverse()

  state.counters.run = 1001
  const runs = RUN_TEMPLATES.map((t) => {
    const clock = { t: now - t.ageMin * MINUTE, scale: 30 }
    const run = createRunRecord({ runId: `run-${state.counters.run++}`, machineId: urn('Machine', t.machine), issue: t.issue, scenario: t.scenario, at: new Date(clock.t).toISOString() })
    if (t.partial) {
      for (let i = 0; i < t.partial; i++) {
        clock.t += (run.queue[0].delay ?? 0) * clock.scale
        applyNext(run, new Date(clock.t).toISOString(), env)
      }
    } else {
      simulate(run, env, t.actions ?? [], clock)
    }
    return run
  })

  return { runs, incidents, counters: state.counters }
}

export const ALERT_EVENTS = [
  ['TemperatureHigh', 'Temperature above threshold', '°C'],
  ['PressureLow', 'Pressure below threshold', 'bar'],
  ['VibrationHigh', 'Vibration level elevated', 'mm/s'],
  ['FlowLow', 'Coolant flow below minimum', 'l/min'],
  ['FilterClogged', 'Filter differential pressure high', 'Pa'],
  ['DoorOpen', 'Safety door opened during operation', null],
]

export const ALERT_ENVIRONMENTS = ['Production', 'Commissioning']
export const serviceOf = (machine) => (machine.line === 'line-a' ? 'Line A' : machine.line === 'line-b' ? 'Line B' : 'Line C')

/** A newly raised alert of the mock alert manager. */
export function createAlert({ id, machine, event, severity, at, environment = 'Production', value = null }) {
  const [name, text] = ALERT_EVENTS.find(([e]) => e === event)
  return {
    id,
    resource: urn('Machine', machine.id),
    event: name,
    text: `${machine.name}: ${text}`,
    severity,
    status: 'open',
    environment,
    service: [serviceOf(machine)],
    group: 'Machine',
    value,
    origin: 'condition-monitoring',
    type: 'exceptionAlert',
    createTime: at,
    lastReceiveTime: at,
    duplicateCount: 0,
    attributes: { line: machine.line, machineType: machine.kind },
    history: [{ at, type: 'new', status: 'open', severity, text: 'Alert raised.', user: null }],
  }
}

const STATUS_NOTES = {
  ack: 'Checked at the machine; monitoring the value.',
  shelved: 'Planned maintenance on this machine this week.',
  closed: 'Value back within limits.',
}

function buildAlerts(rng, now) {
  const severities = ['critical', 'major', 'major', 'minor', 'minor', 'warning', 'warning', 'informational']
  const statuses = ['open', 'open', 'open', 'ack', 'closed']
  return Array.from({ length: 16 }, (_, i) => {
    const machine = rng.pick(MACHINES)
    const [event, , unit] = rng.pick(ALERT_EVENTS)
    const severity = rng.pick(severities)
    const picked = rng.pick(statuses)
    const at = now - rng.int(5, 3 * 24 * 60) * MINUTE
    const status = i === 10 ? 'shelved' : picked
    const alert = createAlert({
      id: `alert-${String(i + 1).padStart(3, '0')}`,
      machine,
      event,
      severity,
      at: new Date(at).toISOString(),
      environment: i % 4 === 3 ? 'Commissioning' : 'Production',
      value: unit ? `${10 + ((i * 37) % 90)} ${unit}` : null,
    })
    alert.duplicateCount = i % 3
    alert.lastReceiveTime = new Date(at + (now - at) * 0.2).toISOString()
    const steps = { ack: ['ack'], shelved: ['shelved'], closed: ['ack', 'closed'] }[status] ?? []
    steps.forEach((s, k) => {
      alert.history.push({ at: new Date(at + (now - at) * (0.4 + 0.2 * k)).toISOString(), type: 'status', status: s, severity, text: STATUS_NOTES[s], user: 'Alex Operator' })
    })
    alert.status = status
    return alert
  })
}

const HEALTH_CHECKS = [
  ['context-broker', 'NGSI-LD context broker', 18],
  ['timeseries', 'Time-series database', 9],
  ['memory', 'Incident memory database', 6],
  ['alerts', 'Alert manager', 22],
  ['message-broker', 'Message broker', 4],
  ['llm', 'Language model', 240],
  ['gateway', 'Dataspace gateway', 64],
  ['knowledge-base', 'Knowledge base', 35],
]

/**
 * Dataspace policies: what each peer may access here (`policies`), what this
 * factory may access at each peer (`remoteGrants`), and incoming capability
 * requests. Capabilities without an entry are at their default.
 */
function buildDataspace(now) {
  const at = (days) => new Date(now - days * DAY).toISOString()
  return {
    policies: {
      'peer-photonic': { 'twin:direct': 'granted', 'twin:adjacents': 'granted' },
      'peer-formwerk': { 'twin:direct': 'granted', 'twin:history': 'denied' },
      'peer-coolflow': { 'twin:direct': 'granted', 'twin:history': 'granted' },
    },
    remoteGrants: {
      'peer-photonic': { 'twin:direct': 'granted', 'twin:history': 'denied' },
      'peer-formwerk': { 'twin:direct': 'granted' },
      'peer-surfacetec': {},
      'peer-coolflow': { 'twin:direct': 'granted', 'twin:history': 'granted' },
    },
    capabilityRequests: [
      { id: 'req-005', requesterId: 'peer-formwerk', capability: 'twin:history', purpose: 'Analyse hydraulic pressure trends of press brakes 01 and 02 before the next service visit.', requestedAt: at(0.2), status: 'pending', note: null, decidedAt: null },
      { id: 'req-004', requesterId: 'peer-surfacetec', capability: 'twin:adjacents', purpose: 'Include spray gun and curing oven components in remote diagnostics.', requestedAt: at(1.5), status: 'pending', note: null, decidedAt: null },
      { id: 'req-003', requesterId: 'peer-hydroservice', capability: 'twin:direct', purpose: 'Offer condition-based maintenance of hydraulic units.', requestedAt: at(3), status: 'pending', note: null, decidedAt: null },
      { id: 'req-002', requesterId: 'peer-coolflow', capability: 'twin:history', purpose: 'Long-term monitoring of the process chiller.', requestedAt: at(8), status: 'approved', note: 'Agreed in the service contract.', decidedAt: at(7) },
      { id: 'req-001', requesterId: 'peer-photonic', capability: 'twin:history', purpose: 'Benchmark cutting performance across customers.', requestedAt: at(12), status: 'denied', note: 'Only per incident, not for benchmarking.', decidedAt: at(11) },
    ],
  }
}

export function buildSeed({ seed = SEED, now = Date.now() } = {}) {
  const rng = createRng(seed)
  const { runs, incidents, counters } = buildRunsAndIncidents(now)
  return {
    version: SEED_VERSION,
    createdAt: new Date(now).toISOString(),
    factory: {
      id: 'urn:ngsi-ld:Factory:plant-north',
      name: 'Plant North',
      owner: 'Northwind Fabrication GmbH',
      location: { city: 'Rivertown', country: 'Germany' },
    },
    companyId: 'company-northwind',
    user: { username: 'operator', name: 'Alex Operator', email: 'operator@example.org' },
    session: { signedIn: false, revision: 0 },
    entities: buildEntities(rng, now),
    entityLog: buildEntityLog(now),
    runs,
    incidents,
    counters: { ...counters, alert: 17, job: 1 },
    alerts: buildAlerts(rng, now),
    peers: PEERS,
    connection: { state: 'connected', participantId: 'participant-plant-north', expiresAt: new Date(now + 8 * 60 * MINUTE).toISOString(), sharingTier: 'minimal' },
    dataspace: buildDataspace(now),
    health: HEALTH_CHECKS.map(([id, label, latencyMs]) => ({ id, label, latencyMs })),
    settings: {},
    kb: buildKnowledgeBase(now),
  }
}
