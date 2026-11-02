/**
 * Deterministic seed for the mock data source. The same seed always yields
 * the same data (given the same `now`), and every reference between areas
 * (runs and alerts → machines, machines → lines → factory) resolves.
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
const MINUTE = 60_000

const urn = (type, id) => `urn:ngsi-ld:${type}:${id}`
const prop = (value, extra = {}) => ({ type: 'Property', value, ...extra })
const rel = (object) => ({ type: 'Relationship', object })

const LINES = [
  { id: 'line-a', name: 'Line A · Sheet metal' },
  { id: 'line-b', name: 'Line B · Forming' },
  { id: 'line-c', name: 'Line C · Finishing' },
]

const MACHINES = [
  { id: 'laser-cutter-01', name: 'Laser cutter 01', line: 'line-a', builder: 'peer-photonic', kind: 'LaserCutter' },
  { id: 'laser-cutter-02', name: 'Laser cutter 02', line: 'line-a', builder: 'peer-photonic', kind: 'LaserCutter' },
  { id: 'press-brake-01', name: 'Press brake 01', line: 'line-b', builder: 'peer-formwerk', kind: 'PressBrake' },
  { id: 'press-brake-02', name: 'Press brake 02', line: 'line-b', builder: 'peer-formwerk', kind: 'PressBrake' },
  { id: 'deburring-01', name: 'Deburring unit 01', line: 'line-c', builder: 'peer-surfacetec', kind: 'Deburring' },
  { id: 'coating-01', name: 'Powder coating booth 01', line: 'line-c', builder: 'peer-surfacetec', kind: 'Coating' },
  { id: 'chiller-01', name: 'Process chiller 01', line: 'line-a', builder: 'peer-coolflow', kind: 'Chiller' },
  { id: 'extractor-01', name: 'Fume extractor 01', line: 'line-a', builder: 'peer-coolflow', kind: 'Extractor' },
]

const COMPONENTS = {
  LaserCutter: [['laser-source', 'Laser source'], ['cutting-head', 'Cutting head'], ['axis-drive', 'Axis drive']],
  PressBrake: [['hydraulic-unit', 'Hydraulic unit'], ['back-gauge', 'Back gauge']],
  Deburring: [['brush-unit', 'Brush unit'], ['conveyor', 'Conveyor']],
  Coating: [['spray-gun', 'Spray gun'], ['curing-oven', 'Curing oven']],
  Chiller: [['compressor', 'Compressor'], ['coolant-pump', 'Coolant pump']],
  Extractor: [['filter-cartridge', 'Filter cartridge'], ['fan', 'Fan']],
}

const SENSORS = {
  LaserCutter: [['temperature', '°C', 24, 32], ['power', 'kW', 3.5, 6]],
  PressBrake: [['pressure', 'bar', 180, 260], ['oil-temperature', '°C', 35, 55]],
  Deburring: [['vibration', 'mm/s', 1, 4]],
  Coating: [['temperature', '°C', 160, 200]],
  Chiller: [['coolant-temperature', '°C', 14, 22], ['flow', 'l/min', 30, 60]],
  Extractor: [['differential-pressure', 'Pa', 300, 900]],
}

export const PEERS = [
  { id: 'peer-photonic', name: 'Photonic Cutting Systems', capabilities: ['twin:direct', 'twin:adjacents', 'twin:history'] },
  { id: 'peer-formwerk', name: 'Formwerk Press Technology', capabilities: ['twin:direct', 'twin:adjacents'] },
  { id: 'peer-surfacetec', name: 'SurfaceTec Finishing', capabilities: ['twin:direct'] },
  { id: 'peer-coolflow', name: 'CoolFlow Process Cooling', capabilities: ['twin:direct', 'twin:history'] },
]

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

const RUN_TEMPLATES = [
  { machine: 'laser-cutter-01', issue: 'Cut quality degraded: burr formation on 3 mm steel since shift start', status: 'running', ageMin: 4 },
  { machine: 'press-brake-02', issue: 'Hydraulic pressure drops intermittently during bending cycle', status: 'awaiting_input', ageMin: 38 },
  { machine: 'chiller-01', issue: 'Coolant temperature above set point, laser source derating', status: 'awaiting_machine_builder', ageMin: 190 },
  { machine: 'coating-01', issue: 'Uneven coating thickness on left side of parts', status: 'awaiting_confirmation', ageMin: 75 },
]

function buildRuns(now) {
  return RUN_TEMPLATES.map((t, i) => {
    const startedAt = new Date(now - t.ageMin * MINUTE).toISOString()
    const updatedAt = new Date(now - Math.max(1, Math.floor(t.ageMin / 3)) * MINUTE).toISOString()
    return {
      runId: `run-${String(1001 + i)}`,
      incidentId: t.status === 'running' ? null : 41 + i,
      machineId: urn('Machine', t.machine),
      issue: t.issue,
      status: t.status,
      startedAt,
      updatedAt,
    }
  })
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
  return {
    version: 1,
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
    runs: buildRuns(now),
    alerts: buildAlerts(rng, now),
    peers: PEERS,
    connection: { state: 'connected', participantId: 'participant-plant-north', expiresAt: new Date(now + 8 * 60 * MINUTE).toISOString() },
    health: HEALTH_CHECKS.map(([id, label, latencyMs]) => ({ id, label, latencyMs })),
  }
}
