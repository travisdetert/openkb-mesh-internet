import React, { useMemo, useState } from 'react';
import { DeviceDiagram } from '../DeviceDiagram';
import { getDeviceReference, CONNECTOR_LABELS, type DeviceReference, type SetupTip } from '../../lib/device-reference';

interface DeviceSpec {
  hwModel: number;
  name: string;
  vendor: string;
  chipFamily: 'ESP32' | 'ESP32-S3' | 'nRF52' | 'RP2040' | 'STM32' | 'Other';
  loraChip: 'SX1262' | 'SX1276' | 'SX1280' | 'LR1110' | 'Other';
  display: 'OLED-128x64' | 'OLED-128x32' | 'eink' | 'TFT' | 'none';
  battery: 'lipo' | 'aa' | 'usb-only' | 'integrated';
  gps: boolean;
  wifi: boolean;
  ble: boolean;
  maxTxDbm: number;
  stockAntennaDbi: number;
  approxPriceUsd: string;
  notes?: string;
  recommended?: string;
}

// Catalog of the most common Meshtastic-compatible hardware. hwModel numbers
// from the meshtastic HardwareModel enum.
const CATALOG: DeviceSpec[] = [
  // ── Classic ESP32 ──────────────────────────────────────────────────
  { hwModel: 1,  name: 'TLORA V2',            vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$20-30',  notes: 'Original TTGO LoRa board. Aging.' },
  { hwModel: 2,  name: 'TLORA V1',            vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$20-30',  notes: 'First-gen TTGO LoRa. Mostly obsolete.' },
  { hwModel: 3,  name: 'TLORA V2 1.6',        vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$20-30',  notes: 'Refreshed TTGO LoRa with USB-C.' },
  { hwModel: 4,  name: 'TBEAM',               vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 20, stockAntennaDbi: 2,   approxPriceUsd: '$40-50',  notes: 'The classic GPS-equipped Meshtastic board.', recommended: 'Iconic tracker-class board.' },
  { hwModel: 5,  name: 'HELTEC V2 (1)',       vendor: 'Heltec',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 20, stockAntennaDbi: 2,   approxPriceUsd: '$20-30',  notes: 'Common starter board.' },
  { hwModel: 6,  name: 'TBEAM 0.7',           vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 20, stockAntennaDbi: 2,   approxPriceUsd: '$40-50' },
  { hwModel: 8,  name: 'TLORA V1 1.3',        vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$20-25' },
  { hwModel: 9,  name: 'Heltec V1',           vendor: 'Heltec',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$20' },
  { hwModel: 10, name: 'LILYGO LORA RELAY',   vendor: 'Lilygo',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 17, stockAntennaDbi: 2, approxPriceUsd: '$25' },
  { hwModel: 21, name: 'M5Stack ATOM',        vendor: 'M5Stack',   chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'none',        battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 17, stockAntennaDbi: 2, approxPriceUsd: '$25-35', notes: 'Cube form factor with LoRa stack.' },
  { hwModel: 24, name: 'Heltec V2.1',         vendor: 'Heltec',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 20, stockAntennaDbi: 2,   approxPriceUsd: '$22-32' },
  { hwModel: 25, name: 'Heltec V2.1-1.6',     vendor: 'Heltec',    chipFamily: 'ESP32',    loraChip: 'SX1276', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 20, stockAntennaDbi: 2,   approxPriceUsd: '$22-32' },

  // ── nRF52 ──────────────────────────────────────────────────────────
  { hwModel: 7,  name: 'T-Echo',              vendor: 'Lilygo',    chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'eink',        battery: 'lipo',   gps: true,  wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$70-80',  notes: 'Low-power nRF52 + e-ink. Weeks on a charge.', recommended: 'Best long-runtime tracker.' },
  { hwModel: 11, name: 'RAK4631',             vendor: 'RAKwireless', chipFamily: 'nRF52',  loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 3,   approxPriceUsd: '$80-110', notes: 'Modular: GPS, sensors, OLED come as separate slot-in modules.', recommended: 'Most popular nRF52 board. Excellent for solar/battery deployments.' },
  { hwModel: 51, name: 'NANO G2 ULTRA',       vendor: 'B&Q',       chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 3,   approxPriceUsd: '$90-110', notes: 'High-end nRF52 build with GPS in compact form factor.', recommended: 'Great pocket tracker.' },
  { hwModel: 63, name: 'NRF52 Pro Micro DIY', vendor: 'DIY',       chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'none',        battery: 'lipo',   gps: false, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$15-25',  notes: 'Bare nRF52 + LoRa module. Maker-grade.' },
  { hwModel: 69, name: 'Heltec Mesh Node T114', vendor: 'Heltec',  chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$30-40',  notes: 'Compact nRF52-based starter, very low idle current.' },
  { hwModel: 70, name: 'WIO Tracker WM1110',  vendor: 'Seeed',     chipFamily: 'nRF52',    loraChip: 'LR1110', display: 'none',        battery: 'integrated', gps: true, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$50',     notes: 'LR1110 has built-in GNSS + WiFi-positioning.' },
  { hwModel: 72, name: 'RAK3172',             vendor: 'RAKwireless', chipFamily: 'STM32',  loraChip: 'SX1262', display: 'none',        battery: 'usb-only', gps: false, wifi: false, ble: false, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$20',     notes: 'STM32-based LoRa-only module.' },
  { hwModel: 88, name: 'XIAO nRF52 LoRa',     vendor: 'Seeed',     chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'none',        battery: 'lipo',   gps: false, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$15-25',  notes: 'Tiny postage-stamp form factor.' },
  { hwModel: 89, name: 'ThinkNode M1',        vendor: 'ThinkNode', chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 3,   approxPriceUsd: '$80-100' },
  { hwModel: 90, name: 'ThinkNode M2',        vendor: 'ThinkNode', chipFamily: 'nRF52',    loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 3,   approxPriceUsd: '$90-110' },

  // ── ESP32-S3 ───────────────────────────────────────────────────────
  { hwModel: 31, name: 'Station G1',          vendor: 'B&Q',       chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$50' },
  { hwModel: 39, name: 'Station G2',          vendor: 'B&Q',       chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$60-70', recommended: 'Solid headless router. Plug-in-and-go.' },
  { hwModel: 43, name: 'Heltec V3',           vendor: 'Heltec',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$25-35',  notes: 'Most popular Meshtastic starter today.', recommended: 'Recommended for first-time Meshtastic users.' },
  { hwModel: 44, name: 'Heltec WSL V3',       vendor: 'Heltec',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$15-20',  notes: 'Wireless-stick lite — no display. Cheap router.' },
  { hwModel: 48, name: 'Heltec Wireless Tracker', vendor: 'Heltec', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT', battery: 'lipo', gps: true, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$45-60', notes: 'Heltec V3 with built-in GPS + bigger color screen.' },
  { hwModel: 49, name: 'Heltec Wireless Paper', vendor: 'Heltec',  chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'eink',        battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$25-35',  notes: 'E-ink display version — readable in sun.' },
  { hwModel: 50, name: 'T-Deck',              vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT',         battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$80-100', notes: 'Handheld with full QWERTY keyboard and color screen.', recommended: 'Best dedicated keyboard messenger.' },
  { hwModel: 52, name: 'PicoMputer S3',       vendor: 'community', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT',         battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$60-80',  notes: 'DIY handheld with thumb keyboard.' },
  { hwModel: 53, name: 'Heltec HT62',         vendor: 'Heltec',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$15-20' },
  { hwModel: 54, name: 'EByte ESP32-S3',      vendor: 'EByte',     chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$20-30' },
  { hwModel: 56, name: 'Chatter 2',           vendor: 'community', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$30-40',  notes: 'Sleek handheld design.' },
  { hwModel: 66, name: 'Heltec Vision Master T190', vendor: 'Heltec', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT', battery: 'lipo', gps: true, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$70-90', notes: '1.9" color display with GPS.' },
  { hwModel: 67, name: 'Heltec Vision Master E213', vendor: 'Heltec', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'eink', battery: 'lipo', gps: true, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$60-80', notes: '2.13" e-ink display with GPS.' },
  { hwModel: 68, name: 'Heltec Vision Master E290', vendor: 'Heltec', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'eink', battery: 'lipo', gps: true, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$80-100', notes: '2.9" e-ink display with GPS. Larger info display.' },
  { hwModel: 65, name: 'TBEAM Supreme',       vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$55-65', notes: 'Modern T-Beam refresh on S3.' },
  { hwModel: 78, name: 'TLORA T3-S3',         vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$25-35' },
  { hwModel: 81, name: 'XIAO ESP32-S3',       vendor: 'Seeed',     chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$15-20',  notes: 'Tiny S3 module + LoRa shield. Tiny footprint.' },
  { hwModel: 83, name: 'TLORA C6',            vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$20-30',  notes: 'Newer C6 variant with WiFi 6.' },
  { hwModel: 92, name: 'Heltec Sensor Hub',   vendor: 'Heltec',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2,   approxPriceUsd: '$40-50',  notes: 'Heltec + environment-sensor breakouts.' },
  { hwModel: 94, name: 'Heltec Mesh Pocket',  vendor: 'Heltec',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT',         battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$50-70', notes: 'Pocketable handheld with color display.', recommended: 'Decent all-rounder for backpacking.' },
  { hwModel: 95, name: 'Seeed Solar Node',    vendor: 'Seeed',     chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$70-90', notes: 'Built-in solar charging — set-and-forget remote router.', recommended: 'For permanent off-grid relay deployments.' },
  { hwModel: 97, name: 'TLORA Pager',         vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'eink',        battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$60-80',  notes: 'Pager-style handheld with e-ink + keyboard.' },

  // ── 2.4 GHz LoRa (uncommon) ────────────────────────────────────────
  { hwModel: 45, name: 'BetaFPV 2.4G',        vendor: 'BetaFPV',   chipFamily: 'ESP32-S3', loraChip: 'SX1280', display: 'none',        battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 13, stockAntennaDbi: 2, approxPriceUsd: '$30', notes: '2.4 GHz LoRa — short range vs sub-GHz, but more global compatibility.' },
  { hwModel: 64, name: 'RadioMaster 900 Bandit Nano', vendor: 'RadioMaster', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none', battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 20, stockAntennaDbi: 2, approxPriceUsd: '$45', notes: 'Originally an RC transmitter module — reflashed for Meshtastic.' },
  { hwModel: 74, name: 'RadioMaster 900 Bandit', vendor: 'RadioMaster', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none', battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 27, stockAntennaDbi: 3, approxPriceUsd: '$60', notes: 'High-power RC transmitter variant.' },

  // ── RP2040 ─────────────────────────────────────────────────────────
  { hwModel: 46, name: 'RP2040 LoRa',         vendor: 'various',   chipFamily: 'RP2040',   loraChip: 'SX1262', display: 'OLED-128x64', battery: 'lipo',   gps: false, wifi: false, ble: false, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$15-25', notes: 'No wireless host comms — USB only.' },
  { hwModel: 47, name: 'Raspberry Pi Pico',   vendor: 'Raspberry Pi', chipFamily: 'RP2040', loraChip: 'SX1262', display: 'none',     battery: 'usb-only', gps: false, wifi: false, ble: false, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$10-15', notes: 'Pico + LoRa shield. Cheapest gateway.' },
  { hwModel: 76, name: 'RP2040 Feather RFM95', vendor: 'Adafruit', chipFamily: 'RP2040',   loraChip: 'SX1276', display: 'none',       battery: 'lipo',   gps: false, wifi: false, ble: false, maxTxDbm: 17, stockAntennaDbi: 2,   approxPriceUsd: '$30-40' },
  { hwModel: 79, name: 'Raspberry Pi Pico 2', vendor: 'Raspberry Pi', chipFamily: 'RP2040', loraChip: 'SX1262', display: 'none',     battery: 'usb-only', gps: false, wifi: false, ble: false, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$10-15', notes: 'Newer RP2350 variant.' },

  // ── Special / handheld ─────────────────────────────────────────────
  { hwModel: 71, name: 'Tracker T1000-E',     vendor: 'Seeed',     chipFamily: 'nRF52',    loraChip: 'LR1110', display: 'eink',        battery: 'integrated', gps: true, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$110-130', notes: 'Compact tracker with e-ink + GNSS + sensors.', recommended: 'Top-tier tracker for hiking/SAR.' },
  { hwModel: 80, name: 'M5Stack CoreS3',      vendor: 'M5Stack',   chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT',         battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$50-70', notes: 'Cube handheld with color display + buttons.' },
  { hwModel: 91, name: 'T-ETH Elite',         vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$60-80', notes: 'Has wired Ethernet — useful as a fixed gateway.' },
  { hwModel: 96, name: 'Nomad Station G1',    vendor: 'community', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'none',        battery: 'integrated', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$45-60' },
  { hwModel: 99, name: 'Wio WM1110',          vendor: 'Seeed',     chipFamily: 'nRF52',    loraChip: 'LR1110', display: 'none',        battery: 'integrated', gps: true, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$30' },
  { hwModel: 100,name: 'RAK2560',             vendor: 'RAKwireless', chipFamily: 'nRF52',  loraChip: 'SX1262', display: 'none',        battery: 'integrated', gps: false, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 3, approxPriceUsd: '$60-80', notes: 'Compact field router enclosure.' },
  { hwModel: 102, name:'Heltec Wireless Bridge', vendor: 'Heltec', chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'OLED-128x64', battery: 'usb-only', gps: false, wifi: true, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$30-40', notes: 'Designed as WiFi/Eth ↔ LoRa bridge.' },
  { hwModel: 103, name:'Seeed Wio Tracker L1', vendor: 'Seeed',    chipFamily: 'nRF52',    loraChip: 'LR1110', display: 'none',        battery: 'integrated', gps: true, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$80-100' },
  { hwModel: 104, name:'Seeed Wio Tracker L1 EInk', vendor: 'Seeed', chipFamily: 'nRF52', loraChip: 'LR1110', display: 'eink', battery: 'integrated', gps: true, wifi: false, ble: true, maxTxDbm: 22, stockAntennaDbi: 2, approxPriceUsd: '$100-120' },
  { hwModel: 106, name:'T-Deck Pro',          vendor: 'Lilygo',    chipFamily: 'ESP32-S3', loraChip: 'SX1262', display: 'TFT',         battery: 'lipo',   gps: true,  wifi: true,  ble: true, maxTxDbm: 22, stockAntennaDbi: 2.5, approxPriceUsd: '$100-130', notes: 'T-Deck with GPS + better battery + IMU.', recommended: 'Top-tier handheld for active field use.' },
];

interface Props {
  nodes: NodeRecord[];
}

export function DeviceDatabasePanel({ nodes }: Props) {
  const [search, setSearch] = useState('');
  const [filterChip, setFilterChip] = useState<string>('all');
  const [filterFeature, setFilterFeature] = useState<'all' | 'recommended' | 'gps' | 'wifi' | 'screen' | 'in-mesh'>('all');
  const [selectedHw, setSelectedHw] = useState<number | null>(null);

  // Count how many of each model are in the user's nodeDB.
  const meshCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of nodes) {
      m.set(n.hwModel, (m.get(n.hwModel) ?? 0) + 1);
    }
    return m;
  }, [nodes]);

  const filtered = useMemo(() => {
    return CATALOG.filter((d) => {
      if (filterChip !== 'all' && d.chipFamily !== filterChip) return false;
      if (filterFeature === 'recommended' && !d.recommended) return false;
      if (filterFeature === 'gps' && !d.gps) return false;
      if (filterFeature === 'wifi' && !d.wifi) return false;
      if (filterFeature === 'screen' && d.display === 'none') return false;
      if (filterFeature === 'in-mesh' && !meshCounts.has(d.hwModel)) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = [d.name, d.vendor, d.chipFamily, d.loraChip, d.notes ?? ''].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // In-mesh first, then alphabetical
      const aIn = meshCounts.has(a.hwModel) ? 1 : 0;
      const bIn = meshCounts.has(b.hwModel) ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;
      return a.name.localeCompare(b.name);
    });
  }, [filterChip, filterFeature, search, meshCounts]);

  const active = selectedHw != null ? CATALOG.find((d) => d.hwModel === selectedHw) : null;

  // Detect unknown hwModels in the user's mesh that we don't catalog yet.
  const unknownInMesh = useMemo(() => {
    const known = new Set(CATALOG.map((c) => c.hwModel));
    const unknown = new Map<number, number>();
    for (const n of nodes) {
      if (n.hwModel !== 0 && !known.has(n.hwModel)) {
        unknown.set(n.hwModel, (unknown.get(n.hwModel) ?? 0) + 1);
      }
    }
    return unknown;
  }, [nodes]);

  return (
    <div className="page">
      <h1 className="page-title">Device DB</h1>
      <p className="page-sub">
        Catalog of Meshtastic-compatible hardware. Specs, recommended uses, stock antenna gain. Models we recognize in your nodeDB are highlighted so you can see at a glance what's actually on the air around you.
      </p>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="text"
            placeholder="search name / vendor / chip / notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <select className="text" value={filterChip} onChange={(e) => setFilterChip(e.target.value)} style={{ width: 160 }}>
            <option value="all">All chip families</option>
            <option value="ESP32">ESP32</option>
            <option value="ESP32-S3">ESP32-S3</option>
            <option value="nRF52">nRF52</option>
            <option value="RP2040">RP2040</option>
          </select>
          <select className="text" value={filterFeature} onChange={(e) => setFilterFeature(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">Any features</option>
            <option value="recommended">★ Recommended</option>
            <option value="gps">Has GPS</option>
            <option value="wifi">Has WiFi</option>
            <option value="screen">Has screen</option>
            <option value="in-mesh">In your nodeDB</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {filtered.length} of {CATALOG.length} models
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 18 }}>No models match these filters.</div>
          ) : (
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Chip</th>
                  <th>LoRa</th>
                  <th>GPS · WiFi · BT</th>
                  <th>Screen</th>
                  <th>Max TX</th>
                  <th>In mesh</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const count = meshCounts.get(d.hwModel) ?? 0;
                  const selected = selectedHw === d.hwModel;
                  return (
                    <tr
                      key={d.hwModel}
                      onClick={() => setSelectedHw(d.hwModel)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? 'var(--bg-elev-2)' : count > 0 ? 'rgba(102,211,154,0.04)' : undefined,
                      }}
                    >
                      <td>
                        <div style={{ color: 'var(--accent)' }}>{d.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{d.vendor}{d.recommended && <span style={{ marginLeft: 6, color: 'var(--good)' }}>★ recommended</span>}</div>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.chipFamily}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.loraChip}</td>
                      <td style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                        {d.gps ? '✓' : '–'} · {d.wifi ? '✓' : '–'} · {d.ble ? '✓' : '–'}
                      </td>
                      <td style={{ fontSize: 11 }}>{d.display === 'none' ? '—' : d.display}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{d.maxTxDbm} dBm</td>
                      <td>
                        {count > 0 ? (
                          <span style={{
                            background: 'rgba(102,211,154,0.15)', color: 'var(--good)',
                            border: '1px solid rgba(102,211,154,0.4)',
                            padding: '1px 8px', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 11,
                          }}>{count}</span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div>
          {active ? (
            <DeviceDetail device={active} count={meshCounts.get(active.hwModel) ?? 0} />
          ) : (
            <div className="info-card">
              <p style={{ margin: 0 }}><strong>How to read this catalog.</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
                Models highlighted with a green count are present in your mesh right now. Pick one to see full specs, recommended use cases, and how it compares to alternatives. Hardware-model numbers come from the Meshtastic <code>HardwareModel</code> protobuf enum.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Below the split-wide row so they don't share a column with the sticky
       *  detail card — otherwise they slide up behind it on scroll. */}
      {unknownInMesh.size > 0 && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 14 }}>
          <p style={{ margin: 0 }}><strong>Unknown models in your mesh.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            {Array.from(unknownInMesh.entries()).map(([hw, count], i) => (
              <span key={hw}>{i > 0 ? ', ' : ''}hwModel #{hw} ({count})</span>
            ))}
            {' '}— either newer hardware than this catalog covers, or zero (which means the radio never reported a hwModel for that node).
          </p>
        </div>
      )}

      <div className="info-card" style={{ marginTop: 10 }}>
        <p style={{ margin: 0 }}><strong>What this catalog is for.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
          When you click "Message" or "Traceroute" to another node, knowing what hardware they're on tells you what to expect — a TBEAM with GPS will broadcast position; a Heltec WSL with no display might be a permanently-deployed router; an nRF52 board with 22 dBm probably has serious uptime.
        </p>
      </div>
    </div>
  );
}

function DeviceDetail({ device, count }: { device: DeviceSpec; count: number }) {
  const ref = getDeviceReference(device.hwModel);
  return (
    <div className="card" style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)', zIndex: 1, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: 'var(--accent)' }}>{device.name}</h2>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
          {device.vendor} · hwModel #{device.hwModel}
        </div>
        {count > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--good)' }}>
            ● {count} in your mesh right now
          </div>
        )}
      </div>

      {ref && (
        <div style={{ margin: '10px 0 14px' }}>
          <DeviceDiagram layout={ref.layout} width={320} />
          <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', marginTop: 2, fontStyle: 'italic' }}>
            schematic — positions approximate
          </div>
        </div>
      )}

      <dl className="kv kv-tight">
        <dt>Chip family</dt><dd>{device.chipFamily}</dd>
        <dt>LoRa transceiver</dt><dd>{device.loraChip}</dd>
        <dt>Max TX power</dt><dd>{device.maxTxDbm} dBm</dd>
        <dt>Stock antenna</dt><dd>{device.stockAntennaDbi} dBi</dd>
        <dt>Display</dt><dd>{device.display}</dd>
        <dt>Battery</dt><dd>{device.battery}</dd>
        <dt>GPS</dt><dd>{device.gps ? 'yes' : 'no'}</dd>
        <dt>WiFi</dt><dd>{device.wifi ? 'yes' : 'no'}</dd>
        <dt>Bluetooth</dt><dd>{device.ble ? 'yes' : 'no'}</dd>
        <dt>Price (approx)</dt><dd>{device.approxPriceUsd}</dd>
      </dl>

      {device.notes && (
        <div className="info-card" style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{device.notes}</p>
        </div>
      )}
      {device.recommended && (
        <div className="info-card" style={{ marginTop: 8, borderLeftColor: 'var(--good)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}><strong>★ {device.recommended}</strong></p>
        </div>
      )}

      {ref && <DeviceReferenceTables reference={ref} />}

      <div className="info-card" style={{ marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12 }}><strong>Antenna upgrade math.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          Going from stock {device.stockAntennaDbi} dBi to a typical $30 5 dBi fiberglass omni = +{(5 - device.stockAntennaDbi).toFixed(1)} dB on TX and another +{(5 - device.stockAntennaDbi).toFixed(1)} dB on RX. That's {Math.pow(10, ((5 - device.stockAntennaDbi) * 2) / 20).toFixed(1)}× the range — for the same battery and TX power.
        </p>
      </div>
    </div>
  );
}

function DeviceReferenceTables({ reference }: { reference: DeviceReference }) {
  const ref = reference;
  return (
    <div style={{ marginTop: 14 }}>
      {ref.physicalNotes && (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px' }}>{ref.physicalNotes}</p>
      )}

      {/* Buttons */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Buttons
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ref.layout.buttons.map((b, i) => (
          <div key={i} style={{ border: '1px solid rgba(154,163,178,0.18)', borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
              {b.label}{b.altLabel && <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>({b.altLabel})</span>}
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
              {b.actions.map((a, j) => (
                <li key={j}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{a.trigger}</span>
                  {' — '}{a.effect}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Ports */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Ports
      </h3>
      <table className="data" style={{ fontSize: 12, width: '100%' }}>
        <thead>
          <tr><th>Label</th><th>Connector</th><th>Edge</th></tr>
        </thead>
        <tbody>
          {ref.layout.ports.map((p, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{p.label}</td>
              <td style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{CONNECTOR_LABELS[p.connector]}</td>
              <td style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.edge}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6 }}>
        {ref.layout.ports.filter((p) => p.notes).map((p, i) => (
          <div key={i} style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--accent)' }}>{p.label}</strong> — {p.notes}
          </div>
        ))}
      </div>

      {/* Setup tips */}
      {ref.setupTips.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
            First-time setup
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ref.setupTips.map((tip, i) => <SetupTipCard key={i} tip={tip} />)}
          </div>
        </>
      )}

      {/* Bootloader */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Enter bootloader / DFU
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>{ref.bootloaderInstructions}</p>
    </div>
  );
}

function SetupTipCard({ tip }: { tip: SetupTip }) {
  const tone = tip.tone ?? 'info';
  const borderColor = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';
  const icon = tone === 'bad' ? '⚠' : tone === 'warn' ? '!' : 'ℹ';
  return (
    <div style={{ borderLeft: `3px solid ${borderColor}`, paddingLeft: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: borderColor }}>
        <span style={{ marginRight: 6 }}>{icon}</span>{tip.title}
      </div>
      <p style={{ margin: '2px 0 0', color: 'var(--text-dim)' }}>{tip.body}</p>
    </div>
  );
}
