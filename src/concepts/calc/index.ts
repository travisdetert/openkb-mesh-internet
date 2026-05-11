// Mesh internet expectation calculator. Pure functions, deterministic, easily reviewable.
// All inputs are plain values — callers pull them out of Concept Instances.

export interface PathLossInputs {
  distanceM: number;
  refDistanceM: number;
  refPathLossDb: number;
  pathLossExponent: number;
}

// Log-distance path loss model.
// PL(d) = PL_ref + 10 · n · log10(d / d_ref)
export function pathLossDb({ distanceM, refDistanceM, refPathLossDb, pathLossExponent }: PathLossInputs): number {
  if (distanceM <= 0) return 0;
  return refPathLossDb + 10 * pathLossExponent * Math.log10(distanceM / refDistanceM);
}

export interface LinkBudgetInputs {
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  rxSensitivityDbm: number;
  cableLossDb?: number; // each end
  linkMarginDb?: number; // safety margin above sensitivity
}

// Maximum allowed path loss before the link breaks.
export function maxPathLossDb(b: LinkBudgetInputs): number {
  const cableLoss = (b.cableLossDb ?? 0) * 2;
  const margin = b.linkMarginDb ?? 6;
  return b.txPowerDbm + b.txGainDbi + b.rxGainDbi - cableLoss - margin - b.rxSensitivityDbm;
}

// Solve d in PL = PL_ref + 10·n·log10(d/d_ref) for a given allowed PL.
function distanceForPathLossM(allowedPlDb: number, refDistanceM: number, refPathLossDb: number, pathLossExponent: number): number {
  if (allowedPlDb <= refPathLossDb) return refDistanceM;
  const exponent = (allowedPlDb - refPathLossDb) / (10 * pathLossExponent);
  return refDistanceM * Math.pow(10, exponent);
}

export interface RangeInputs extends LinkBudgetInputs {
  refDistanceM: number;
  refPathLossDb: number;
  pathLossExponent: number;
  shadowFadingSigmaDb: number;
}

// Returns p10 / p50 / p90 range estimates in meters.
// Shadow fading is log-normal with sigma σ. The link breaks when PL + X_σ > maxPathLoss.
// Worst 10% of links: X_σ = +1.28σ (more loss → less range).
// Best  10% of links: X_σ = -1.28σ (less loss → more range).
export function rangeMeters(b: RangeInputs): { p10: number; p50: number; p90: number } {
  const maxPl = maxPathLossDb(b);
  const z = 1.2816; // 80% confidence interval bounds
  const sigma = b.shadowFadingSigmaDb;
  const ranges = (extra: number) =>
    distanceForPathLossM(maxPl - extra, b.refDistanceM, b.refPathLossDb, b.pathLossExponent);
  return {
    p10: Math.max(0, ranges(+z * sigma)),
    p50: Math.max(0, ranges(0)),
    p90: Math.max(0, ranges(-z * sigma)),
  };
}

// LoRa airtime — Semtech AN1200.13 formulation.
// Returns ms.
export function loraAirtimeMs(payloadBytes: number, sf: number, bwHz: number, codingRate: number, opts?: {
  preambleSymbols?: number;
  hasCrc?: boolean;
  implicitHeader?: boolean;
  lowDataRateOptimize?: boolean;
}): number {
  const preamble = opts?.preambleSymbols ?? 8;
  const crc = opts?.hasCrc === false ? 0 : 1;
  const ih = opts?.implicitHeader ? 1 : 0;
  const de = opts?.lowDataRateOptimize ?? sf >= 11 ? 1 : 0;

  const tSym = Math.pow(2, sf) / bwHz; // sec
  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crc - 20 * ih;
  const denominator = 4 * (sf - 2 * de);
  const payloadSymbols = 8 + Math.max(Math.ceil(numerator / denominator) * codingRate, 0);
  const totalSymbols = preamble + 4.25 + payloadSymbols;
  return totalSymbols * tSym * 1000;
}

export interface HopChainInputs {
  hopCount: number;
  perHopRangeM: number; // typical, p50
  airtimePerHopMs: number;
  hopLatencyMs: number;
  channelBusyMs: number;
  hopLossProbability: number;
  routeDiscoveryHops: number; // adds discovery latency on first packet
  retransmits: number;
}

export interface HopChainResult {
  totalReachM: number;
  oneWayLatencyP50Ms: number;
  oneWayLatencyP95Ms: number;
  roundTripLatencyP50Ms: number;
  roundTripLatencyP95Ms: number;
  successProbability: number;
  airtimeConsumedMsPerPacket: number; // counting all hop retransmits
}

// Per-hop airtime is paid by the originator + every relay = (hopCount + 1) transmissions
// in flooding/broadcast schemes. Reactive/source-routed schemes are closer to (hopCount).
// We approximate with hopCount + 1 — the worst realistic case for LoRa-like meshes.
export function hopChain(i: HopChainInputs): HopChainResult {
  const hops = Math.max(0, Math.floor(i.hopCount));
  // Real meshes don't have nodes evenly spaced at maximum range; assume ~60% spacing.
  const totalReachM = hops === 0 ? i.perHopRangeM : hops * i.perHopRangeM * 0.6;

  const perHopMs = i.airtimePerHopMs + i.hopLatencyMs + i.channelBusyMs;
  const baseLatency = hops * perHopMs;
  const discoveryLatency = i.routeDiscoveryHops * perHopMs;
  const oneWayLatencyP50Ms = baseLatency + discoveryLatency;
  // p95 accounts for retransmits and channel contention spikes.
  const oneWayLatencyP95Ms = oneWayLatencyP50Ms * 1.8 + i.retransmits * perHopMs * 2;

  const roundTripLatencyP50Ms = 2 * oneWayLatencyP50Ms;
  const roundTripLatencyP95Ms = 2 * oneWayLatencyP95Ms;

  const successProbability = hops === 0
    ? 1 - i.hopLossProbability
    : Math.pow(1 - i.hopLossProbability, hops);

  const airtimeConsumedMsPerPacket = i.airtimePerHopMs * (hops + 1);

  return {
    totalReachM,
    oneWayLatencyP50Ms,
    oneWayLatencyP95Ms,
    roundTripLatencyP50Ms,
    roundTripLatencyP95Ms,
    successProbability,
    airtimeConsumedMsPerPacket,
  };
}

// Per-hop probability for the visualization — given total chain probability.
export function perHopProbabilities(hopLossProbability: number, hopCount: number): number[] {
  const p = 1 - hopLossProbability;
  return Array.from({ length: hopCount }, () => p);
}

// EU868 default cap: 1% of an hour = 36 sec/hr.
// US (15.247): no airtime cap, but 400 ms dwell time per hop on FHSS — we don't model that here.
export function dutyCycleFraction(airtimeMsPerPacket: number, frequencyHz: number, capPercent = 1): number {
  const sentPerHour = frequencyHz * 3600;
  const airtimePerHourMs = airtimeMsPerPacket * sentPerHour;
  const capMsPerHour = (capPercent / 100) * 3600 * 1000;
  return airtimePerHourMs / capMsPerHour;
}

// Plain English summary based on the numbers. Chooses the most important warning.
export function summarize(r: HopChainResult, dutyFrac: number): string {
  const km = (r.totalReachM / 1000).toFixed(r.totalReachM > 10_000 ? 0 : 1);
  const lo = (r.roundTripLatencyP50Ms / 1000).toFixed(1);
  const hi = (r.roundTripLatencyP95Ms / 1000).toFixed(1);
  const pct = Math.round(r.successProbability * 100);

  const parts: string[] = [];
  parts.push(`Round-trip ${lo}–${hi}s, ~${pct}% delivery, reach up to ~${km} km.`);
  if (dutyFrac > 1) parts.push(`At this rate you'd exceed 1% airtime — illegal in EU.`);
  else if (dutyFrac > 0.5) parts.push(`Using ${Math.round(dutyFrac * 100)}% of the legal airtime budget.`);
  if (r.successProbability < 0.5) parts.push(`Less than half of packets get through — too many hops or marginal links.`);
  else if (r.successProbability < 0.8) parts.push(`Expect to retry — about 1 in ${Math.round(1 / (1 - r.successProbability))} packets is lost.`);
  return parts.join(' ');
}
