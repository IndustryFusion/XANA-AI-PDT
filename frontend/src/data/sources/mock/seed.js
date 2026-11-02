import { COMPONENTS, LINES, MACHINES, PEERS, SENSORS, urn } from './catalog'
import { applyNext, createRunRecord, incidentFromRun, initialCounters, simulate } from './runCore'

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
export const SEED_VERSION = 2
const MINUTE = 60_000

const prop = (value, extra = {}) => ({ type: 'Property', value, ...extra })
const rel = (object) => ({ type: 'Relationship', object })

function buildEntities(rng, now) {
  const observedAt = new Date(now).toISOString()
  const factoryId = urn('Factory', 'plant-north')
  const entities = [{
    id: factoryId,
    type: 'Factory',
    name: prop('Plant North'),
    address: prop({ addressLocality: 'Rivertown', addressCountry: 'DE' }),
  }]

  for (const line of LINES) {
    entities.push({ id: urn('ProductionLine', line.id), type: 'ProductionLine', name: prop(line.name), partOf: rel(factoryId) })
  }

  for (const m of MACHINES) {
    const machineId = urn('Machine', m.id)
    entities.push({
      id: machineId,
      type: 'Machine',
      name: prop(m.name),
      machineType: prop(m.kind),
      status: prop(rng.pick(['running', 'running', 'running', 'idle']), { observedAt }),
      partOf: rel(urn('ProductionLine', m.line)),
      manufacturer: prop(PEERS.find((p) => p.id === m.builder).name),
    })
    for (const [cid, cname] of COMPONENTS[m.kind]) {
      entities.push({ id: urn('Component', `${m.id}-${cid}`), type: 'Component', name: prop(cname), partOf: rel(machineId) })
    }
    for (const [sid, unit, lo, hi] of SENSORS[m.kind]) {
      const value = Math.round((lo + rng.next() * (hi - lo)) * 10) / 10
      entities.push({
        id: urn('Sensor', `${m.id}-${sid}`),
        type: 'Sensor',
        name: prop(`${m.name} ${sid.replace(/-/g, ' ')}`),
        value: prop(value, { unitCode: unit, observedAt }),
        measures: rel(machineId),
      })
    }
  }
  return entities
}

const DAY = 24 * 60 * MINUTE
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

const ALERT_EVENTS = [
  ['TemperatureHigh', 'Temperature above threshold'],
  ['PressureLow', 'Pressure below threshold'],
  ['VibrationHigh', 'Vibration level elevated'],
  ['FlowLow', 'Coolant flow below minimum'],
  ['FilterClogged', 'Filter differential pressure high'],
  ['DoorOpen', 'Safety door opened during operation'],
]

function buildAlerts(rng, now) {
  const severities = ['critical', 'major', 'major', 'minor', 'minor', 'warning', 'warning', 'informational']
  const statuses = ['open', 'open', 'open', 'ack', 'closed']
  return Array.from({ length: 16 }, (_, i) => {
    const machine = rng.pick(MACHINES)
    const [event, text] = rng.pick(ALERT_EVENTS)
    return {
      id: `alert-${String(i + 1).padStart(3, '0')}`,
      resource: urn('Machine', machine.id),
      event,
      text: `${machine.name}: ${text}`,
      severity: rng.pick(severities),
      status: rng.pick(statuses),
      environment: 'Production',
      service: [machine.line === 'line-a' ? 'Line A' : machine.line === 'line-b' ? 'Line B' : 'Line C'],
      createTime: new Date(now - rng.int(5, 3 * 24 * 60) * MINUTE).toISOString(),
    }
  })
}

const HEALTH_CHECKS = [
  ['context-broker', 'NGSI-LD context broker', 18],
  ['timeseries', 'Time-series database', 9],
  ['memory', 'Incident memory database', 6],
  ['alerts', 'Alert manager', 22],
  ['llm', 'Language model', 240],
  ['gateway', 'Dataspace gateway', 64],
  ['knowledge-base', 'Knowledge base', 35],
]

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
    runs,
    incidents,
    counters,
    alerts: buildAlerts(rng, now),
    peers: PEERS,
    connection: { state: 'connected', participantId: 'participant-plant-north', expiresAt: new Date(now + 8 * 60 * MINUTE).toISOString() },
    health: HEALTH_CHECKS.map(([id, label, latencyMs]) => ({ id, label, latencyMs })),
  }
}
