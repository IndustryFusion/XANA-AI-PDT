/**
 * Static catalog of the mock factory: production lines, machines with their
 * components and sensors, the machine builders (dataspace peers) and the
 * data-sharing tier the factory has configured for them.
 */

export const urn = (type, id) => `urn:ngsi-ld:${type}:${id}`

export const LINES = [
  { id: 'line-a', name: 'Line A · Sheet metal' },
  { id: 'line-b', name: 'Line B · Forming' },
  { id: 'line-c', name: 'Line C · Finishing' },
]

export const MACHINES = [
  { id: 'laser-cutter-01', name: 'Laser cutter 01', line: 'line-a', builder: 'peer-photonic', kind: 'LaserCutter' },
  { id: 'laser-cutter-02', name: 'Laser cutter 02', line: 'line-a', builder: 'peer-photonic', kind: 'LaserCutter' },
  { id: 'press-brake-01', name: 'Press brake 01', line: 'line-b', builder: 'peer-formwerk', kind: 'PressBrake' },
  { id: 'press-brake-02', name: 'Press brake 02', line: 'line-b', builder: 'peer-formwerk', kind: 'PressBrake' },
  { id: 'deburring-01', name: 'Deburring unit 01', line: 'line-c', builder: 'peer-surfacetec', kind: 'Deburring' },
  { id: 'coating-01', name: 'Powder coating booth 01', line: 'line-c', builder: 'peer-surfacetec', kind: 'Coating' },
  { id: 'chiller-01', name: 'Process chiller 01', line: 'line-a', builder: 'peer-coolflow', kind: 'Chiller' },
  { id: 'extractor-01', name: 'Fume extractor 01', line: 'line-a', builder: 'peer-coolflow', kind: 'Extractor' },
]

export const COMPONENTS = {
  LaserCutter: [['laser-source', 'Laser source'], ['cutting-head', 'Cutting head'], ['axis-drive', 'Axis drive']],
  PressBrake: [['hydraulic-unit', 'Hydraulic unit'], ['back-gauge', 'Back gauge']],
  Deburring: [['brush-unit', 'Brush unit'], ['conveyor', 'Conveyor']],
  Coating: [['spray-gun', 'Spray gun'], ['curing-oven', 'Curing oven']],
  Chiller: [['compressor', 'Compressor'], ['coolant-pump', 'Coolant pump']],
  Extractor: [['filter-cartridge', 'Filter cartridge'], ['fan', 'Fan']],
}

export const SENSORS = {
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

/** Machine catalog entry for an entity ID (or null). */
export function machineFor(machineId) {
  return MACHINES.find((m) => urn('Machine', m.id) === machineId) ?? null
}

/** The machine builder (peer) responsible for a machine (or null). */
export function builderFor(machineId) {
  const machine = machineFor(machineId)
  return machine ? PEERS.find((p) => p.id === machine.builder) ?? null : null
}

/** Participants the dataspace registry knows besides the compatible peers. */
export const REGISTRY = [
  ...PEERS.map(({ id, name }) => ({ id, name })),
  { id: 'peer-hydroservice', name: 'HydroService Maintenance' },
  { id: 'participant-plant-north', name: 'Plant North' },
]

/** Capabilities a dataspace participant can grant: machine entity, linked components, signal history. */
export const CAPABILITIES = ['twin:direct', 'twin:adjacents', 'twin:history']

/**
 * Data-sharing tier configured for machine builders (`minimal`: the machine
 * entity only). Requested data in one of the `included` categories is shared
 * automatically; anything else needs the operator's approval.
 */
export const SHARING_TIER = {
  id: 'minimal',
  label: 'minimal · machine entity only',
  included: ['incident', 'machine', 'sensor', 'alert'],
}
