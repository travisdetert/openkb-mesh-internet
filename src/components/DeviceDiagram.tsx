import React from 'react';
import type { DeviceLayout, DeviceButton, DevicePort, InternalFeature } from '../lib/device-reference';

/**
 * Schematic SVG diagram of a Meshtastic device. Renders:
 *   - board outline (rounded / enclosure / card / stick shapes)
 *   - internal features as labeled rectangles
 *   - buttons as filled circles with adjacent labels
 *   - ports as small labeled rectangles on the appropriate edge
 *
 * Positions in the layout are fractions (0..1) of the board area. We
 * leave a margin around the board for off-board callout labels.
 *
 * This is deliberately stylized — not a photo. The aim is to teach a
 * new user "where the USER button is roughly + what each port does",
 * not to substitute for the datasheet.
 */
export function DeviceDiagram({ layout, width = 320 }: { layout: DeviceLayout; width?: number }) {
  // Pick a viewBox that fits the board aspect plus callout margins.
  const margin = 30; // viewBox units reserved on every edge for labels
  const boardW = 320;
  const boardH = boardW / layout.aspect;
  const vbW = boardW + margin * 2;
  const vbH = boardH + margin * 2;
  const height = (width / vbW) * vbH;

  // Helper: convert layout-space fractions (0..1) to viewBox pixels.
  const px = (xFrac: number) => margin + xFrac * boardW;
  const py = (yFrac: number) => margin + yFrac * boardH;

  const boardR = layout.shape === 'rect' ? 4 : layout.shape === 'card' ? 22 : layout.shape === 'stick' ? 12 : 14;
  const boardFill = layout.shape === 'enclosure' ? 'rgba(99,114,138,0.18)' : 'rgba(92,200,255,0.06)';
  const boardStroke = layout.shape === 'enclosure' ? 'rgba(99,114,138,0.55)' : 'rgba(92,200,255,0.45)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${vbW} ${vbH}`} style={{ display: 'block', maxWidth: '100%' }}>
      {/* Board outline */}
      <rect
        x={margin}
        y={margin}
        width={boardW}
        height={boardH}
        rx={boardR}
        ry={boardR}
        fill={boardFill}
        stroke={boardStroke}
        strokeWidth={1.2}
      />

      {/* Internal features */}
      {layout.features.map((f, i) => (
        <FeatureRect key={`f${i}`} feature={f} px={px} py={py} boardW={boardW} boardH={boardH} />
      ))}

      {/* Ports (drawn on edges, label outside the board) */}
      {layout.ports.map((p, i) => (
        <PortMark key={`p${i}`} port={p} margin={margin} boardW={boardW} boardH={boardH} />
      ))}

      {/* Buttons (drawn on top so they sit above the board outline) */}
      {layout.buttons.map((b, i) => (
        <ButtonMark key={`b${i}`} button={b} px={px} py={py} margin={margin} boardH={boardH} />
      ))}
    </svg>
  );
}

function FeatureRect({
  feature, px, py, boardW, boardH,
}: { feature: InternalFeature; px: (x: number) => number; py: (y: number) => number; boardW: number; boardH: number }) {
  const x = px(feature.x);
  const y = py(feature.y);
  const w = feature.w * boardW;
  const h = feature.h * boardH;

  const style = featureStyle(feature.kind);

  // For very small features (trackball, GPS chip antenna spot) we render
  // a different visual — small filled dot. Otherwise: labeled rectangle.
  const isDot = w < 18 || h < 18;
  if (isDot) {
    return (
      <g>
        <circle cx={x + w / 2} cy={y + h / 2} r={Math.max(3, Math.min(w, h) / 2)} fill={style.fill} stroke={style.stroke} strokeWidth={0.8} />
        <text x={x + w / 2} y={y + h + 9} fontSize={8} textAnchor="middle" fill="rgba(230,232,238,0.6)">
          {feature.label}
        </text>
      </g>
    );
  }

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} ry={3} fill={style.fill} stroke={style.stroke} strokeWidth={0.8} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        fontSize={Math.min(11, h / 3)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={style.text}
      >
        {feature.label}
      </text>
    </g>
  );
}

function featureStyle(kind: InternalFeature['kind']): { fill: string; stroke: string; text: string } {
  switch (kind) {
    case 'display-oled':
    case 'display-tft':
      return { fill: 'rgba(92,200,255,0.18)',  stroke: 'rgba(92,200,255,0.55)',  text: 'rgba(230,232,238,0.92)' };
    case 'display-eink':
      return { fill: 'rgba(230,232,238,0.10)', stroke: 'rgba(230,232,238,0.40)', text: 'rgba(230,232,238,0.90)' };
    case 'gps-module':
      return { fill: 'rgba(102,211,154,0.18)', stroke: 'rgba(102,211,154,0.55)', text: 'rgba(230,232,238,0.92)' };
    case 'battery-holder':
    case 'battery-internal':
      return { fill: 'rgba(255,209,102,0.14)', stroke: 'rgba(255,209,102,0.50)', text: 'rgba(255,209,102,0.92)' };
    case 'keyboard':
      return { fill: 'rgba(230,232,238,0.06)', stroke: 'rgba(230,232,238,0.30)', text: 'rgba(230,232,238,0.85)' };
    case 'trackball':
      return { fill: 'rgba(92,200,255,0.30)',  stroke: 'rgba(92,200,255,0.70)',  text: 'rgba(230,232,238,0.85)' };
    case 'solar-panel':
      return { fill: 'rgba(255,184,107,0.18)', stroke: 'rgba(255,184,107,0.55)', text: 'rgba(255,184,107,0.92)' };
    case 'wisblock-slot':
      return { fill: 'rgba(154,163,178,0.10)', stroke: 'rgba(154,163,178,0.45)', text: 'rgba(230,232,238,0.80)' };
    case 'enclosure-label':
      return { fill: 'rgba(99,114,138,0.10)',  stroke: 'rgba(99,114,138,0.30)',  text: 'rgba(230,232,238,0.70)' };
    case 'lora-module':
    case 'mcu-area':
    default:
      return { fill: 'rgba(154,163,178,0.10)', stroke: 'rgba(154,163,178,0.45)', text: 'rgba(230,232,238,0.80)' };
  }
}

function ButtonMark({
  button, px, py, margin, boardH,
}: { button: DeviceButton; px: (x: number) => number; py: (y: number) => number; margin: number; boardH: number }) {
  const cx = px(button.x);
  const cy = py(button.y);
  const r = 5;
  // Decide label placement: outside the nearest edge.
  const top = button.y < 0.2;
  const bottom = button.y > 0.8;
  const labelY = top ? cy - r - 6 : bottom ? cy + r + 12 : cy + 3;
  const labelX = cx;
  const label = button.altLabel ? `${button.label} (${button.altLabel})` : button.label;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="rgba(92,200,255,0.85)" stroke="rgba(92,200,255,1)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={r - 2} fill="rgba(15,17,21,0.6)" />
      <text
        x={labelX}
        y={labelY}
        fontSize={9.5}
        fontWeight={600}
        textAnchor="middle"
        fill="rgba(92,200,255,0.95)"
      >
        {label}
      </text>
    </g>
  );
}

function PortMark({
  port, margin, boardW, boardH,
}: { port: DevicePort; margin: number; boardW: number; boardH: number }) {
  // Port is rendered as a small notched rectangle straddling the board
  // edge, with the label placed outward.
  const len = 22;
  const thick = 8;
  const offsetIn = 2; // overlap into the board so the notch reads as "embedded"
  const offsetOut = 6; // how far the port pokes outside the board

  let x = 0, y = 0, w = len, h = thick;
  let labelX = 0, labelY = 0;
  let labelAnchor: 'start' | 'middle' | 'end' = 'middle';

  switch (port.edge) {
    case 'top': {
      const cx = margin + port.position * boardW;
      x = cx - len / 2;
      y = margin - offsetOut;
      w = len; h = thick + offsetOut;
      labelX = cx;
      labelY = y - 4;
      break;
    }
    case 'bottom': {
      const cx = margin + port.position * boardW;
      x = cx - len / 2;
      y = margin + boardH - offsetIn;
      w = len; h = thick + offsetOut;
      labelX = cx;
      labelY = y + h + 11;
      break;
    }
    case 'left': {
      const cy = margin + port.position * boardH;
      x = margin - offsetOut;
      y = cy - len / 2;
      w = thick + offsetOut; h = len;
      labelX = x - 4;
      labelY = cy + 3;
      labelAnchor = 'end';
      break;
    }
    case 'right': {
      const cy = margin + port.position * boardH;
      x = margin + boardW - offsetIn;
      y = cy - len / 2;
      w = thick + offsetOut; h = len;
      labelX = x + w + 4;
      labelY = cy + 3;
      labelAnchor = 'start';
      break;
    }
  }

  const { fill, stroke } = portStyle(port.connector);

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.5} ry={1.5} fill={fill} stroke={stroke} strokeWidth={1} />
      <text
        x={labelX}
        y={labelY}
        fontSize={9.5}
        fontWeight={600}
        textAnchor={labelAnchor}
        fill="rgba(230,232,238,0.85)"
      >
        {port.label}
      </text>
    </g>
  );
}

function portStyle(c: DevicePort['connector']): { fill: string; stroke: string } {
  switch (c) {
    case 'usb-c':
    case 'micro-usb':
      return { fill: 'rgba(230,232,238,0.18)', stroke: 'rgba(230,232,238,0.55)' };
    case 'sma':
    case 'rp-sma':
    case 'ipex':
    case 'ufl':
    case 'chip-antenna':
      return { fill: 'rgba(255,184,107,0.20)', stroke: 'rgba(255,184,107,0.60)' };
    case 'jst-1.25':
    case 'jst-2.0':
    case 'solar-jst':
      return { fill: 'rgba(255,209,102,0.20)', stroke: 'rgba(255,209,102,0.60)' };
    case 'ethernet':
      return { fill: 'rgba(102,211,154,0.20)', stroke: 'rgba(102,211,154,0.60)' };
    case 'microsd':
      return { fill: 'rgba(154,163,178,0.20)', stroke: 'rgba(154,163,178,0.60)' };
    default:
      return { fill: 'rgba(154,163,178,0.20)', stroke: 'rgba(154,163,178,0.60)' };
  }
}
