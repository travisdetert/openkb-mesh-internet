// Shared sub-tab strip. Every panel that wanted `Live / Data / Settings`-style
// tabs hand-rolled the same .subnav / .subnav-btn / .subnav-count markup. This
// renders that exact DOM (so the existing CSS applies unchanged) from a tab
// list, with an optional count badge per tab.
import React from 'react';

export interface SubnavItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  /** Optional count badge rendered after the label (omitted when undefined). */
  count?: number;
}

interface Props<K extends string> {
  items: ReadonlyArray<SubnavItem<K>>;
  active: K;
  onChange: (key: K) => void;
  /** Extra nodes rendered at the right end of the strip (e.g. an export button). */
  trailing?: React.ReactNode;
}

export function Subnav<K extends string>({ items, active, onChange, trailing }: Props<K>) {
  return (
    <div className="subnav">
      {items.map((it) => (
        <button
          key={it.key}
          className={'subnav-btn' + (active === it.key ? ' active' : '')}
          onClick={() => onChange(it.key)}
        >
          {it.label}
          {it.count !== undefined && it.count > 0 && (
            <span className="subnav-count">{it.count}</span>
          )}
        </button>
      ))}
      {trailing}
    </div>
  );
}
