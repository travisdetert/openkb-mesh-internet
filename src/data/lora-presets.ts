// Backwards-compatible shim — LoRa presets now live as Concept Instances under
// src/concepts/instances/modulation/. This file maps them to the legacy shape
// so existing panels (LinkBudget, Coverage, etc.) continue to work while we
// migrate them to read from the registry directly.

import { listInstances } from '../concepts/registry';
import type { Instance } from '../concepts/schema';

export interface LoRaPreset {
  id: string;
  label: string;
  sf: number;
  bw: number;
  cr: number;
  sensitivity: number;
  bitrateBps: number;
  airtimeSec_50byte: number;
  notes: string;
  defaultRange: 'short' | 'medium' | 'long';
}

function fromInstance(i: Instance): LoRaPreset {
  return {
    id: i.ID,
    label: String(i.label ?? i.name ?? i.ID),
    sf: Number(i.sf),
    bw: Number(i.bw),
    cr: Number(i.cr),
    sensitivity: Number(i.sensitivity_dbm),
    bitrateBps: Number(i.bitrate_bps),
    airtimeSec_50byte: Number(i.airtime_sec_50byte),
    notes: String(i.notes ?? ''),
    defaultRange: (i.default_range as 'short' | 'medium' | 'long') ?? 'long',
  };
}

const ORDER = ['ShortTurbo', 'ShortFast', 'ShortSlow', 'MedFast', 'MedSlow', 'LongFast', 'LongMod', 'LongSlow'];

export const LORA_PRESETS: LoRaPreset[] = listInstances('modulation')
  .map(fromInstance)
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

export const DEFAULT_PRESET: LoRaPreset =
  LORA_PRESETS.find((p) => p.id === 'LongFast') ?? LORA_PRESETS[0];
