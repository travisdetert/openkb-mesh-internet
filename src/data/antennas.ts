// Backwards-compatible shim — antennas now live as Concept Instances under
// src/concepts/instances/antenna/. Existing panels keep importing the legacy
// shape from this file while we migrate them to read from the registry.

import { listInstances } from '../concepts/registry';
import type { Instance } from '../concepts/schema';

export type AntennaConnector =
  | 'rp-sma-male'
  | 'sma-male'
  | 'n-male'
  | 'u.fl'
  | 'integrated'
  | 'bare-wire';

export type Polarization =
  | 'vertical'
  | 'horizontal'
  | 'circular'
  | 'linear-mountable';

export interface Antenna {
  id: string;
  name: string;
  type: 'omni' | 'directional' | 'fractal';
  gainDbi: number;
  beamwidthDeg?: number;
  vswr: string;
  formFactor: string;
  priceUsd: [number, number];
  connector: AntennaConnector;
  polarization: Polarization;
  bands: string[];
  bestFor: string;
  watchOut: string;
}

function fromInstance(i: Instance): Antenna {
  return {
    id: i.ID,
    name: String(i.name),
    type: i.type as Antenna['type'],
    gainDbi: Number(i.gain_dbi),
    beamwidthDeg: i.beamwidth_deg !== undefined ? Number(i.beamwidth_deg) : undefined,
    vswr: String(i.vswr ?? ''),
    formFactor: String(i.form_factor ?? ''),
    priceUsd: [Number(i.price_usd_low ?? 0), Number(i.price_usd_high ?? 0)],
    connector: i.connector as AntennaConnector,
    polarization: i.polarization as Polarization,
    bands: Array.isArray(i.bands) ? (i.bands as string[]) : [],
    bestFor: String(i.best_for ?? ''),
    watchOut: String(i.watch_out ?? ''),
  };
}

const ORDER = [
  'stock', 'quarter-wave-wire', 'glassfiber-base', 'collinear', 'jpole',
  'nmo-whip', 'yagi-3el', 'yagi-7el', 'moxon', 'log-periodic', 'sub-ghz-panel', 'fractal-pcb',
];

export const ANTENNAS: Antenna[] = listInstances('antenna')
  .map(fromInstance)
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

export const CONNECTOR_LABELS: Record<AntennaConnector, string> = {
  'rp-sma-male': 'RP-SMA male',
  'sma-male': 'SMA male',
  'n-male': 'N male',
  'u.fl': 'U.FL',
  'integrated': 'integrated (no connector)',
  'bare-wire': 'bare wire / DIY',
};

export const POLARIZATION_LABELS: Record<Polarization, string> = {
  'vertical': 'vertical',
  'horizontal': 'horizontal',
  'circular': 'circular',
  'linear-mountable': 'linear (mount either way)',
};
