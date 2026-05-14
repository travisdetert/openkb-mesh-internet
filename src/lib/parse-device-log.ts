// Streaming parser for the Device Lab's rx serial stream.
//
// Folds incoming text lines into a small struct that the panel renders as
// "what is this device doing right now?" — reset cause, boot phases passed,
// and any panic / abort the firmware printed before it died.
//
// We intentionally match loosely (case-insensitive substring) because exact
// log strings drift across firmware versions. False-positive risk is reduced
// by skipping lines that look like protobuf bleed-through (heavy `·` content).

export type BootPhase =
  | 'rom-boot'
  | 'idf-init'
  | 'meshtastic-banner'
  | 'radio-init'
  | 'screen-init'
  | 'ble-setup'
  | 'wifi-setup'
  | 'nodedb-init'
  | 'channels-init'
  | 'main-loop';

export const BOOT_PHASE_ORDER: BootPhase[] = [
  'rom-boot',
  'idf-init',
  'meshtastic-banner',
  'radio-init',
  'screen-init',
  'ble-setup',
  'wifi-setup',
  'nodedb-init',
  'channels-init',
  'main-loop',
];

export const BOOT_PHASE_LABELS: Record<BootPhase, string> = {
  'rom-boot':          'ROM',
  'idf-init':          'ESP-IDF',
  'meshtastic-banner': 'Meshtastic',
  'radio-init':        'LoRa',
  'screen-init':       'Screen',
  'ble-setup':         'BLE',
  'wifi-setup':        'WiFi',
  'nodedb-init':       'NodeDB',
  'channels-init':     'Channels',
  'main-loop':         'Running',
};

export const BOOT_PHASE_HINTS: Record<BootPhase, string> = {
  'rom-boot':          'ROM bootloader printed its reset banner.',
  'idf-init':          'ESP-IDF core booted — heap, watchdog, scheduler are up.',
  'meshtastic-banner': 'Meshtastic firmware reached its splash banner.',
  'radio-init':        'LoRa transceiver (SX126x/SX127x) probed and initialised.',
  'screen-init':       'OLED / e-ink display initialised.',
  'ble-setup':         'Bluetooth Low Energy stack started.',
  'wifi-setup':        'WiFi subsystem started (only on WiFi-capable builds).',
  'nodedb-init':       'NodeDB loaded from flash.',
  'channels-init':     'Channel set loaded.',
  'main-loop':         'PowerFSM is in main loop — firmware is operational.',
};

export interface CrashRecord {
  at: number;
  core: number | null;
  cause: string;
  pc: string | null;
  backtrace: string[];
  hint: string | null;
  /** Captured raw lines for context (capped). */
  rawLines: string[];
}

export interface DeviceInsights {
  lastBootAt: number | null;
  lastResetCode: string | null;     // "0x1"
  lastResetReason: string | null;   // "POWERON_RESET"
  bootCount: number;
  crashCount: number;
  lastCrash: CrashRecord | null;
  bootPhases: BootPhase[];          // ordered, dedup'd, max 1 of each
  /** Internal: true while a panic header has been seen but no backtrace yet. */
  collectingCrash: boolean;
}

export function emptyInsights(): DeviceInsights {
  return {
    lastBootAt: null,
    lastResetCode: null,
    lastResetReason: null,
    bootCount: 0,
    crashCount: 0,
    lastCrash: null,
    bootPhases: [],
    collectingCrash: false,
  };
}

// ESP32 ROM prints `rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)`
// at every reset — the canonical "we just rebooted" signal.
const RST_RE      = /rst:(0x[0-9a-fA-F]+)\s*\(([^)]+)\)/;
const GURU_RE     = /Guru Meditation Error:\s*Core\s*(\d+)\s*panic'?ed\s*\(([^)]+)\)/i;
const ABORT_RE    = /abort\(\)\s*was called at PC\s*(0x[0-9a-fA-F]+)/i;
const ASSERT_RE   = /^assert failed:/i;
const BACKTRACE_RE = /Backtrace[:\s]+((?:0x[0-9a-fA-F]+:0x[0-9a-fA-F]+\s*)+)/i;

const PHASE_PATTERNS: Array<[BootPhase, RegExp]> = [
  ['rom-boot',          /^rst:0x/i],
  ['idf-init',          /\b(esp-idf|cpu_start|second-stage bootloader)\b/i],
  ['meshtastic-banner', /\bmeshtastic\b/i],
  ['radio-init',        /\b(sx12\d{2}|lora\s*radio|hardware init)/i],
  ['screen-init',       /\b(initializing screen|oled|st7789|display init)/i],
  ['ble-setup',         /\b(setting up ble|nimble|bluetooth)\b/i],
  ['wifi-setup',        /\bwifi\b/i],
  ['nodedb-init',       /\bnodedb\b/i],
  ['channels-init',     /\b(channel set|loaded channel|setting up channels)/i],
  ['main-loop',         /\b(powerfsm|sending our node info|main loop)/i],
];

const CRASH_HINTS: Record<string, string> = {
  LoadProhibited:        'Read from invalid memory — usually a null or uninitialised pointer, or a use-after-free in firmware.',
  StoreProhibited:       'Write to invalid memory — typically a null or uninitialised pointer.',
  LoadStoreError:        'Mis-aligned memory access — common when a pointer was cast from the wrong type.',
  InstructionFetchError: 'Tried to execute code from an invalid address — often a corrupted function pointer or a wild jump.',
  IllegalInstruction:    'CPU hit a non-instruction byte — often a flash read error or a corrupted partition.',
  InstrFetchProhibited:  'Tried to fetch instructions from protected memory — usually a wild jump.',
  IntegerDivideByZero:   'Division by zero. Look at the operand in the lines above the backtrace.',
  Unhandled:             'Unhandled exception — the cause string in the panic header is the relevant signal.',
};

/** Conservative noise filter — drops lines that are mostly protobuf bleed-through. */
function looksLikeLogLine(line: string): boolean {
  if (line.length < 4) return false;
  let dots = 0;
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 183) dots++; // '·' = U+00B7
  return dots / line.length < 0.3;
}

export function foldLines(prev: DeviceInsights, lines: string[], at: number): DeviceInsights {
  let next = prev;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    next = foldOneLine(next, line, at);
  }
  return next;
}

function foldOneLine(s: DeviceInsights, line: string, at: number): DeviceInsights {
  // 1) Reset banner — a new boot has begun. Reset boot-phase tracking but
  // keep the prior crash record around so the user can still see why we
  // rebooted (the panic always prints before the reset).
  const rst = RST_RE.exec(line);
  if (rst) {
    return {
      ...s,
      lastBootAt: at,
      lastResetCode: rst[1],
      lastResetReason: rst[2],
      bootCount: s.bootCount + 1,
      bootPhases: ['rom-boot'],
      collectingCrash: false,
    };
  }

  // 2) Panic header — open a crash record.
  const guru = GURU_RE.exec(line);
  if (guru) {
    const cause = guru[2];
    return {
      ...s,
      crashCount: s.crashCount + 1,
      collectingCrash: true,
      lastCrash: {
        at,
        core: parseInt(guru[1], 10),
        cause,
        pc: null,
        backtrace: [],
        hint: CRASH_HINTS[cause] ?? CRASH_HINTS.Unhandled,
        rawLines: [line],
      },
    };
  }

  const abort = ABORT_RE.exec(line);
  if (abort) {
    return {
      ...s,
      crashCount: s.crashCount + 1,
      collectingCrash: true,
      lastCrash: {
        at,
        core: null,
        cause: 'abort()',
        pc: abort[1],
        backtrace: [],
        hint: 'Firmware called abort() — usually from a failed assertion or a watchdog timeout.',
        rawLines: [line],
      },
    };
  }

  if (ASSERT_RE.test(line)) {
    return {
      ...s,
      crashCount: s.crashCount + 1,
      collectingCrash: true,
      lastCrash: {
        at,
        core: null,
        cause: 'assert failed',
        pc: null,
        backtrace: [],
        hint: 'A C-level assertion in firmware failed. The line itself names the file and the failing condition.',
        rawLines: [line],
      },
    };
  }

  // 3) Backtrace line — append frames to the open crash, then close it.
  const bt = BACKTRACE_RE.exec(line);
  if (bt && s.lastCrash) {
    const frames = bt[1].trim().split(/\s+/);
    return {
      ...s,
      collectingCrash: false,
      lastCrash: {
        ...s.lastCrash,
        backtrace: [...s.lastCrash.backtrace, ...frames],
        rawLines: [...s.lastCrash.rawLines, line],
      },
    };
  }

  // 4) Between the panic header and the backtrace, accumulate raw lines as
  // context (register dump, etc.) up to a small cap.
  if (s.collectingCrash && s.lastCrash && s.lastCrash.rawLines.length < 40) {
    return {
      ...s,
      lastCrash: { ...s.lastCrash, rawLines: [...s.lastCrash.rawLines, line] },
    };
  }

  // 5) Boot-phase detection — only on lines that look like real log output.
  if (!looksLikeLogLine(line)) return s;
  for (const [phase, re] of PHASE_PATTERNS) {
    if (s.bootPhases.includes(phase)) continue;
    if (re.test(line)) return { ...s, bootPhases: [...s.bootPhases, phase] };
  }

  return s;
}
