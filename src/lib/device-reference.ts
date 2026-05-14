// Physical reference data for Meshtastic devices — buttons, ports, schematic
// layout, and first-time-setup tips. Surfaced in the Device DB panel and
// linked to from connect / troubleshoot flows.
//
// Scope: the "★ recommended" devices in CATALOG (DeviceDatabasePanel.tsx).
// Other devices fall back to the generic spec card without a diagram.
//
// Positions in the layout are abstract fractions (0..1 of the board area)
// because we're rendering a schematic, NOT a photographic mockup. Don't
// expect millimeter-accurate placement.

export interface ButtonAction {
  /** When the button is engaged: "short press", "long press 5s", "hold during boot". */
  trigger: string;
  /** What it does. */
  effect: string;
}

export interface DeviceButton {
  /** Silkscreen label (USER / PRG / RST / BOOT / PWR). */
  label: string;
  /** Optional alt name (e.g. "PRG" alongside "USER" for the same key). */
  altLabel?: string;
  /** Position within the board area, fractions of width/height. */
  x: number;
  y: number;
  actions: ButtonAction[];
}

export type PortConnector =
  | 'usb-c'
  | 'micro-usb'
  | 'sma'
  | 'rp-sma'
  | 'ipex'
  | 'ufl'
  | 'chip-antenna'
  | 'jst-1.25'
  | 'jst-2.0'
  | 'screw-terminal'
  | 'ethernet'
  | 'microsd'
  | 'solar-jst'
  | 'header-pins';

export interface DevicePort {
  label: string;
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** 0..1 along that edge (0=top/left end, 1=opposite). */
  position: number;
  connector: PortConnector;
  /** Free-form notes shown in the port table. */
  notes?: string;
}

export interface InternalFeature {
  /** Visual category — picks a default fill / icon. */
  kind:
    | 'display-oled'
    | 'display-tft'
    | 'display-eink'
    | 'gps-module'
    | 'battery-holder'
    | 'battery-internal'
    | 'keyboard'
    | 'trackball'
    | 'solar-panel'
    | 'enclosure-label'
    | 'lora-module'
    | 'mcu-area'
    | 'wisblock-slot'
    | 'speaker'
    | 'led-strip'
    | 'sd-slot';
  label: string;
  /** Position within the board area, fractions. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeviceLayout {
  /** Board outline shape. */
  shape: 'rect' | 'rounded' | 'card' | 'stick' | 'enclosure';
  /** Width/height aspect ratio of the board area itself. */
  aspect: number;
  features: InternalFeature[];
  buttons: DeviceButton[];
  ports: DevicePort[];
}

export interface SetupTip {
  title: string;
  body: string;
  /** info = neutral, warn = caution, bad = will damage hardware if ignored. */
  tone?: 'info' | 'warn' | 'bad';
}

export interface DeviceReference {
  hwModel: number;
  /** Two-sentence description of the physical board (form factor, materials,
   *  notable physical features). Distinct from the spec notes. */
  physicalNotes: string;
  layout: DeviceLayout;
  setupTips: SetupTip[];
  /** How to put the device into bootloader / DFU mode for flashing. */
  bootloaderInstructions: string;
}

// Human-readable labels for connector types, used in the ports table.
export const CONNECTOR_LABELS: Record<PortConnector, string> = {
  'usb-c':          'USB-C',
  'micro-usb':      'micro-USB',
  'sma':            'SMA (female on board)',
  'rp-sma':         'RP-SMA',
  'ipex':           'IPEX / U.FL',
  'ufl':            'U.FL',
  'chip-antenna':   'chip antenna (no connector)',
  'jst-1.25':       'JST 1.25 mm (2-pin)',
  'jst-2.0':        'JST 2.0 mm (2-pin)',
  'screw-terminal': 'screw terminal',
  'ethernet':       'RJ45 Ethernet',
  'microsd':        'microSD slot',
  'solar-jst':      'solar JST (5–6 V)',
  'header-pins':    '0.1″ header pins',
};

// ──────────────────────────────────────────────────────────────────────
// Device entries. Keyed by hwModel for direct lookup from CATALOG.
//
// NOTE on accuracy: button/port positions are approximate ("the USER
// button is somewhere on the top edge"). The point is to teach a new user
// what's on the board, not to substitute for the datasheet.
// ──────────────────────────────────────────────────────────────────────

// hwModel 43 — Heltec V3 (ESP32-S3 + SX1262)
const HELTEC_V3: DeviceReference = {
  hwModel: 43,
  physicalNotes: 'Small (~52×25 mm) ESP32-S3 board. OLED at one end, USB-C at the other. LoRa antenna terminates in an IPEX (U.FL) connector — you must attach the supplied stub antenna before powering on.',
  layout: {
    shape: 'rounded',
    aspect: 2.2,
    features: [
      { kind: 'display-oled',  label: 'OLED 0.96″ 128×64', x: 0.04, y: 0.18, w: 0.40, h: 0.42 },
      { kind: 'mcu-area',      label: 'ESP32-S3',          x: 0.52, y: 0.30, w: 0.22, h: 0.30 },
      { kind: 'lora-module',   label: 'SX1262',            x: 0.78, y: 0.30, w: 0.18, h: 0.30 },
    ],
    buttons: [
      { label: 'USER', altLabel: 'PRG', x: 0.42, y: 0.04, actions: [
        { trigger: 'short press', effect: 'wake display / cycle screens (firmware-dependent)' },
        { trigger: 'hold during reset', effect: 'enter ESP32 ROM bootloader (Boot-Mode = USB)' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',  edge: 'left',  position: 0.5, connector: 'usb-c',    notes: 'Power + serial. Also charges the LiPo.' },
      { label: 'BAT',    edge: 'right', position: 0.85, connector: 'jst-1.25', notes: 'Single-cell LiPo (3.7 V). Polarity is marked on the silkscreen — getting it wrong releases the magic smoke.' },
      { label: 'ANT',    edge: 'right', position: 0.15, connector: 'ipex',     notes: 'LoRa antenna. Stub antenna ships in the box; the pigtail is fragile.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Attach the antenna first',
      body: 'Never power the Heltec V3 without the LoRa antenna connected. Transmitting into an open RF output can damage the SX1262 PA. Slide the stub antenna onto the IPEX connector until it clicks.' },
    { tone: 'warn', title: 'Battery polarity',
      body: 'Heltec ships some batches with reversed JST polarity. Check the +/− silkscreen on the board against the wires on your LiPo before plugging in. If in doubt, multimeter the JST.' },
    { tone: 'info', title: 'No GPS',
      body: 'There is no GPS on the V3. If you need positions, either pair with a phone (Meshtastic app provides phone GPS) or step up to the Heltec Wireless Tracker / T-Beam.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release RST and USER. Board enters the ESP32-S3 ROM bootloader and esptool can flash firmware. Press RST again to boot back into Meshtastic.',
};

// hwModel 39 — Station G2 (ESP32-S3 + SX1262, enclosed router)
const STATION_G2: DeviceReference = {
  hwModel: 39,
  physicalNotes: 'Enclosed plastic chassis (~90×60 mm) designed as a permanent infrastructure node. External SMA antenna, integrated USB-C, no display. Mountable via the rear pattern.',
  layout: {
    shape: 'enclosure',
    aspect: 1.5,
    features: [
      { kind: 'enclosure-label', label: 'Station G2 (sealed enclosure)', x: 0.1, y: 0.30, w: 0.8, h: 0.4 },
    ],
    buttons: [
      { label: 'USER', x: 0.20, y: 0.05, actions: [
        { trigger: 'short press', effect: 'request status / blink LED (firmware-dependent)' },
        { trigger: 'long press 10 s', effect: 'factory reset' },
      ]},
      { label: 'RST', x: 0.80, y: 0.05, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.30, connector: 'usb-c',    notes: 'Sole power input. Power-only USB hub is fine — no battery onboard.' },
      { label: 'ETH',      edge: 'bottom', position: 0.70, connector: 'ethernet', notes: 'Wired uplink for using the radio as an internet gateway (mqtt).' },
      { label: 'LoRa ANT', edge: 'top',    position: 0.50, connector: 'sma',      notes: 'External SMA-female. Use a flexible whip or feedline to a roof-mounted dipole.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Always attach the antenna',
      body: 'Same rule as every LoRa radio — never transmit into an open SMA port. The Station G2 ships with an antenna; install it before plugging in USB.' },
    { tone: 'info', title: 'Intended as a fixed node',
      body: 'No battery, no display. Best deployed as an always-on relay or MQTT gateway. Pairing with the phone app requires Bluetooth or the Wi-Fi web UI.' },
    { tone: 'info', title: 'Wired Ethernet bridging',
      body: 'Ethernet lets the radio reach an MQTT broker without going via your phone or Wi-Fi. Useful for permanent installations.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release. Enters ESP32-S3 ROM bootloader. Some early-batch enclosures have stiff buttons — press firmly.',
};

// hwModel 4 — Lilygo T-Beam (classic ESP32 + SX1276/SX1262 + GPS)
const TBEAM: DeviceReference = {
  hwModel: 4,
  physicalNotes: 'Iconic ~95×30 mm board with an 18650 holder on the back. GPS module (typically u-blox NEO-6M / NEO-M8N) sits next to the OLED. Power slide-switch on one edge — this is in addition to the RST button.',
  layout: {
    shape: 'rect',
    aspect: 3.0,
    features: [
      { kind: 'display-oled',  label: 'OLED 0.96″',       x: 0.03, y: 0.22, w: 0.20, h: 0.50 },
      { kind: 'gps-module',    label: 'GPS (u-blox)',     x: 0.26, y: 0.22, w: 0.18, h: 0.50 },
      { kind: 'mcu-area',      label: 'ESP32',            x: 0.48, y: 0.30, w: 0.18, h: 0.35 },
      { kind: 'lora-module',   label: 'SX1276/SX1262',    x: 0.70, y: 0.30, w: 0.18, h: 0.35 },
      { kind: 'battery-holder', label: '18650 holder (back side)', x: 0.10, y: 0.78, w: 0.80, h: 0.18 },
    ],
    buttons: [
      { label: 'PWR', x: 0.05, y: 0.04, actions: [
        { trigger: 'short press', effect: 'toggle AXP power (some revisions; do not confuse with USER)' },
        { trigger: 'long press 6 s', effect: 'PMIC power-off (cuts battery to MCU)' },
      ]},
      { label: 'USER', x: 0.42, y: 0.04, actions: [
        { trigger: 'short press', effect: 'cycle OLED page' },
        { trigger: 'long press', effect: 'shutdown menu / GPS toggle (firmware-dependent)' },
        { trigger: 'hold during reset', effect: 'enter ESP32 download mode' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'left',  position: 0.50, connector: 'usb-c',    notes: 'Newer revisions are USB-C; older T-Beams (pre-2022) used micro-USB.' },
      { label: 'GPS ANT',  edge: 'top',   position: 0.30, connector: 'ipex',     notes: 'IPEX for the GPS active patch antenna (included).' },
      { label: 'LoRa ANT', edge: 'right', position: 0.50, connector: 'sma',      notes: 'External SMA on the LoRa side. Some clones ship with a poor-quality stub — upgrade for range.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'No antenna = dead radio',
      body: 'Attach the LoRa SMA antenna before powering on. The T-Beam will happily transmit into an open port and burn out the PA.' },
    { tone: 'warn', title: '18650 polarity matters',
      body: 'The 18650 must go in flat-side (negative) toward the spring. Some clone batches print the polarity inconsistently — trust the spring, not the silkscreen.' },
    { tone: 'warn', title: 'Two power buttons',
      body: 'The PWR (slide / button by USB) and USER buttons are NOT the same. Holding PWR cuts power at the PMIC; the radio will appear dead until you tap PWR again.' },
    { tone: 'info', title: 'GPS takes minutes for first fix',
      body: 'Cold-start GPS lock can take 30 s – 5 min outdoors. Indoors near a window may never lock. The OLED shows satellite count once the fix is acquired.' },
  ],
  bootloaderInstructions:
    'Hold USER (also marked IO0 / IO38 on some revisions) while pressing RST, then release. ESP32 enters download mode. Use esptool or the Meshtastic flasher.',
};

// hwModel 7 — Lilygo T-Echo (nRF52840 + SX1262 + e-paper)
const T_ECHO: DeviceReference = {
  hwModel: 7,
  physicalNotes: 'Pocketable ~80×40 mm board in a 3D-printed case. 1.54″ e-paper screen (visible without backlight), integrated 850 mAh LiPo, GNSS antenna, single multifunction button + reset, USB-C.',
  layout: {
    shape: 'rounded',
    aspect: 1.5,
    features: [
      { kind: 'display-eink', label: '1.54″ e-paper', x: 0.10, y: 0.10, w: 0.80, h: 0.55 },
      { kind: 'gps-module',   label: 'GPS (L76K)',    x: 0.10, y: 0.70, w: 0.35, h: 0.20 },
      { kind: 'lora-module',  label: 'SX1262',        x: 0.55, y: 0.70, w: 0.35, h: 0.20 },
    ],
    buttons: [
      { label: 'USER', x: 0.50, y: 0.04, actions: [
        { trigger: 'short press', effect: 'wake / refresh display / cycle pages' },
        { trigger: 'long press 5 s', effect: 'shutdown / sleep' },
        { trigger: 'hold during reset', effect: 'enter Adafruit nRF52 DFU bootloader' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset (also acts as a 1200-baud DFU trigger via the USB CDC layer)' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.5, connector: 'usb-c',     notes: 'Power, serial, and Adafruit DFU. The 1200-baud touch trick on this port enters DFU.' },
      { label: 'LoRa ANT', edge: 'right',  position: 0.5, connector: 'chip-antenna', notes: 'No external SMA — the LoRa antenna is on-board as a chip antenna. Range is fine for handheld use; not ideal for fixed installation.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'E-paper has a refresh budget',
      body: 'Full e-paper refresh costs ~5 s and a noticeable current spike. Meshtastic firmware refreshes only when content changes — do not expect a live ticker.' },
    { tone: 'info', title: 'Always-on display',
      body: 'The e-paper image persists with no power. Even with the device off, the last screen contents stay visible — useful as a static name tag.' },
    { tone: 'warn', title: 'DFU is a 1200-baud touch',
      body: 'On nRF52 with the Adafruit bootloader you do NOT hold a button to flash. Briefly open the USB port at 1200 baud and close it — that triggers DFU. This app does it for you in the Device Lab.' },
  ],
  bootloaderInstructions:
    'Open the USB-C port at 1200 baud for ~100 ms and close it. The board reboots into the Adafruit nRF52 DFU bootloader and shows up as a USB MSC volume.',
};

// hwModel 50 — Lilygo T-Deck (ESP32-S3 + SX1262 + TFT + keyboard)
const T_DECK: DeviceReference = {
  hwModel: 50,
  physicalNotes: 'Handheld ~110×80 mm with a 2.8″ TFT screen, BlackBerry-style QWERTY keyboard, and a trackball. USB-C on the bottom edge, microSD slot, speaker.',
  layout: {
    shape: 'rounded',
    aspect: 1.4,
    features: [
      { kind: 'display-tft', label: '2.8″ TFT 320×240', x: 0.10, y: 0.05, w: 0.80, h: 0.40 },
      { kind: 'keyboard',    label: 'QWERTY keyboard',  x: 0.05, y: 0.50, w: 0.90, h: 0.45 },
      { kind: 'trackball',   label: 'Trackball',         x: 0.45, y: 0.46, w: 0.10, h: 0.07 },
    ],
    buttons: [
      { label: 'PWR', x: 0.95, y: 0.50, actions: [
        { trigger: 'short press', effect: 'wake display' },
        { trigger: 'long press 3 s', effect: 'power off' },
      ]},
      { label: 'BOOT', x: 0.05, y: 0.50, actions: [
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.05, y: 0.96, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',  edge: 'bottom', position: 0.50, connector: 'usb-c',    notes: 'Power, serial, charging.' },
      { label: 'microSD', edge: 'right', position: 0.20, connector: 'microsd',  notes: 'Optional. Used by some custom firmware for logs / replays.' },
      { label: 'ANT',    edge: 'top',    position: 0.50, connector: 'ipex',     notes: 'LoRa antenna IPEX, internal stub pre-installed.' },
    ],
  },
  setupTips: [
    { tone: 'warn', title: 'Keyboard requires backlight to read',
      body: 'The keyboard legend is hard to see in dim light. The TFT side-lighting helps, but bring a headlamp if you plan to use this in the field at night.' },
    { tone: 'warn', title: 'Battery life is modest',
      body: 'The TFT + always-on radio is power-hungry. Expect 6–10 h on the stock 1500 mAh battery in active use. Plug into USB for any long session.' },
    { tone: 'info', title: 'Trackball + Enter for navigation',
      body: 'Meshtastic firmware uses the trackball for menu navigation. Pressing the trackball is the "select" action.' },
  ],
  bootloaderInstructions:
    'Hold BOOT while pressing RST, then release. ESP32-S3 enters ROM bootloader. Some users report the BOOT button being recessed enough that a paperclip helps.',
};

// hwModel 106 — Lilygo T-Deck Pro (T-Deck + GPS + IMU + bigger battery)
const T_DECK_PRO: DeviceReference = {
  hwModel: 106,
  physicalNotes: 'Same handheld form as T-Deck with added GPS module, IMU, larger battery, and reportedly a touch-capable variant. Expect more weight (~190 g) than the original T-Deck.',
  layout: {
    shape: 'rounded',
    aspect: 1.4,
    features: [
      { kind: 'display-tft', label: '2.8″ TFT 320×240', x: 0.10, y: 0.05, w: 0.80, h: 0.38 },
      { kind: 'keyboard',    label: 'QWERTY keyboard',  x: 0.05, y: 0.50, w: 0.90, h: 0.43 },
      { kind: 'trackball',   label: 'Trackball',         x: 0.45, y: 0.45, w: 0.10, h: 0.06 },
      { kind: 'gps-module',  label: 'GPS',               x: 0.05, y: 0.45, w: 0.10, h: 0.05 },
    ],
    buttons: [
      { label: 'PWR', x: 0.95, y: 0.50, actions: [
        { trigger: 'short press', effect: 'wake / sleep display' },
        { trigger: 'long press 3 s', effect: 'power off' },
      ]},
      { label: 'BOOT', x: 0.05, y: 0.50, actions: [
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.05, y: 0.96, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',   edge: 'bottom', position: 0.5,  connector: 'usb-c',    notes: 'Charging + serial. PD-friendly.' },
      { label: 'microSD', edge: 'right',  position: 0.2,  connector: 'microsd',  notes: 'For logs / firmware staging.' },
      { label: 'LoRa ANT', edge: 'top',    position: 0.45, connector: 'ipex',     notes: 'Internal IPEX-routed antenna.' },
      { label: 'GPS ANT',  edge: 'top',    position: 0.65, connector: 'chip-antenna', notes: 'On-board GPS chip antenna; reception is fine in handheld orientation.' },
    ],
  },
  setupTips: [
    { tone: 'warn', title: 'Allow first GPS lock outside',
      body: 'The IMU + GPS combo benefits from a cold-start outdoors. Indoor first-fix can take 5–10 min or fail.' },
    { tone: 'info', title: 'Touch + trackball both work',
      body: 'Some firmware builds enable touch on the TFT — others rely on the trackball. If touch seems dead, check the firmware variant.' },
    { tone: 'info', title: 'Charging note',
      body: 'The larger battery happily accepts 5 V / 1.5 A. With a power-only USB-A → C cable the indicator can be misleading; use a proper USB-C cable.' },
  ],
  bootloaderInstructions:
    'Hold BOOT while pressing RST, then release. The board enters the ESP32-S3 ROM bootloader. Use a fingernail or paperclip — the BOOT button is small.',
};

// hwModel 11 — RAKwireless RAK4631 / WisBlock
const RAK4631: DeviceReference = {
  hwModel: 11,
  physicalNotes: 'Modular system. The RAK4631 "core" plugs into a base board (typically RAK19007 or RAK5005-O). The base provides USB-C, battery JST, button(s), and a number of slot connectors (IO slots A/B/C/D + sensor slot). Optional modules (RAK1910 GPS, RAK1921 OLED, RAK1906 environmental) slot in.',
  layout: {
    shape: 'rect',
    aspect: 1.6,
    features: [
      { kind: 'wisblock-slot', label: 'RAK4631 core module',  x: 0.05, y: 0.10, w: 0.40, h: 0.80 },
      { kind: 'wisblock-slot', label: 'Slot A (sensor/GPS)', x: 0.50, y: 0.10, w: 0.20, h: 0.35 },
      { kind: 'wisblock-slot', label: 'Slot B',               x: 0.50, y: 0.55, w: 0.20, h: 0.35 },
      { kind: 'wisblock-slot', label: 'Slot C (display)',    x: 0.75, y: 0.10, w: 0.20, h: 0.35 },
      { kind: 'wisblock-slot', label: 'Slot D',               x: 0.75, y: 0.55, w: 0.20, h: 0.35 },
    ],
    buttons: [
      { label: 'USER', x: 0.30, y: 0.04, actions: [
        { trigger: 'short press', effect: 'wake / refresh state (firmware-dependent)' },
        { trigger: 'hold during reset', effect: 'enter nRF52 DFU bootloader (some base boards only)' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.30, connector: 'usb-c',    notes: 'Power, serial, and Adafruit DFU via 1200-baud touch.' },
      { label: 'BAT',      edge: 'bottom', position: 0.70, connector: 'jst-1.25', notes: 'Single-cell LiPo. Polarity per silkscreen.' },
      { label: 'LoRa ANT', edge: 'right',  position: 0.50, connector: 'ipex',     notes: 'IPEX → stub or SMA pigtail. Check the antenna routing for your base board variant.' },
      { label: 'SOLAR',    edge: 'left',   position: 0.30, connector: 'solar-jst', notes: 'Only on certain base boards (RAK19007). Accepts 5–6 V solar input.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'It is a system, not a board',
      body: 'The RAK4631 by itself only has a USB connector once mounted on a base. Plan which base (RAK19007 for solar, RAK5005-O for indoor) and which sensor modules you need before ordering.' },
    { tone: 'warn', title: 'Slot orientation',
      body: 'Modules go in only one way. Each slot is keyed but the markings are subtle — line up the silkscreen labels (A, B, C, D) before pressing.' },
    { tone: 'warn', title: 'DFU is 1200-baud touch',
      body: 'Same nRF52 trick as T-Echo: open USB at 1200 baud, close it. No button needed. The Device Lab panel does it for you.' },
    { tone: 'info', title: 'Excellent for solar deployments',
      body: 'Sleep-mode current at the system level is < 30 µA. Pair with the RAK19007 base + a 5 W panel + a 5000 mAh LiPo and you have a true plant-and-forget node.' },
  ],
  bootloaderInstructions:
    'Open USB-C at 1200 baud for ~100 ms and close it. Board enters Adafruit nRF52 DFU bootloader. The board reappears as a USB mass storage volume.',
};

// hwModel 51 — B&Q NanoG2 Ultra (nRF52840)
const NANO_G2_ULTRA: DeviceReference = {
  hwModel: 51,
  physicalNotes: 'Pocket-sized nRF52840 board (~60×35 mm) with on-board OLED, GPS, LiPo, and antenna. Comes in a slim case. USB-C on the short edge.',
  layout: {
    shape: 'rounded',
    aspect: 1.7,
    features: [
      { kind: 'display-oled', label: 'OLED 128×64', x: 0.10, y: 0.08, w: 0.55, h: 0.32 },
      { kind: 'gps-module',   label: 'GPS',          x: 0.70, y: 0.08, w: 0.25, h: 0.32 },
      { kind: 'mcu-area',     label: 'nRF52840',     x: 0.10, y: 0.50, w: 0.40, h: 0.40 },
      { kind: 'lora-module',  label: 'SX1262',       x: 0.55, y: 0.50, w: 0.40, h: 0.40 },
    ],
    buttons: [
      { label: 'USER', x: 0.30, y: 0.96, actions: [
        { trigger: 'short press', effect: 'wake / cycle display' },
        { trigger: 'long press', effect: 'shutdown / sleep' },
      ]},
      { label: 'RST', x: 0.70, y: 0.96, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5, connector: 'usb-c',        notes: 'Power, serial, 1200-baud DFU.' },
      { label: 'ANT',   edge: 'right', position: 0.5, connector: 'chip-antenna', notes: 'On-board LoRa chip antenna — convenient but limits range vs. a board with an SMA whip.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Small antenna, modest range',
      body: 'The chip antenna is fine for urban / suburban contact but loses 3–6 dB versus a typical SMA whip. For maximum range, prefer T-Echo or RAK with external antenna.' },
    { tone: 'warn', title: 'No external antenna option',
      body: 'There is no SMA pad you can solder to. If your use case needs range, choose a different board.' },
    { tone: 'info', title: 'Long battery life',
      body: 'nRF52 + small OLED makes this one of the lowest-idle-current Meshtastic builds. Expect days to a week of standby on the integrated battery.' },
  ],
  bootloaderInstructions:
    'Double-tap RST quickly. The nRF52 Adafruit bootloader enters DFU mode and the device appears as a USB mass storage volume. Alternative: 1200-baud USB touch.',
};

// hwModel 94 — Heltec Mesh Pocket
const HELTEC_MESH_POCKET: DeviceReference = {
  hwModel: 94,
  physicalNotes: 'Handheld ~95×55 mm in a plastic shell with a 1.9″ TFT, integrated LiPo, and GPS. USB-C on bottom. Single-button-plus-trackpad style navigation.',
  layout: {
    shape: 'rounded',
    aspect: 1.7,
    features: [
      { kind: 'display-tft', label: '1.9″ TFT', x: 0.10, y: 0.08, w: 0.80, h: 0.55 },
      { kind: 'gps-module',  label: 'GPS',      x: 0.10, y: 0.70, w: 0.30, h: 0.20 },
      { kind: 'mcu-area',    label: 'ESP32-S3', x: 0.45, y: 0.70, w: 0.25, h: 0.20 },
      { kind: 'lora-module', label: 'SX1262',   x: 0.75, y: 0.70, w: 0.20, h: 0.20 },
    ],
    buttons: [
      { label: 'PWR', x: 0.95, y: 0.50, actions: [
        { trigger: 'short press', effect: 'wake display' },
        { trigger: 'long press 3 s', effect: 'power off' },
      ]},
      { label: 'USER', x: 0.05, y: 0.50, actions: [
        { trigger: 'short press', effect: 'cycle pages / menu' },
      ]},
      { label: 'RST', x: 0.05, y: 0.96, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
        { trigger: 'hold during USER press', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
    ],
    ports: [
      { label: 'USB-C',   edge: 'bottom', position: 0.5, connector: 'usb-c',        notes: 'Charging + serial.' },
      { label: 'LoRa ANT', edge: 'top',    position: 0.5, connector: 'ipex',         notes: 'Internal IPEX → pre-installed antenna.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Field-friendly form factor',
      body: 'Pocketable, with a screen you can actually read in motion. Good middle ground between a Heltec V3 (no screen value-add) and a T-Deck (heavy).' },
    { tone: 'warn', title: 'TFT in direct sun is hard to read',
      body: 'The colour TFT washes out in bright sun. Find shade or tilt the screen.' },
  ],
  bootloaderInstructions:
    'Hold USER (or BOOT, depending on revision) while pressing RST, then release. Board enters ESP32-S3 ROM bootloader.',
};

// hwModel 95 — Seeed Solar Node
const SEEED_SOLAR_NODE: DeviceReference = {
  hwModel: 95,
  physicalNotes: 'IP-rated enclosure designed for permanent outdoor deployment. Built-in solar panel on one face, USB-C for initial setup, external antenna SMA. No display, no internal user button beyond reset.',
  layout: {
    shape: 'enclosure',
    aspect: 1.0,
    features: [
      { kind: 'solar-panel',     label: 'Solar panel (top face)', x: 0.10, y: 0.10, w: 0.80, h: 0.50 },
      { kind: 'enclosure-label', label: 'Seeed Solar Node — IP67 enclosure', x: 0.10, y: 0.70, w: 0.80, h: 0.20 },
    ],
    buttons: [
      { label: 'RST', x: 0.50, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset (recessed, requires pin)' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.30, connector: 'usb-c',  notes: 'Behind a sealed gasket. Use for initial pairing / firmware, then re-seal.' },
      { label: 'LoRa ANT', edge: 'top',    position: 0.50, connector: 'sma',    notes: 'External SMA, weatherized. Use a vertically polarised whip for omni coverage.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Re-seal after every USB session',
      body: 'IP rating depends on the gasket being seated correctly. After flashing or configuring, double-check the USB-C cover before deploying outdoors.' },
    { tone: 'warn', title: 'Mount the solar panel south (NH) / north (SH)',
      body: 'A 90° tilt south at your latitude gives the best year-round harvest. Flat mounting wastes ~30% in winter.' },
    { tone: 'info', title: 'Plug-and-forget',
      body: 'Designed to sit on a mast for years. Provision via Bluetooth once, then never touch it.' },
  ],
  bootloaderInstructions:
    'Open USB-C cover, press RST with a paperclip, then within 1 s use 1200-baud touch (Device Lab handles this).',
};

// hwModel 71 — Seeed Tracker T1000-E
const T1000_E: DeviceReference = {
  hwModel: 71,
  physicalNotes: 'Credit-card-sized (~85×54 mm) nRF52840 + LR1110 tracker. Slim plastic body, single side button, small e-ink, integrated battery, USB-C on the short edge.',
  layout: {
    shape: 'card',
    aspect: 1.6,
    features: [
      { kind: 'display-eink',    label: 'small e-paper',  x: 0.10, y: 0.10, w: 0.80, h: 0.45 },
      { kind: 'gps-module',      label: 'LR1110 (GNSS + LoRa)', x: 0.10, y: 0.62, w: 0.80, h: 0.20 },
      { kind: 'battery-internal',label: 'integrated LiPo', x: 0.10, y: 0.84, w: 0.80, h: 0.10 },
    ],
    buttons: [
      { label: 'USER', x: 0.95, y: 0.50, actions: [
        { trigger: 'short press', effect: 'wake / refresh display' },
        { trigger: 'long press 5 s', effect: 'send tracker-style alert (firmware-dependent)' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.5, connector: 'usb-c',        notes: 'Power, serial, 1200-baud DFU.' },
      { label: 'LoRa ANT', edge: 'right',  position: 0.5, connector: 'chip-antenna', notes: 'On-board chip antenna shared with GNSS. No external option.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Tracker-style firmware',
      body: 'T1000-E ships with a tracker-specific Meshtastic build. Standard chat / DM still works, but the UI is optimised for "where am I + emergency button".' },
    { tone: 'warn', title: 'Sealed enclosure',
      body: 'No accessible internal battery. Treat as semi-disposable / send-back-for-service if the battery dies.' },
    { tone: 'info', title: 'GNSS + LoRa on one chip',
      body: 'LR1110 lets the radio scan WiFi APs and GNSS satellites for position even before the GPS gets a fix. Useful in dense urban canyons.' },
  ],
  bootloaderInstructions:
    'Double-tap the USER button, or use 1200-baud USB touch via the Device Lab. Adafruit nRF52 DFU comes up as USB mass storage.',
};

// hwModel 44 — Heltec WSL V3 (ESP32-S3 + SX1262, no display)
const HELTEC_WSL_V3: DeviceReference = {
  hwModel: 44,
  physicalNotes: 'The "stick lite" version of the V3: same ESP32-S3 + SX1262, same IPEX antenna and JST battery connector, but no display. Smaller (~45×20 mm) and cheaper. Popular as a deploy-and-forget router.',
  layout: {
    shape: 'stick',
    aspect: 2.6,
    features: [
      { kind: 'mcu-area',    label: 'ESP32-S3', x: 0.10, y: 0.30, w: 0.40, h: 0.40 },
      { kind: 'lora-module', label: 'SX1262',    x: 0.55, y: 0.30, w: 0.35, h: 0.40 },
    ],
    buttons: [
      { label: 'USER', altLabel: 'PRG', x: 0.42, y: 0.05, actions: [
        { trigger: 'short press', effect: 'firmware-defined (often a no-op without display)' },
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.96, y: 0.05, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5,  connector: 'usb-c',     notes: 'Power + serial. Charges the LiPo if connected.' },
      { label: 'BAT',   edge: 'right', position: 0.85, connector: 'jst-1.25',  notes: 'Single-cell LiPo. Polarity per silkscreen — check it before plugging in.' },
      { label: 'ANT',   edge: 'right', position: 0.15, connector: 'ipex',      notes: 'LoRa antenna IPEX. Stub usually included.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Attach antenna before power',
      body: 'The PA on a transmitting LoRa radio dies fast into an open output. Stub or whip first, USB second.' },
    { tone: 'info', title: 'No display = bring a phone',
      body: 'WSL V3 has nothing to look at. Use the Meshtastic phone app over BLE to pair, name, and configure it on first boot.' },
    { tone: 'info', title: 'Cheapest practical router',
      body: 'At ~$15 this is the lowest-cost board with full Meshtastic support. Pair with a 5 dBi antenna and it makes a fine fixed relay.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release. Enters ESP32-S3 ROM bootloader.',
};

// hwModel 48 — Heltec Wireless Tracker (V3 + GPS + TFT)
const HELTEC_WIRELESS_TRACKER: DeviceReference = {
  hwModel: 48,
  physicalNotes: 'Same body as Heltec V3 but with a 0.96″ TFT colour display, integrated GPS, and a chip GPS antenna. USB-C on one short edge, LoRa IPEX on the other.',
  layout: {
    shape: 'rounded',
    aspect: 2.2,
    features: [
      { kind: 'display-tft', label: '0.96″ TFT', x: 0.04, y: 0.18, w: 0.34, h: 0.50 },
      { kind: 'gps-module',  label: 'GPS',       x: 0.42, y: 0.30, w: 0.18, h: 0.30 },
      { kind: 'mcu-area',    label: 'ESP32-S3',  x: 0.62, y: 0.30, w: 0.18, h: 0.30 },
      { kind: 'lora-module', label: 'SX1262',    x: 0.82, y: 0.30, w: 0.14, h: 0.30 },
    ],
    buttons: [
      { label: 'USER', altLabel: 'PRG', x: 0.42, y: 0.04, actions: [
        { trigger: 'short press', effect: 'wake / cycle screens' },
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',   edge: 'left',  position: 0.5,  connector: 'usb-c',        notes: 'Power, serial, LiPo charging.' },
      { label: 'BAT',     edge: 'right', position: 0.88, connector: 'jst-1.25',     notes: 'Single-cell LiPo. Check polarity.' },
      { label: 'LoRa ANT', edge: 'right', position: 0.12, connector: 'ipex',         notes: 'LoRa antenna IPEX.' },
      { label: 'GPS ANT',  edge: 'top',   position: 0.5,  connector: 'chip-antenna', notes: 'On-board GPS chip antenna — keep the top edge unobstructed for sky view.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Antenna first',
      body: 'Same rule as every LoRa board. The PA will burn out into an open IPEX.' },
    { tone: 'info', title: 'Indoor GPS will struggle',
      body: 'The chip antenna is fine outdoors with sky view but rarely locks indoors. First fix takes 30 s – 5 min outside.' },
    { tone: 'info', title: 'TFT vs OLED tradeoff',
      body: 'Colour TFT is nicer in shade, but washes out in direct sun. Pick Wireless Paper if you want sun-readable.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release. Enters ESP32-S3 ROM bootloader.',
};

// hwModel 49 — Heltec Wireless Paper (V3 + e-ink)
const HELTEC_WIRELESS_PAPER: DeviceReference = {
  hwModel: 49,
  physicalNotes: 'Heltec V3-family board with a 2.13″ e-ink display in place of the OLED. No GPS. Same USB-C + LoRa IPEX + battery JST layout.',
  layout: {
    shape: 'rounded',
    aspect: 1.6,
    features: [
      { kind: 'display-eink', label: '2.13″ e-ink', x: 0.08, y: 0.10, w: 0.84, h: 0.60 },
      { kind: 'mcu-area',     label: 'ESP32-S3',    x: 0.10, y: 0.74, w: 0.40, h: 0.18 },
      { kind: 'lora-module',  label: 'SX1262',      x: 0.55, y: 0.74, w: 0.35, h: 0.18 },
    ],
    buttons: [
      { label: 'USER', altLabel: 'PRG', x: 0.20, y: 0.96, actions: [
        { trigger: 'short press', effect: 'refresh / cycle pages on the e-ink' },
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.80, y: 0.96, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'bottom', position: 0.5,  connector: 'usb-c',     notes: 'Power, serial, LiPo charging.' },
      { label: 'BAT',   edge: 'left',   position: 0.88, connector: 'jst-1.25',  notes: 'LiPo. Check polarity on the silkscreen.' },
      { label: 'ANT',   edge: 'right',  position: 0.88, connector: 'ipex',      notes: 'LoRa antenna IPEX.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'E-ink refresh is slow',
      body: 'Each full refresh takes a few seconds. Meshtastic only redraws when content changes — do not expect a real-time clock.' },
    { tone: 'info', title: 'Display persists with no power',
      body: 'The last frame stays visible after shutdown. Useful for static signage / lab badges.' },
    { tone: 'warn', title: 'No GPS',
      body: 'Sister model Wireless Tracker has GPS; this one does not. Pair with a phone if you need positions.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release. Enters ESP32-S3 ROM bootloader.',
};

// hwModel 65 — TBEAM Supreme (modern T-Beam on ESP32-S3)
const TBEAM_SUPREME: DeviceReference = {
  hwModel: 65,
  physicalNotes: 'Modern T-Beam refresh on ESP32-S3. 18650 holder on the back, OLED + GPS up top, microSD slot, IMU. USB-C, slide power switch, two user buttons + reset.',
  layout: {
    shape: 'rect',
    aspect: 3.0,
    features: [
      { kind: 'display-oled', label: 'OLED 0.96″',         x: 0.03, y: 0.22, w: 0.20, h: 0.50 },
      { kind: 'gps-module',   label: 'GPS (u-blox)',       x: 0.26, y: 0.22, w: 0.18, h: 0.50 },
      { kind: 'mcu-area',     label: 'ESP32-S3',           x: 0.48, y: 0.30, w: 0.18, h: 0.35 },
      { kind: 'lora-module',  label: 'SX1262',             x: 0.70, y: 0.30, w: 0.18, h: 0.35 },
      { kind: 'battery-holder', label: '18650 holder (back side)', x: 0.10, y: 0.78, w: 0.80, h: 0.18 },
    ],
    buttons: [
      { label: 'PWR', x: 0.05, y: 0.04, actions: [
        { trigger: 'slide / short press', effect: 'main power on/off (cuts PMIC)' },
      ]},
      { label: 'USER1', x: 0.36, y: 0.04, actions: [
        { trigger: 'short press', effect: 'cycle OLED pages' },
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'USER2', x: 0.62, y: 0.04, actions: [
        { trigger: 'short press', effect: 'firmware-defined secondary action' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'left',  position: 0.50, connector: 'usb-c',    notes: 'Power, serial, LiPo charging through PMIC.' },
      { label: 'GPS ANT',  edge: 'top',   position: 0.30, connector: 'ipex',     notes: 'IPEX for the active GPS patch antenna.' },
      { label: 'LoRa ANT', edge: 'right', position: 0.50, connector: 'sma',      notes: 'External SMA-female on the LoRa side.' },
      { label: 'microSD',  edge: 'bottom', position: 0.40, connector: 'microsd', notes: 'Slot on the back. Used by some firmware for logs / replay.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Antenna before power',
      body: 'Standard rule — never power-on without the LoRa antenna seated on the SMA.' },
    { tone: 'warn', title: 'Power switch ≠ USER',
      body: 'PWR cuts the PMIC. If the screen is dark and pressing USER does nothing, check PWR first.' },
    { tone: 'info', title: 'IMU + GPS combo',
      body: 'Built-in IMU enables motion-wake firmware tricks (some community builds). Stock Meshtastic uses just the GPS.' },
  ],
  bootloaderInstructions:
    'Hold USER1 while pressing RST, then release. ESP32-S3 enters ROM bootloader.',
};

// hwModel 78 — Lilygo TLora T3-S3
const TLORA_T3_S3: DeviceReference = {
  hwModel: 78,
  physicalNotes: 'Modern T-Lora on ESP32-S3 with a 0.96″ OLED. Compact (~50×25 mm), USB-C on a short edge, LoRa IPEX on the other.',
  layout: {
    shape: 'rounded',
    aspect: 2.2,
    features: [
      { kind: 'display-oled', label: 'OLED 0.96″',  x: 0.05, y: 0.20, w: 0.42, h: 0.50 },
      { kind: 'mcu-area',     label: 'ESP32-S3',    x: 0.52, y: 0.30, w: 0.22, h: 0.30 },
      { kind: 'lora-module',  label: 'SX1262',      x: 0.78, y: 0.30, w: 0.18, h: 0.30 },
    ],
    buttons: [
      { label: 'BOOT', x: 0.42, y: 0.04, actions: [
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5,  connector: 'usb-c',    notes: 'Power + serial.' },
      { label: 'BAT',   edge: 'right', position: 0.85, connector: 'jst-1.25', notes: 'Single-cell LiPo. Check polarity.' },
      { label: 'ANT',   edge: 'right', position: 0.15, connector: 'ipex',     notes: 'LoRa antenna IPEX.' },
    ],
  },
  setupTips: [
    { tone: 'bad',  title: 'Antenna first',
      body: 'Hook up the stub antenna before applying power. No exceptions.' },
    { tone: 'info', title: 'Heltec V3 alternative',
      body: 'Same chip family and feature set as the Heltec V3, slightly cheaper and harder to find. Pick whichever your supplier stocks.' },
  ],
  bootloaderInstructions:
    'Hold BOOT while pressing RST, then release. Enters ESP32-S3 ROM bootloader.',
};

// hwModel 81 — Seeed XIAO ESP32-S3 (module + LoRa shield)
const XIAO_ESP32_S3: DeviceReference = {
  hwModel: 81,
  physicalNotes: 'Tiny (~21×17 mm) ESP32-S3 module typically paired with a LoRa expansion board. Single BOOT button + reset pad. Soldering an antenna pigtail is common.',
  layout: {
    shape: 'rect',
    aspect: 1.3,
    features: [
      { kind: 'mcu-area',    label: 'ESP32-S3 module',     x: 0.08, y: 0.10, w: 0.84, h: 0.45 },
      { kind: 'lora-module', label: 'LoRa expansion board', x: 0.08, y: 0.58, w: 0.84, h: 0.32 },
    ],
    buttons: [
      { label: 'BOOT', x: 0.20, y: 0.04, actions: [
        { trigger: 'hold during reset', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
      { label: 'RST', x: 0.80, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset (some boards expose this as a pad, not a button)' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5, connector: 'usb-c', notes: 'Power + serial on the XIAO module.' },
      { label: 'ANT',   edge: 'right', position: 0.7, connector: 'ipex',  notes: 'LoRa antenna IPEX on the expansion board. Some kits ship without an antenna pigtail — confirm before ordering.' },
    ],
  },
  setupTips: [
    { tone: 'warn', title: 'Variants matter',
      body: 'There are several XIAO+LoRa combinations (Wio-SX1262, SX1262 shield, LoRa-E5 shield). Confirm the exact bundle matches the Meshtastic firmware build you flash.' },
    { tone: 'info', title: 'Tiny form factor',
      body: 'Smallest practical Meshtastic build. Great for embedding into projects, less great if you want a complete out-of-box experience.' },
  ],
  bootloaderInstructions:
    'Hold BOOT, plug in USB (or press RST/pad if available). Releases into ESP32-S3 ROM bootloader.',
};

// hwModel 88 — XIAO nRF52 LoRa
const XIAO_NRF52_LORA: DeviceReference = {
  hwModel: 88,
  physicalNotes: 'Postage-stamp nRF52840 + LoRa combo. Uses the Adafruit nRF52 bootloader (1200-baud touch entry). USB-C on one short edge.',
  layout: {
    shape: 'rect',
    aspect: 1.4,
    features: [
      { kind: 'mcu-area',    label: 'nRF52840', x: 0.08, y: 0.20, w: 0.45, h: 0.60 },
      { kind: 'lora-module', label: 'SX1262',    x: 0.55, y: 0.20, w: 0.38, h: 0.60 },
    ],
    buttons: [
      { label: 'USER', x: 0.30, y: 0.04, actions: [
        { trigger: 'short press', effect: 'firmware-defined' },
      ]},
      { label: 'RST', x: 0.70, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
        { trigger: 'double-tap', effect: 'enter Adafruit nRF52 DFU bootloader' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5, connector: 'usb-c',        notes: 'Power, serial, 1200-baud DFU touch entry.' },
      { label: 'ANT',   edge: 'right', position: 0.5, connector: 'chip-antenna', notes: 'On-board LoRa chip antenna. No external option without modding.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Lowest idle current of any S3-class kit',
      body: 'nRF52 deep-sleep at this scale is excellent. Pair with a small LiPo for week-long uptime.' },
    { tone: 'warn', title: 'Chip antenna only',
      body: 'No external SMA option. Range is fine handheld; pick something else for a fixed mast install.' },
  ],
  bootloaderInstructions:
    'Double-tap RST quickly, or open USB at 1200 baud and close it (the Device Lab does this for you). Device reappears as a USB mass storage volume.',
};

// hwModel 69 — Heltec Mesh Node T114 (nRF52 with OLED)
const HELTEC_T114: DeviceReference = {
  hwModel: 69,
  physicalNotes: 'Compact nRF52 board with on-board 0.96″ OLED and JST LiPo connector. Low idle current makes it a competitor to the RAK system at lower cost / lower modularity.',
  layout: {
    shape: 'rounded',
    aspect: 2.0,
    features: [
      { kind: 'display-oled', label: 'OLED 0.96″', x: 0.06, y: 0.20, w: 0.42, h: 0.50 },
      { kind: 'mcu-area',     label: 'nRF52840',   x: 0.52, y: 0.30, w: 0.20, h: 0.30 },
      { kind: 'lora-module',  label: 'SX1262',     x: 0.76, y: 0.30, w: 0.20, h: 0.30 },
    ],
    buttons: [
      { label: 'USER', x: 0.42, y: 0.04, actions: [
        { trigger: 'short press', effect: 'wake / cycle pages' },
        { trigger: 'long press', effect: 'firmware-defined power off' },
      ]},
      { label: 'RST', x: 0.96, y: 0.04, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
        { trigger: 'double-tap', effect: 'enter Adafruit nRF52 DFU bootloader' },
      ]},
    ],
    ports: [
      { label: 'USB-C', edge: 'left',  position: 0.5,  connector: 'usb-c',    notes: 'Power, serial, 1200-baud DFU touch.' },
      { label: 'BAT',   edge: 'right', position: 0.85, connector: 'jst-1.25', notes: 'LiPo. Check polarity per silkscreen.' },
      { label: 'ANT',   edge: 'right', position: 0.15, connector: 'ipex',     notes: 'LoRa antenna IPEX.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Solar-friendly nRF52',
      body: 'With deep-sleep enabled, idle current is in the µA range. Good for low-power deployments without the RAK system overhead.' },
    { tone: 'bad', title: 'Antenna before power',
      body: 'Standard LoRa rule — antenna seated on IPEX before USB.' },
  ],
  bootloaderInstructions:
    'Double-tap RST, or open USB at 1200 baud and close it. Adafruit DFU comes up as USB mass storage.',
};

// hwModel 97 — Lilygo TLora Pager
const TLORA_PAGER: DeviceReference = {
  hwModel: 97,
  physicalNotes: 'Pager-style handheld: e-ink display, BlackBerry-style keyboard, integrated GPS, USB-C on the bottom. Designed to look and feel like a 90s pager.',
  layout: {
    shape: 'rounded',
    aspect: 1.5,
    features: [
      { kind: 'display-eink', label: 'e-ink display', x: 0.10, y: 0.06, w: 0.80, h: 0.45 },
      { kind: 'keyboard',     label: 'QWERTY keyboard', x: 0.05, y: 0.55, w: 0.90, h: 0.40 },
      { kind: 'gps-module',   label: 'GPS',             x: 0.85, y: 0.45, w: 0.10, h: 0.08 },
    ],
    buttons: [
      { label: 'PWR', x: 0.95, y: 0.05, actions: [
        { trigger: 'short press', effect: 'wake / refresh e-ink' },
        { trigger: 'long press 3 s', effect: 'power off' },
      ]},
      { label: 'USER', x: 0.05, y: 0.05, actions: [
        { trigger: 'short press', effect: 'cycle menu / pages' },
      ]},
      { label: 'RST', x: 0.05, y: 0.50, actions: [
        { trigger: 'short press', effect: 'hardware reset' },
        { trigger: 'hold during USER press', effect: 'enter ESP32-S3 ROM bootloader' },
      ]},
    ],
    ports: [
      { label: 'USB-C',    edge: 'bottom', position: 0.5,  connector: 'usb-c',        notes: 'Power, serial, charging.' },
      { label: 'LoRa ANT', edge: 'top',    position: 0.50, connector: 'ipex',         notes: 'Internal IPEX-routed LoRa antenna.' },
      { label: 'GPS ANT',  edge: 'top',    position: 0.75, connector: 'chip-antenna', notes: 'On-board GPS chip antenna.' },
    ],
  },
  setupTips: [
    { tone: 'info', title: 'Type-and-page workflow',
      body: 'Made for messaging. Compose with the keyboard, hit send, see the result on e-ink with the screen-saved-when-idle persistence.' },
    { tone: 'warn', title: 'Niche, support varies',
      body: 'Newer model — firmware compatibility and accessory availability still maturing as of 2025.' },
  ],
  bootloaderInstructions:
    'Hold USER while pressing RST, then release. Enters ESP32-S3 ROM bootloader.',
};

export const DEVICE_REFERENCE: Record<number, DeviceReference> = {
  4:   TBEAM,
  7:   T_ECHO,
  11:  RAK4631,
  39:  STATION_G2,
  43:  HELTEC_V3,
  44:  HELTEC_WSL_V3,
  48:  HELTEC_WIRELESS_TRACKER,
  49:  HELTEC_WIRELESS_PAPER,
  50:  T_DECK,
  51:  NANO_G2_ULTRA,
  65:  TBEAM_SUPREME,
  69:  HELTEC_T114,
  71:  T1000_E,
  78:  TLORA_T3_S3,
  81:  XIAO_ESP32_S3,
  88:  XIAO_NRF52_LORA,
  94:  HELTEC_MESH_POCKET,
  95:  SEEED_SOLAR_NODE,
  97:  TLORA_PAGER,
  106: T_DECK_PRO,
};

export function getDeviceReference(hwModel: number): DeviceReference | null {
  return DEVICE_REFERENCE[hwModel] ?? null;
}
