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

/**
 * Diagnosis content of simulated runs, per machine kind: observed signals,
 * hypotheses, root causes and what the simulated machine builder says.
 * Scenarios decide the flow; this file decides what the steps contain.
 */
import { machineFor } from '../catalog'

const KINDS = {
  LaserCutter: {
    signals: [
      ['Cutting head temperature', 31.8, '°C', 'above normal'],
      ['Laser power', 4.1, 'kW', 'normal'],
      ['Assist gas pressure', 13.2, 'bar', 'normal'],
    ],
    manuals: ['Cutting head maintenance guide, chapter 4', 'Cut quality troubleshooting table'],
    hypotheses: [
      { title: 'Protective window contaminated by spatter', evidence: ['Head temperature 3 °C above baseline', 'Burr appears on all contours'], note: 'Temperature trend matches window soiling seen in two earlier incidents.' },
      { title: 'Focus position drifted', evidence: ['Kerf width increased by 0.05 mm'], note: 'Focus calibration is 41 days old; drift is plausible but not proven.' },
      { title: 'Assist gas pressure too low', evidence: ['Pressure close to the lower limit'], note: 'Pressure stayed within limits during every cut today.' },
    ],
    actions: [
      'Replace the protective window, clean the nozzle and run a test cut on 3 mm steel',
      'Run the focus calibration routine and repeat the test cut',
      'Raise assist gas pressure to 14 bar and check the regulator',
    ],
    question: 'When was the protective window last replaced, and does the burr appear on every contour or only on one side?',
    dataRequest: [['Cutting head temperature, last 24 h', 'sensor'], ['Active alerts of the machine', 'alert']],
    beyondTier: [['Cutting parameter history, last 30 days', 'history'], ['Laser source service log', 'documents']],
    recommendation: {
      summary: 'Spatter on the protective window reduces beam quality. Our service data shows the same pattern after nozzle wear.',
      actions: ['Replace the protective window', 'Replace the nozzle (type HK20)', 'Run the beam centring routine', 'Cut a 3 mm test plate and check the burr'],
    },
  },
  PressBrake: {
    signals: [
      ['Hydraulic pressure', 192, 'bar', 'drops to 150 bar'],
      ['Oil temperature', 54.6, '°C', 'above normal'],
      ['Cycle time', 11.4, 's', 'normal'],
    ],
    manuals: ['Hydraulic unit service manual, section 7', 'Pressure loss fault tree'],
    hypotheses: [
      { title: 'Internal leakage in the proportional valve', evidence: ['Pressure drops only under load', 'Oil temperature rising during the shift'], note: 'Drop pattern matches valve leakage; pump output is stable.' },
      { title: 'Worn hydraulic pump', evidence: ['Pump running hours above 18 000'], note: 'Idle pressure is normal, which speaks against pump wear.' },
      { title: 'Air in the hydraulic circuit', evidence: ['Noise heard at cycle start'], note: 'No foaming visible in the tank camera image.' },
    ],
    actions: [
      'Replace the proportional valve cartridge and bleed the circuit',
      'Measure pump delivery and replace the pump if below 90 %',
      'Bleed the hydraulic circuit and check the suction line',
    ],
    question: 'Does the pressure drop on every bend or only on long parts above 2 m?',
    dataRequest: [['Hydraulic pressure and oil temperature, last 24 h', 'sensor'], ['Machine attributes', 'machine']],
    beyondTier: [['Back gauge axis data, last 7 days', 'adjacent'], ['Hydraulic oil analysis report', 'documents']],
    recommendation: {
      summary: 'The pressure profile points to the proportional valve. A firmware setting also limits pressure recovery.',
      actions: ['Update the valve amplifier firmware to 3.2', 'Replace the proportional valve cartridge', 'Bleed the circuit', 'Run the pressure test program P-17'],
    },
  },
  Chiller: {
    signals: [
      ['Coolant temperature', 23.9, '°C', 'above set point 20 °C'],
      ['Coolant flow', 31, 'l/min', 'at lower limit'],
      ['Ambient temperature', 29, '°C', 'high'],
    ],
    manuals: ['Process chiller operating manual, chapter 6', 'Cooling circuit troubleshooting'],
    hypotheses: [
      { title: 'Clogged condenser fins', evidence: ['High ambient temperature', 'Condensing pressure rising'], note: 'Condensing pressure is 2 bar above design, typical for fouled fins.' },
      { title: 'Coolant pump wear', evidence: ['Flow at the lower limit'], note: 'Flow dropped by 15 % over 3 months.' },
      { title: 'Refrigerant undercharge', evidence: ['Compressor runs continuously'], note: 'Suction pressure is normal.' },
    ],
    actions: [
      'Clean the condenser fins and check the fan',
      'Replace the coolant pump seal kit and measure flow',
      'Check refrigerant charge with the service technician',
    ],
    question: 'Was the condenser cleaned during the last maintenance, and is the hall ventilation running?',
    dataRequest: [['Coolant temperature and flow, last 24 h', 'sensor'], ['Machine attributes', 'machine']],
    beyondTier: [['Compressor runtime history, last 90 days', 'history'], ['Laser source load profile', 'adjacent']],
    recommendation: {
      summary: 'Condenser fouling combined with high hall temperature. The pump is within tolerance.',
      actions: ['Clean the condenser with compressed air', 'Check the condenser fan direction', 'Lower the set point hysteresis to 1 K', 'Monitor coolant temperature for one shift'],
    },
  },
  Coating: {
    signals: [
      ['Booth temperature', 182, '°C', 'normal'],
      ['Gun voltage left', 62, 'kV', 'below 80 kV set point'],
      ['Gun voltage right', 79, 'kV', 'normal'],
    ],
    manuals: ['Spray gun maintenance guide', 'Coating thickness defects table'],
    hypotheses: [
      { title: 'Worn electrode in the left spray gun', evidence: ['Left gun voltage 18 kV below set point', 'Thin layer only on the left side'], note: 'Voltage loss is limited to the left gun.' },
      { title: 'Powder hose partly blocked', evidence: ['Powder output fluctuates'], note: 'Fluctuation is within the normal range.' },
      { title: 'Part grounding poor', evidence: ['Hooks not cleaned this week'], note: 'Grounding resistance measured at 0.4 MΩ, acceptable.' },
    ],
    actions: [
      'Replace the electrode of the left spray gun and recalibrate voltage',
      'Purge and replace the left powder hose',
      'Clean the hanging hooks and measure grounding',
    ],
    question: 'Is the thin layer on every part or only on parts hung on the left rail?',
    dataRequest: [['Spray gun voltages, last 24 h', 'sensor'], ['Active alerts of the machine', 'alert']],
    beyondTier: [['Powder consumption history, last 30 days', 'history'], ['Curing oven temperature profile', 'adjacent']],
    recommendation: {
      summary: 'Electrode wear on the left gun is the likely cause; cascade module may also be affected.',
      actions: ['Replace the left electrode', 'Measure the cascade output', 'Recalibrate both guns', 'Coat two test parts and measure thickness'],
    },
  },
  Deburring: {
    signals: [
      ['Brush vibration', 4.6, 'mm/s', 'above limit 4 mm/s'],
      ['Conveyor speed', 2.1, 'm/min', 'normal'],
      ['Brush motor current', 11.8, 'A', 'above normal'],
    ],
    manuals: ['Deburring unit maintenance manual', 'Vibration diagnosis guide'],
    hypotheses: [
      { title: 'Unevenly worn brush roller', evidence: ['Vibration increasing over 2 weeks', 'Motor current fluctuates per revolution'], note: 'Vibration peaks at brush rotation frequency.' },
      { title: 'Bearing damage in the brush shaft', evidence: ['Unusual noise noted by the operator'], note: 'No bearing frequency visible in the spectrum.' },
      { title: 'Loose conveyor belt', evidence: ['Belt tension last checked 60 days ago'], note: 'Conveyor speed is stable.' },
    ],
    actions: [
      'Replace the brush roller and balance the shaft',
      'Replace the brush shaft bearings',
      'Re-tension the conveyor belt',
    ],
    question: 'Did the vibration start after a brush change or gradually?',
    dataRequest: [['Brush vibration, last 24 h', 'sensor'], ['Machine attributes', 'machine']],
    beyondTier: [['Vibration spectrum history, last 30 days', 'history'], ['Conveyor drive data', 'adjacent']],
    recommendation: {
      summary: 'Brush wear is uneven because the oscillation unit is stuck.',
      actions: ['Free and lubricate the oscillation unit', 'Replace the brush roller', 'Balance the shaft', 'Check vibration after one hour'],
    },
  },
  Extractor: {
    signals: [
      ['Filter differential pressure', 1180, 'Pa', 'above limit 900 Pa'],
      ['Fan speed', 2950, 'rpm', 'normal'],
      ['Extraction volume', 1650, 'm³/h', 'below 2000 m³/h'],
    ],
    manuals: ['Fume extractor operating manual', 'Filter replacement procedure'],
    hypotheses: [
      { title: 'Filter cartridges saturated', evidence: ['Differential pressure above limit', 'Last change 9 months ago'], note: 'Pressure rose steadily since the last change.' },
      { title: 'Cleaning pulse valve defective', evidence: ['No pressure drop after cleaning cycles'], note: 'Pulse valve current is normal.' },
      { title: 'Fan impeller fouled', evidence: ['Extraction volume reduced'], note: 'Fan current is within range.' },
    ],
    actions: [
      'Replace the filter cartridges and reset the filter counter',
      'Replace the cleaning pulse valve',
      'Clean the fan impeller',
    ],
    question: 'Has the material mix changed recently, for example more galvanised sheet?',
    dataRequest: [['Filter differential pressure, last 24 h', 'sensor'], ['Machine attributes', 'machine']],
    beyondTier: [['Cleaning cycle log, last 30 days', 'history'], ['Laser cutter job list', 'adjacent']],
    recommendation: {
      summary: 'Cartridges are saturated earlier than expected because of galvanised material.',
      actions: ['Replace all filter cartridges', 'Shorten the cleaning interval to 10 min', 'Check the pulse valve membrane', 'Record differential pressure for one week'],
    },
  },
}

const FALLBACK = KINDS.LaserCutter

/** Content for a run's machine, with the machine and builder names filled in. */
export function contentFor(machineId) {
  const machine = machineFor(machineId)
  const kind = KINDS[machine?.kind] ?? FALLBACK
  return { ...kind, machineName: machine?.name ?? machineId }
}
