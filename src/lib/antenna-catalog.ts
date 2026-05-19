// Catalog of common Meshtastic-relevant antennas. Used by the Antenna DB
// reference panel and by the per-node antenna-override picker (so you
// can attach a known antenna model + dBi spec to a node instead of
// retyping numbers).
//
// `id` is a stable kebab-case slug that lives in the DB; never rename
// without a migration. dBi is the manufacturer-stated peak gain at the
// design frequency — real-world gain off-axis or off-band is lower.

export type AntennaCategory =
  | 'stock-rubber-duck'   // anything that ships in the box of a Meshtastic radio
  | 'extended-stub'       // longer rubber whip, modest gain
  | 'fiberglass-omni'     // outdoor-mount fiberglass omnidirectional
  | 'yagi'                // directional, gain into a beam
  | 'j-pole'              // homebrew / commercial J-pole / Slim Jim
  | 'roll-up'             // packable roll-up J-pole / dipole
  | 'patch'               // panel / patch directional
  | 'mobile'              // car / mag-mount mobile whip
  | 'sleeve-dipole';      // collinear / dual-band sleeve dipole

export type FreqBand = '433' | '868' | '915' | '2400' | 'multi';

export interface AntennaSpec {
  id: string;
  name: string;
  vendor: string;
  category: AntennaCategory;
  /** Manufacturer-stated peak gain in dBi at the design frequency. */
  gainDbi: number;
  freqBand: FreqBand;
  /** Short form-factor description (length, weight). */
  size: string;
  /** Connector type — useful so you can confirm compatibility. */
  connector: 'SMA' | 'RP-SMA' | 'N-female' | 'SO-239' | 'BNC' | 'IPEX' | 'pigtail-SMA' | 'fixed';
  approxPriceUsd: string;
  /** Free-form notes about real-world use. */
  notes: string;
}

export const ANTENNA_CATALOG: AntennaSpec[] = [
  // ── Stock rubber ducks (what ships in the box) ────────────────────
  { id: 'stock-meshtastic-2dbi', name: 'Stock Meshtastic stub', vendor: 'OEM', category: 'stock-rubber-duck',
    gainDbi: 2, freqBand: '915', size: '~10 cm · ~10 g', connector: 'SMA', approxPriceUsd: 'included',
    notes: 'Bog-standard rubber duck that ships with most Meshtastic boards (Heltec V3, Station G2). Adequate for testing — usually the first thing you replace.' },
  { id: 'stock-tbeam-2dbi', name: 'T-Beam stock whip', vendor: 'Lilygo', category: 'stock-rubber-duck',
    gainDbi: 2, freqBand: '915', size: '~17 cm · ~15 g', connector: 'SMA', approxPriceUsd: 'included',
    notes: 'Slightly longer than the bare Meshtastic stub. Marginal real-world gain difference.' },

  // ── Extended stubs / handhelds ────────────────────────────────────
  { id: 'nagoya-na771', name: 'Nagoya NA-771 (915 MHz cut)', vendor: 'Nagoya', category: 'extended-stub',
    gainDbi: 3, freqBand: '915', size: '~39 cm · ~30 g', connector: 'SMA', approxPriceUsd: '$10-15',
    notes: 'Original NA-771 is dual-band VHF/UHF (144/430). Look for the 915 MHz / 868 MHz cut variant — easy to confuse with the dual-band original at the same price.' },
  { id: 'signal-stuff-superelastic', name: 'Signal Stuff SuperElastic', vendor: 'Signal Stuff', category: 'extended-stub',
    gainDbi: 4, freqBand: 'multi', size: '~40 cm', connector: 'SMA', approxPriceUsd: '$30',
    notes: 'High-Q whip with usable performance across 144/220/440/915 MHz. Aimed at HT operators but works great on Meshtastic.' },

  // ── Fiberglass outdoor omnis ──────────────────────────────────────
  { id: 'diamond-x30a', name: 'Diamond X30A', vendor: 'Diamond', category: 'fiberglass-omni',
    gainDbi: 6.5, freqBand: 'multi', size: '~1.3 m · ~700 g', connector: 'SO-239', approxPriceUsd: '$80-110',
    notes: '2 m / 70 cm fiberglass omni; usable on 915 with a tuner or as-is with minor SWR penalty. Heavy, needs a proper mast. Workhorse for fixed installs.' },
  { id: 'diamond-x50a', name: 'Diamond X50A', vendor: 'Diamond', category: 'fiberglass-omni',
    gainDbi: 7.2, freqBand: 'multi', size: '~1.7 m · ~900 g', connector: 'SO-239', approxPriceUsd: '$110-140',
    notes: 'Big brother to the X30A — extra ~0.7 dB for an extra ~30 cm of length. Same caveats about 915 MHz tuning.' },
  { id: 'diamond-x300a', name: 'Diamond X300A', vendor: 'Diamond', category: 'fiberglass-omni',
    gainDbi: 9, freqBand: 'multi', size: '~3.1 m · ~1.4 kg', connector: 'SO-239', approxPriceUsd: '$200-250',
    notes: 'High-gain dual-band stick. The gain is collinear-stacked, so the radiation pattern is more "pancaked" — great for flat country, poor for hilly terrain where you need elevation angle.' },
  { id: 'comet-cx333', name: 'Comet CX-333', vendor: 'Comet', category: 'fiberglass-omni',
    gainDbi: 7.2, freqBand: 'multi', size: '~3.0 m', connector: 'SO-239', approxPriceUsd: '$200',
    notes: 'Triband — 6 m / 2 m / 70 cm. Like the Diamonds, you accept some 915 MHz SWR penalty for ease of mounting one stick.' },
  { id: 'generic-915-5dbi-fiberglass', name: 'Generic 915 MHz 5 dBi fiberglass', vendor: 'various', category: 'fiberglass-omni',
    gainDbi: 5, freqBand: '915', size: '~50 cm · ~200 g', connector: 'SMA', approxPriceUsd: '$25-40',
    notes: 'The "$30 upgrade" that 80% of Meshtastic users buy. Centred on 915, much smaller than the Diamond X-series, dramatically better than stock.' },

  // ── Mobile / vehicle ──────────────────────────────────────────────
  { id: 'mfj-1729', name: 'MFJ-1729 mag-mount whip', vendor: 'MFJ', category: 'mobile',
    gainDbi: 4, freqBand: '915', size: '~30 cm', connector: 'SMA', approxPriceUsd: '$40',
    notes: 'Mag-mount with ~3 m of coax. Useful for vehicle deployments — pop it on the roof, run the cable inside, get a real ground plane (the car body).' },

  // ── Yagis (directional) ───────────────────────────────────────────
  { id: 'arrow-915-7el', name: 'Arrow 915 MHz 7-element Yagi', vendor: 'Arrow Antennas', category: 'yagi',
    gainDbi: 11, freqBand: '915', size: '~1.2 m boom', connector: 'BNC', approxPriceUsd: '$120',
    notes: 'Hand-aimed yagi with ~60° forward beam. Use for fixed point-to-point links where you know both endpoints. Polarization matters — match both ends.' },
  { id: 'ebay-915-yagi-15dbi', name: 'eBay 915 MHz 15-element Yagi', vendor: 'various', category: 'yagi',
    gainDbi: 13, freqBand: '915', size: '~80 cm boom', connector: 'N-female', approxPriceUsd: '$30-50',
    notes: 'Cheap import yagi with stated 15 dBi (usually closer to 12-13 dBi real). Excellent for distance links if you can mount it firmly aimed at a known peer.' },

  // ── J-poles / roll-ups ────────────────────────────────────────────
  { id: 'n9tax-slimjim', name: 'N9TAX 915 MHz Slim Jim (roll-up)', vendor: 'N9TAX', category: 'roll-up',
    gainDbi: 6.6, freqBand: '915', size: '~75 cm rolled', connector: 'pigtail-SMA', approxPriceUsd: '$30',
    notes: 'Packable ladder-line J-pole. Cheap, light, surprisingly good gain. Hang it from a tree branch for a temporary high-altitude omni. THE backpacker antenna.' },
  { id: 'homebrew-j-pole-cu', name: 'Homebrew copper J-pole', vendor: 'DIY', category: 'j-pole',
    gainDbi: 6, freqBand: '915', size: '~75 cm', connector: 'SO-239', approxPriceUsd: '~$15 in parts',
    notes: 'Easy weekend build from 1/2" copper pipe. Permanent omni once tuned. Tons of YouTube guides.' },

  // ── Patches / panels ──────────────────────────────────────────────
  { id: 'flat-panel-915-9dbi', name: 'Flat panel 915 MHz directional', vendor: 'various', category: 'patch',
    gainDbi: 9, freqBand: '915', size: '~20×20 cm', connector: 'N-female', approxPriceUsd: '$40-80',
    notes: 'Square panel with a ~70° beam — gentler than a yagi but still directional. Good for sector coverage from a fixed install.' },

  // ── Other ─────────────────────────────────────────────────────────
  { id: 'chip-antenna-onboard', name: 'On-board chip antenna', vendor: 'OEM', category: 'stock-rubber-duck',
    gainDbi: 0, freqBand: '915', size: 'on PCB', connector: 'fixed', approxPriceUsd: 'included',
    notes: 'What ships on T-Echo, T1000-E, XIAO nRF52, and other compact boards. Not really upgradeable without a hardware mod. Treat as 0 dBi worst-case.' },
];

export function getAntennaById(id: string): AntennaSpec | undefined {
  return ANTENNA_CATALOG.find((a) => a.id === id);
}

export const ANTENNA_CATEGORY_LABEL: Record<AntennaCategory, string> = {
  'stock-rubber-duck': 'Stock / rubber duck',
  'extended-stub':     'Extended stub',
  'fiberglass-omni':   'Fiberglass omni',
  'yagi':              'Yagi (directional)',
  'j-pole':            'J-pole',
  'roll-up':           'Roll-up',
  'patch':             'Panel / patch',
  'mobile':            'Mobile / vehicle',
  'sleeve-dipole':     'Sleeve dipole / collinear',
};
