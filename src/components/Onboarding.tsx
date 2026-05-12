import React, { useState } from 'react';
import type { TabId } from './TopNav';

/**
 * First-run / "show me around" guided tour. A modal overlay with a stepper.
 * Each step shows a headline, a paragraph of context, and an optional action
 * that jumps the user to a specific panel. The tour is gated by localStorage:
 * once finished or explicitly dismissed it doesn't auto-show again.
 *
 * Reachable manually any time via the "Show me around" button on the Home page.
 */

const STORAGE_KEY = 'openkb.onboarding.completed.v1';

export function hasCompletedOnboarding(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return true; }
}
function markCompleted(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
}

interface Props {
  go: (tab: TabId) => void;
  state: ConnectionState;
  onClose: () => void;
}

interface Step {
  id: string;
  title: string;
  body: React.ReactNode;
  /** Action button that does something on click (jump panel, etc.). */
  action?: { label: string; run: () => void };
  /** Hint shown next to the primary action button. */
  hint?: string;
}

export function Onboarding({ go, state, onClose }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const connected = state.status === 'ready';

  const steps: Step[] = [
    {
      id: 'welcome',
      title: 'OpenKB Mesh — a console for your Meshtastic radio',
      body: (
        <>
          <p>
            This app talks to your Meshtastic radio over USB and helps you see what's happening on the mesh — who's
            connected, what they're saying, how strong the signals are, and why things sometimes don't work.
          </p>
          <p>
            The tour is five steps and takes about a minute. You can skip any step, dismiss the tour entirely, or
            come back later from the Home page.
          </p>
        </>
      ),
    },
    {
      id: 'connect',
      title: 'Plug in a radio and connect',
      body: (
        <>
          <p>
            Connect your Meshtastic radio with a USB <em>data</em> cable (not just power). The app auto-detects every
            USB-serial chip family and shows likely candidates first in the picker.
          </p>
          <p style={{ color: connected ? 'var(--good)' : 'var(--text-dim)' }}>
            {connected
              ? `✓ You're already connected — current state: ${state.status}.`
              : 'When you click "Open Connect" below, the port picker shows up. Click your radio, hit Connect, and wait ~3-5 s for the handshake.'}
          </p>
        </>
      ),
      action: connected
        ? { label: 'See my connection', run: () => go('connect') }
        : { label: 'Open Connect', run: () => go('connect') },
    },
    {
      id: 'chat',
      title: 'Chat is the main hub',
      body: (
        <>
          <p>
            The big sidebar entry between status and Setup is <strong>Chat</strong>. That's where you'll spend most
            of your time: per-channel conversations and DMs, with delivery acks, replies, attachments, voice, and a
            live channel-identity readout so you can verify you're on the right mesh.
          </p>
          <p>
            Type a slash-command like <code>/help</code> in the compose box to see what shortcuts are available. The
            Help tab inside Chat documents everything in detail.
          </p>
        </>
      ),
      action: { label: 'Open Chat', run: () => go('chat') },
    },
    {
      id: 'troubleshoot',
      title: 'When something is wrong',
      body: (
        <>
          <p>
            The <strong>Troubleshoot</strong> sidebar group is where to go when packets aren't crossing or messages
            aren't arriving. Top-down diagnostic flow:
          </p>
          <ul style={{ margin: '6px 0', paddingLeft: 20, color: 'var(--text-dim)' }}>
            <li><strong>Mesh Health</strong> — overall audit, flags problems</li>
            <li><strong>Compare Radios</strong> — config mismatches between two radios</li>
            <li><strong>Link Test</strong> — verify packets are actually crossing on RF</li>
            <li><strong>Delivery, Traceroute, Sniffer</strong> — drill deeper if needed</li>
          </ul>
          <p>
            Each one tells you what to do next, not just what's wrong.
          </p>
        </>
      ),
      action: { label: 'See Mesh Health', run: () => go('health') },
    },
    {
      id: 'learn',
      title: "Going deeper",
      body: (
        <>
          <p>
            The <strong>Learn</strong> sidebar group is offline reading — Link Budget, RSSI vs Distance, Coverage,
            Antennas, LoRa CSS, Mesh Routing. They work without a radio connected and use your real data when
            available.
          </p>
          <p>
            That's it. Close this and start playing. You can re-open the tour any time from the Home page.
          </p>
        </>
      ),
      action: { label: 'Open Home', run: () => go('home') },
    },
  ];

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  const isFirst = stepIdx === 0;

  const next = () => {
    if (isLast) {
      markCompleted();
      onClose();
    } else {
      setStepIdx((i) => i + 1);
    }
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));
  const skip = () => { markCompleted(); onClose(); };

  return (
    <div className="onboarding-backdrop" onClick={skip} role="presentation">
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="onboarding-progress">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={'onboarding-dot' + (i === stepIdx ? ' active' : '') + (i < stepIdx ? ' done' : '')}
              onClick={() => setStepIdx(i)}
              role="button"
              tabIndex={0}
              title={s.title}
            />
          ))}
          <button className="onboarding-skip" onClick={skip} title="Skip the tour — you can resume from the Home page later">Skip</button>
        </div>

        <h2 className="onboarding-title">{step.title}</h2>
        <div className="onboarding-body">{step.body}</div>

        <div className="onboarding-actions">
          {!isFirst && <button className="ghost" onClick={back}>← Back</button>}
          <div style={{ flex: 1 }} />
          {step.action && (
            <button className="ghost" onClick={() => { step.action!.run(); next(); }}>
              {step.action.label}
            </button>
          )}
          <button className="primary" onClick={next}>
            {isLast ? 'Done' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
