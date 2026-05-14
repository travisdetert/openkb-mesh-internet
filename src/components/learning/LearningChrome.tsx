import React from 'react';
import type { TabId } from '../TopNav';

/**
 * Small badge that sits under a learning panel's title and sub, telling the
 * reader at a glance whether the panel mines live mesh data or is offline
 * reference content. Keeps the eight learning panels visually consistent.
 */
export function LearningModeBadge({ mode }: { mode: 'live' | 'offline' | 'mixed' }) {
  const label = mode === 'live'
    ? 'Uses your mesh data'
    : mode === 'mixed'
      ? 'Mixes your mesh data with reference physics'
      : 'Works offline · reference content';
  return (
    <div className={`learn-mode-badge learn-mode-${mode}`}>
      <span className="learn-mode-dot" />
      <span>{label}</span>
    </div>
  );
}

export interface LearnLink { to: TabId; label: string; blurb: string }

/**
 * "See also" footer for every learning panel. Surfaces 2–4 related panels so
 * the user can hop between physics → measurements → mitigation → planning
 * without leaning on the sidebar.
 */
export function LearningSeeAlso({ links, go }: { links: LearnLink[]; go: (id: TabId) => void }) {
  if (links.length === 0) return null;
  return (
    <aside className="learn-see-also">
      <div className="learn-see-also-label">See also</div>
      <div className="learn-see-also-grid">
        {links.map((l) => (
          <button key={l.to} className="learn-see-also-link" onClick={() => go(l.to)}>
            <span className="learn-see-also-title">{l.label}</span>
            <span className="learn-see-also-blurb">{l.blurb}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
