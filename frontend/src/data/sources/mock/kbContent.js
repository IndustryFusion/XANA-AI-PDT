/**
 * Seeded knowledge base of the mock source: sample manuals, procedures and
 * specification sheets for the factory's machines in both ingestion
 * pipelines, with the passages retrieval ranks.
 */

export const PIPELINES = ['base', 'structured']

const DAY = 24 * 60 * 60_000
const MB = 1024 * 1024

/** [name, pipeline, age in days, size in MB, description, passages: [location, text]] */
const DOCUMENTS = [
  ['LC-3015 operating manual.pdf', 'base', 60, 18.4, 'Operating and maintenance manual of laser cutters 01 and 02.', [
    ['page 112', 'Burr formation on mild steel up to 3 mm is usually caused by a contaminated protective window or a worn nozzle. Inspect the protective window for spatter before changing cutting parameters.'],
    ['page 114', 'Replace the protective window when spatter covers more than 10 % of its surface. Clean the window holder and check the seal before inserting the new window.'],
    ['page 131', 'Run the beam centring routine after every nozzle change. A decentred beam causes uneven kerf width and burr on one side of the part.'],
    ['page 208', 'Piercing time on stainless steel increases when the assist gas pressure is too low or the focal position has drifted.'],
  ]],
  ['PB-2200 hydraulic maintenance.pdf', 'base', 75, 9.2, 'Hydraulic system maintenance for press brakes 01 and 02.', [
    ['page 23', 'An intermittent hydraulic pressure drop during the bending cycle points to internal leakage in the proportional valve. Check the valve amplifier settings before replacing the cartridge.'],
    ['page 27', 'Oil temperature above 55 °C reduces viscosity and pressure stability. Check the oil cooler and the oil level after two hours of operation.'],
    ['page 40', 'Bleed the hydraulic circuit after replacing a valve cartridge and run the pressure test program P-17.'],
  ]],
  ['CF-40 chiller service guide.docx', 'base', 40, 3.1, 'Service guide of process chiller 01.', [
    ['page 9', 'Coolant temperature above the set point with normal flow usually indicates condenser fouling. Clean the condenser with compressed air and check the fan direction.'],
    ['page 12', 'A coolant flow alarm after a weekend start-up is often caused by air in the circuit. Vent the pump and check the filter strainer.'],
  ]],
  ['Shift handover checklist.md', 'base', 12, 0.02, 'Checks at every shift handover on lines A to C.', [
    ['section Line A', 'Check the protective window of both laser cutters, the coolant level of the chiller and the filter differential pressure of the fume extractor.'],
    ['section Line C', 'Check the spray gun electrodes and the curing oven temperature profile before the first coated part.'],
  ]],
  ['Scanned wiring diagrams.pdf', 'base', 5, 42.7, 'Electrical diagrams of the coating booth (scan).', [], 'No text layer found: the file contains only scanned images.'],
  ['LC-3015 operating manual.pdf', 'structured', 58, 18.4, 'Operating and maintenance manual of laser cutters 01 and 02, section-aware.', [
    ['section 7.3 Protective window', 'Spatter on the protective window reduces beam quality and causes burr formation. Replace the window when spatter covers more than 10 % of the surface; table 7-2 lists the window types per lens.'],
    ['section 7.5 Nozzle wear', 'Table 7-4: nozzle type HK20 for mild steel 1–4 mm, HK25 for 5–8 mm. A worn nozzle causes burr and unstable piercing.'],
  ]],
  ['PB-2200 spare parts catalogue.pdf', 'structured', 70, 6.5, 'Spare parts with order numbers for press brakes 01 and 02.', [
    ['section 4.2 Proportional valve', 'Proportional valve cartridge, order number 4-2210-07; amplifier card firmware 3.2 or later is required for pressure recovery.'],
    ['section 5.1 Back gauge', 'Back gauge axis drive and ball screw; diagram 5-1 shows the axis layout X, R and Z.'],
  ]],
  ['Fume extractor FX-9 specification.pdf', 'structured', 30, 2.4, 'Specification sheet of fume extractor 01.', [
    ['section 3 Filter cartridges', 'Filter class H13 cartridges; replace all cartridges when the differential pressure stays above 800 Pa after a cleaning cycle. Galvanised material shortens the service life.'],
  ]],
]

export const KB_SIZE_LIMIT = 50 * MB

/** Seeded documents and passages, relative to `now`. */
export function buildKnowledgeBase(now) {
  const documents = []
  const passages = []
  for (const [name, pipeline, ageDays, sizeMb, description, docPassages, error] of DOCUMENTS) {
    const failed = Boolean(error)
    documents.push({
      name,
      pipeline,
      status: failed ? 'failed' : 'done',
      uploadedAt: new Date(now - ageDays * DAY).toISOString(),
      size: Math.round(sizeMb * MB),
      chunks: failed ? 0 : chunkCount(sizeMb * MB, docPassages.length),
      description,
      error: error ?? null,
      jobId: null,
    })
    for (const [location, text] of docPassages) passages.push({ document: name, pipeline, location, text })
  }
  return { documents, passages, jobs: {} }
}

/** Number of chunks a document of this size yields (at least one per passage). */
export function chunkCount(size, passageCount = 0) {
  return Math.max(passageCount, Math.round(size / 40_000), 1)
}
