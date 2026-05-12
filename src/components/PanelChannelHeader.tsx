import React from 'react';
import { channelHash, channelHashHex, pskFingerprint, pskLabel } from '../channel-identity';

/**
 * Consistent "this panel is observing through THIS radio on THIS channel"
 * banner used across Nodes, Map, Telemetry, Sniffer, Traceroute, Delivery.
 *
 * Renders nothing when the active radio is not ready — most panels show
 * empty-state explainers in that case and don't need a redundant header.
 *
 * The label customizes the verb to fit the panel ("LISTENING ON",
 * "VIEWING FROM", "TRACING FROM", etc.) so users can scan the page and
 * immediately know what they're looking at, especially in multi-radio mode.
 */
export function PanelChannelHeader({ state, label = 'LISTENING ON' }: {
  state: ConnectionState;
  label?: string;
}) {
  if (state.status !== 'ready') return null;
  const primary = state.channels?.find((c) => c.index === 0);
  const hash = primary ? channelHash(primary.name || '', primary.psk ?? []) : null;
  const my = state.myInfo?.myNodeNum;

  return (
    <div className="panel-channel-id">
      <span className="panel-channel-id-label">{label}</span>
      {primary && (
        <>
          <span className="panel-channel-id-name">{primary.name || '(default)'}</span>
          <span className="panel-channel-id-meta">{pskLabel(primary.pskLength)}</span>
          {hash !== null && (
            <span
              className="panel-channel-id-meta"
              title="8-bit channel hash = xor(name) ^ xor(psk). Two radios on the same logical channel compute the same hash; receivers use it to pick a decryption key."
            >
              hash <strong style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{channelHashHex(hash)}</strong>
            </span>
          )}
          <span
            className="panel-channel-id-meta"
            title="First/last bytes of the actual PSK. Two radios with the same label but different fingerprints have different keys."
          >
            psk <span style={{ fontFamily: 'var(--mono)' }}>{pskFingerprint(primary.psk ?? [])}</span>
          </span>
        </>
      )}
      {state.loraConfig && (
        <span className="panel-channel-id-meta">
          {state.loraConfig.regionName} · {state.loraConfig.usePreset
            ? state.loraConfig.modemPresetName
            : `SF${state.loraConfig.spreadFactor}/${(state.loraConfig.bandwidth / 1000).toFixed(0)}k`}
        </span>
      )}
      {my && (
        <span className="panel-channel-id-meta" style={{ marginLeft: 'auto' }} title="The node number of the radio currently feeding this panel.">
          !{my.toString(16).padStart(8, '0')}
          {state.portPath && <> · {state.portPath.split('/').pop()}</>}
        </span>
      )}
    </div>
  );
}
