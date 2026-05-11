// Meshtastic device database — USB identification and hardware recommendations.
//
// The detection model is intentionally three-ringed:
//   1. CONFIRMED   — exact (vid,pid) of boards we know ship pre-flashed Meshtastic.
//   2. LIKELY      — chip-family match (CP210x, CH340/CH9102, FTDI, ESP32-S3 native,
//                    nRF52 native, RP2040 native). These are the chips on every
//                    ESP32/nRF52/RP2040 board, so any of them *could* be running
//                    Meshtastic firmware.
//   3. POSSIBLE    — unknown serial port matching platform-specific path patterns.
//
// New hardware ships monthly (RAK adds modules, Heltec ships new variants). Rather
// than chasing a flat allowlist, we lean on chip-family detection and let the
// protobuf handshake be the ground truth: if `want_config_id` returns a valid
// FromRadio, it's Meshtastic regardless of how it was tagged.

export interface MeshtasticDeviceInfo {
  name: string;
  mcu: string;
  loraChip: string;
  hasGps: boolean;
  hasScreen: boolean;
  screenType?: string;
  battery: string;
  priceRange: string;
  notes: string;
  firmware: 'meshtastic' | 'meshcore' | 'both';
}

export type Confidence = 'confirmed' | 'likely' | 'possible' | 'unknown';

export type ChipFamily =
  | 'cp210x'         // Silicon Labs CP2102/CP2102N/CP2104 — Heltec, many ESP32 boards
  | 'ch340'          // WCH CH340/CH341 — older ESP32 / Arduino clones
  | 'ch9102'         // WCH CH9102 — newer T-Beam, DIY ESP32-S3 boards
  | 'ftdi'           // FTDI FT232R/FT232H/FT2232 — DIY builds, dev boards
  | 'esp32-native'   // ESP32-S2/S3/C3 native USB CDC — Heltec V3, Station G2, XIAO S3, etc.
  | 'nrf52-native'   // nRF52840 native USB CDC — T-Echo, RAK4631, XIAO nRF52840
  | 'rp2040-native'  // RP2040 native USB CDC — RAK11310, Pico-based builds
  | 'cdc-acm-generic'; // any CDC ACM device we can't classify further

export interface UsbSerialSignature {
  vid: number;
  pid?: number;     // exact match
  pidMin?: number;  // OR a range (preferred for chip families with many PIDs)
  pidMax?: number;
  chipFamily: ChipFamily;
  confidence: Confidence;
  description: string;
  notes?: string;
}

/**
 * Chip-family signatures. Order matters: we look up exact (vid,pid) first,
 * then fall back to vendor-prefix / range matches. A vid-only entry is fine —
 * it captures any PID under that vendor's USB allocation as the chip family.
 */
export const USB_SIGNATURES: UsbSerialSignature[] = [
  // ── Confirmed Meshtastic boards (exact PID known) ──────────────────────
  { vid: 0x10C4, pid: 0xEA60, chipFamily: 'cp210x',        confidence: 'confirmed', description: 'CP210x — Heltec V2 / generic ESP32 (Meshtastic-friendly)' },
  { vid: 0x303A, pid: 0x1001, chipFamily: 'esp32-native',  confidence: 'confirmed', description: 'ESP32-S3 native USB — Heltec V3, Station G2' },
  { vid: 0x1A86, pid: 0x55D4, chipFamily: 'ch9102',        confidence: 'confirmed', description: 'CH9102 — T-Beam (newer revisions)' },
  { vid: 0x1A86, pid: 0x7523, chipFamily: 'ch340',         confidence: 'confirmed', description: 'CH340 — older ESP32 boards' },
  { vid: 0x0403, pid: 0x6001, chipFamily: 'ftdi',          confidence: 'confirmed', description: 'FT232R — DIY builds' },
  { vid: 0x239A, pid: 0x8029, chipFamily: 'nrf52-native',  confidence: 'confirmed', description: 'Adafruit nRF52840 — RAK WisBlock (Adafruit bootloader)' },
  { vid: 0x1915, pid: 0x521F, chipFamily: 'nrf52-native',  confidence: 'confirmed', description: 'Nordic nRF52840 DK — T-Echo, RAK' },
  { vid: 0x2886, pid: 0x0059, chipFamily: 'nrf52-native',  confidence: 'confirmed', description: 'Seeed XIAO nRF52840 — T1000-E, Wio-SX1262' },
  { vid: 0x2886, pid: 0x0045, chipFamily: 'esp32-native',  confidence: 'confirmed', description: 'Seeed XIAO ESP32-S3' },
  { vid: 0x2E8A, pid: 0x000A, chipFamily: 'rp2040-native', confidence: 'confirmed', description: 'RP2040 — RAK11310, Pico-based Meshtastic' },

  // ── Likely candidates (chip family match by VID, any PID) ──────────────
  // Future Meshtastic boards using these chips will land here automatically.
  { vid: 0x10C4, chipFamily: 'cp210x',        confidence: 'likely', description: 'Silicon Labs CP210x USB-serial bridge' },
  { vid: 0x1A86, chipFamily: 'ch340',         confidence: 'likely', description: 'WCH CH340/CH9102 USB-serial bridge' },
  { vid: 0x0403, chipFamily: 'ftdi',          confidence: 'likely', description: 'FTDI USB-serial bridge' },
  { vid: 0x303A, chipFamily: 'esp32-native',  confidence: 'likely', description: 'Espressif ESP32-S2/S3/C3 native USB CDC' },
  { vid: 0x1915, chipFamily: 'nrf52-native',  confidence: 'likely', description: 'Nordic nRF52 native USB CDC' },
  { vid: 0x239A, chipFamily: 'nrf52-native',  confidence: 'likely', description: 'Adafruit nRF52 native USB CDC' },
  { vid: 0x2886, chipFamily: 'nrf52-native',  confidence: 'likely', description: 'Seeed XIAO (nRF52 or ESP32-S3 variant)' },
  { vid: 0x2E8A, chipFamily: 'rp2040-native', confidence: 'likely', description: 'Raspberry Pi RP2040 native USB CDC' },
];

// Common serial port path patterns by platform — last-resort match for
// devices the OS doesn't expose useful USB metadata for.
export const PORT_PATTERNS: Record<string, RegExp[]> = {
  darwin: [
    /\/dev\/cu\.usbmodem/,
    /\/dev\/cu\.usbserial/,
    /\/dev\/cu\.SLAB_USBtoUART/,
    /\/dev\/cu\.wchusbserial/,
  ],
  linux: [
    /\/dev\/ttyUSB\d+/,
    /\/dev\/ttyACM\d+/,
  ],
  win32: [
    /^COM\d+$/,
  ],
};

// Meshtastic hardware model enum values (from protobufs/meshtastic/mesh.proto).
// Update via `npm run sync-protos` (TODO) — until then, unknown ids degrade
// gracefully to "Unknown HW (id=N)" so newer firmware doesn't read as "Unset".
export const HW_MODELS: Record<number, string> = {
  0: 'Unset',
  1: 'TLORA_V2', 2: 'TLORA_V1', 3: 'TLORA_V2_1_1P6', 4: 'TBEAM',
  5: 'HELTEC_V2_0', 6: 'TBEAM_V0P7', 7: 'T_ECHO', 8: 'TLORA_V1_1P3',
  9: 'RAK4631', 10: 'HELTEC_V2_1', 11: 'HELTEC_V1', 25: 'RIPPLE',
  32: 'NANO_G1', 33: 'TLORA_V2_1_1P8', 34: 'TLORA_T3_S3',
  35: 'NANO_G1_EXPLORER', 36: 'NANO_G2_ULTRA', 39: 'STATION_G1',
  40: 'RAK11310', 41: 'SENSELORA_RP2040', 42: 'SENSELORA_S3',
  43: 'CANARYONE', 44: 'RP2040_LORA', 45: 'STATION_G2',
  46: 'LORA_RELAY_V1', 47: 'NRF52840DK', 48: 'PPR', 49: 'GENIEBLOCKS',
  50: 'NRF52_UNKNOWN', 51: 'PORTDUINO', 52: 'ANDROID_SIM', 53: 'DIY_V1',
  54: 'NRF52840_PCA10059', 55: 'DR_DEV', 56: 'M5STACK', 57: 'HELTEC_V3',
  58: 'HELTEC_WSL_V3', 59: 'BETAFPV_2400_TX', 60: 'BETAFPV_900_NANO_TX',
  61: 'RPI_PICO', 62: 'HELTEC_WIRELESS_TRACKER', 63: 'HELTEC_WIRELESS_PAPER',
  64: 'T_DECK', 65: 'T_WATCH_S3', 66: 'PICOMPUTER_S3', 67: 'HELTEC_HT62',
  68: 'EBYTE_ESP32_S3', 69: 'ESP32_S3_PICO', 70: 'CHATTER_2',
  71: 'HELTEC_WIRELESS_PAPER_V1_0', 72: 'HELTEC_WIRELESS_TRACKER_V1_0',
  73: 'UNPHONE', 74: 'TD_LORAC', 75: 'CDEBYTE_EORA_S3', 76: 'TWC_MESH_V4',
  77: 'NRF52_PROMICRO_DIY', 78: 'RADIOMASTER_900_BANDIT_NANO',
  79: 'HELTEC_CAPSULE_SENSOR_V3', 80: 'HELTEC_VISION_MASTER_T190',
  81: 'HELTEC_VISION_MASTER_E213', 82: 'HELTEC_VISION_MASTER_E290',
  83: 'HELTEC_MESH_NODE_T114', 84: 'SENSECAP_INDICATOR',
  85: 'TRACKER_T1000_E', 86: 'RAK3172', 87: 'WIO_E5',
  88: 'RADIOMASTER_900_BANDIT',
};

/** Recommended devices for new users */
export const RECOMMENDED_DEVICES: MeshtasticDeviceInfo[] = [
  {
    name: 'Heltec V3', mcu: 'ESP32-S3', loraChip: 'SX1262',
    hasGps: false, hasScreen: true, screenType: '0.96" OLED',
    battery: 'External LiPo', priceRange: '$15-20',
    notes: 'Best budget option. Small, versatile. Add GPS module separately if needed.',
    firmware: 'both',
  },
  {
    name: 'LilyGO T-Beam', mcu: 'ESP32 / ESP32-S3', loraChip: 'SX1276 / SX1262',
    hasGps: true, hasScreen: true, screenType: '0.96" OLED',
    battery: '18650 slot', priceRange: '$30-40',
    notes: 'Most popular all-in-one. Built-in GPS, 18650 battery holder. Great for mobile use.',
    firmware: 'both',
  },
  {
    name: 'LilyGO T-Echo', mcu: 'nRF52840', loraChip: 'SX1262',
    hasGps: true, hasScreen: true, screenType: '1.54" e-paper',
    battery: '850mAh built-in', priceRange: '$45-55',
    notes: 'Ultra low power (nRF52). E-paper display stays visible when off. Excellent battery life.',
    firmware: 'meshtastic',
  },
  {
    name: 'RAK WisBlock (RAK4631)', mcu: 'nRF52840', loraChip: 'SX1262',
    hasGps: false, hasScreen: false,
    battery: 'External LiPo', priceRange: '$25-45',
    notes: 'Modular system. Add GPS, sensors, displays as needed. Low power nRF52. Ideal for solar/remote nodes.',
    firmware: 'both',
  },
  {
    name: 'Station G2', mcu: 'ESP32-S3', loraChip: 'SX1262',
    hasGps: false, hasScreen: false,
    battery: 'USB powered', priceRange: '$55-65',
    notes: 'Fixed infrastructure node. Ethernet port for internet gateway. Designed for always-on use.',
    firmware: 'both',
  },
  {
    name: 'Heltec Wireless Tracker', mcu: 'ESP32-S3', loraChip: 'SX1262',
    hasGps: true, hasScreen: true, screenType: '0.96" TFT',
    battery: 'External LiPo', priceRange: '$20-25',
    notes: 'Compact tracker with GPS and color screen. Good balance of features and price.',
    firmware: 'both',
  },
];

export function lookupHwModel(modelId: number): string {
  if (HW_MODELS[modelId]) return HW_MODELS[modelId];
  if (modelId === 0) return 'Unset';
  return `Unknown HW (id=${modelId})`;
}

export interface SignatureMatch {
  confidence: Confidence;
  chipFamily?: ChipFamily;
  description: string;
}

/**
 * Classify a (vid, pid, path) tuple. Returns the strongest match available:
 *   confirmed → likely → possible → unknown
 */
export function classifyPort(opts: { vid?: string; pid?: string; path?: string }): SignatureMatch {
  const vidNum = opts.vid ? parseInt(opts.vid, 16) : undefined;
  const pidNum = opts.pid ? parseInt(opts.pid, 16) : undefined;

  if (vidNum !== undefined) {
    // Exact (vid,pid) → confirmed beats likely.
    if (pidNum !== undefined) {
      const exact = USB_SIGNATURES.find(s =>
        s.vid === vidNum && s.pid === pidNum);
      if (exact) {
        return { confidence: exact.confidence, chipFamily: exact.chipFamily, description: exact.description };
      }
      const range = USB_SIGNATURES.find(s =>
        s.vid === vidNum && s.pidMin !== undefined && s.pidMax !== undefined
        && pidNum >= s.pidMin && pidNum <= s.pidMax);
      if (range) {
        return { confidence: range.confidence, chipFamily: range.chipFamily, description: range.description };
      }
    }
    // Vid-only fallback — chip-family classification.
    const vendorOnly = USB_SIGNATURES.find(s =>
      s.vid === vidNum && s.pid === undefined && s.pidMin === undefined);
    if (vendorOnly) {
      return { confidence: vendorOnly.confidence, chipFamily: vendorOnly.chipFamily, description: vendorOnly.description };
    }
  }

  // No VID match — try platform path patterns as a last resort.
  if (opts.path) {
    const patterns = PORT_PATTERNS[process.platform] || [];
    if (patterns.some(re => re.test(opts.path!))) {
      return { confidence: 'possible', description: 'USB serial port (unknown chip)' };
    }
  }

  return { confidence: 'unknown', description: 'Unknown serial device' };
}

// Legacy boolean helper — preserved for any callers that just want a yes/no.
// New code should prefer classifyPort() and read confidence directly.
export function isKnownMeshtasticPort(vid?: string, pid?: string, path?: string): boolean {
  const match = classifyPort({ vid, pid, path });
  return match.confidence === 'confirmed' || match.confidence === 'likely';
}
