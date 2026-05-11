// Regulatory regions for LoRa ISM bands. Real-world numbers — confirm against your local rules.
// EIRP = effective isotropic radiated power (TX power + antenna gain - losses).

export interface Region {
  id: string;
  label: string;
  freqStart: number;
  freqEnd: number;
  freqMHz: number;
  maxEirpDbm: number;
  dutyCycleNote: string;
  authority: string;
}

export const REGIONS: Region[] = [
  {
    id: 'US',
    label: 'United States (915 MHz ISM)',
    freqStart: 902e6, freqEnd: 928e6,
    freqMHz: 915,
    maxEirpDbm: 30,
    dutyCycleNote: 'No duty cycle limit (FCC Part 15.247). Frequency hopping or DSSS required for >1mW; LoRa qualifies.',
    authority: 'FCC',
  },
  {
    id: 'EU868',
    label: 'European Union (868 MHz)',
    freqStart: 863e6, freqEnd: 870e6,
    freqMHz: 868,
    maxEirpDbm: 14,
    dutyCycleNote: '1% duty cycle on most sub-bands. ETSI EN 300 220 — strict, enforced.',
    authority: 'ETSI / national',
  },
  {
    id: 'EU433',
    label: 'European Union (433 MHz)',
    freqStart: 433.05e6, freqEnd: 434.79e6,
    freqMHz: 433,
    maxEirpDbm: 10,
    dutyCycleNote: '10% duty cycle. Lower power, much longer wavelength = bigger antennas.',
    authority: 'ETSI',
  },
  {
    id: 'CN',
    label: 'China (470 MHz)',
    freqStart: 470e6, freqEnd: 510e6,
    freqMHz: 480,
    maxEirpDbm: 17,
    dutyCycleNote: 'Channel-by-channel rules.',
    authority: 'MIIT',
  },
  {
    id: 'JP',
    label: 'Japan (920 MHz)',
    freqStart: 920e6, freqEnd: 928e6,
    freqMHz: 923,
    maxEirpDbm: 13,
    dutyCycleNote: 'LBT (listen before talk) required.',
    authority: 'ARIB',
  },
  {
    id: 'AU',
    label: 'Australia / NZ (915 MHz)',
    freqStart: 915e6, freqEnd: 928e6,
    freqMHz: 915,
    maxEirpDbm: 30,
    dutyCycleNote: 'No duty cycle. Same band as US, narrower allocation.',
    authority: 'ACMA',
  },
];
