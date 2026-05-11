import React, { useMemo, useState } from 'react';
import { listConcepts, listInstances } from '../concepts/registry';
import { ConceptInstanceView } from '../concepts/ConceptInstanceView';
import type { Instance } from '../concepts/schema';

type Tab = 'browse' | 'search' | 'index';

export function ConceptsPanel() {
  const concepts = listConcepts();
  const [tab, setTab] = useState<Tab>('browse');

  return (
    <div className="page">
      <h1 className="page-title">Concepts</h1>
      <p className="page-sub">
        Every domain object in this app — protocols, modulations, antennas, layers — is a Concept with typed attributes. New protocols become new instances, not new code paths.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'browse' ? ' active' : '')} onClick={() => setTab('browse')}>
          Browse <span className="subnav-count">{concepts.length}</span>
        </button>
        <button className={'subnav-btn' + (tab === 'search' ? ' active' : '')} onClick={() => setTab('search')}>Search</button>
        <button className={'subnav-btn' + (tab === 'index' ? ' active' : '')} onClick={() => setTab('index')}>A-Z index</button>
      </div>

      {tab === 'browse' && <BrowseTab />}
      {tab === 'search' && <SearchTab />}
      {tab === 'index' && <IndexTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Browse — concept-type chooser + instance list + detail
// ─────────────────────────────────────────────────────────────────────

function BrowseTab() {
  const concepts = listConcepts();
  const [activeSlug, setActiveSlug] = useState(concepts[0]?.Slug ?? '');
  const concept = concepts.find((c) => c.Slug === activeSlug);
  const instances = concept ? listInstances(concept.Slug) : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? instances.find((i) => i.ID === selectedId) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {concepts.map((c) => (
          <button
            key={c.Slug}
            className={'subnav-btn' + (c.Slug === activeSlug ? ' active' : '')}
            onClick={() => { setActiveSlug(c.Slug); setSelectedId(null); }}
            style={{ padding: '4px 12px', fontSize: 12 }}
          >
            {c.Name} <span style={{ opacity: 0.6 }}>({listInstances(c.Slug).length})</span>
          </button>
        ))}
      </div>

      {concept && (
        <div className="layout-split-wide">
          <div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{concept.Name}</h2>
              <p style={{ color: 'var(--text-dim)', margin: '4px 0 12px' }}>{concept.Description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {instances.map((i) => (
                  <button
                    key={i.ID}
                    className={'ghost' + (selectedId === i.ID ? ' active' : '')}
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => setSelectedId(i.ID)}
                  >
                    {String(i.name ?? i.ID)}
                  </button>
                ))}
                {instances.length === 0 && (
                  <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>No instances yet.</p>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Schema</h3>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-faint)' }}>
                    <th style={{ padding: '4px 0' }}>Attribute</th>
                    <th>Type</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  {concept.Attributes.map((a) => (
                    <tr key={a.Slug} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
                      <td style={{ padding: '4px 8px 4px 0' }}>
                        {a.Name} <code style={{ color: 'var(--text-faint)' }}>{a.Slug}</code>
                      </td>
                      <td>
                        {a.Type}{a.Collection ? '[]' : ''}
                        {a.ReferenceConcept ? <> → <code>{a.ReferenceConcept}</code></> : null}
                      </td>
                      <td>{a.Required ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            {selected ? (
              <ConceptInstanceView concept={concept} instance={selected} />
            ) : (
              <div className="info-card">
                <p>Select an instance on the left to view its attributes.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Search — substring across every concept + every instance
// ─────────────────────────────────────────────────────────────────────

function SearchTab() {
  const concepts = listConcepts();
  const [q, setQ] = useState('');

  const allInstances = useMemo(() => {
    const out: Array<{ conceptSlug: string; conceptName: string; inst: Instance }> = [];
    for (const c of concepts) {
      for (const inst of listInstances(c.Slug)) {
        out.push({ conceptSlug: c.Slug, conceptName: c.Name, inst });
      }
    }
    return out;
  }, [concepts]);

  const hits = useMemo(() => {
    if (!q.trim()) return [];
    const needle = q.toLowerCase();
    const results: Array<{ conceptSlug: string; conceptName: string; inst: Instance; matchedIn: string }> = [];
    // Match concept names
    for (const c of concepts) {
      const haystack = `${c.Name} ${c.Slug} ${c.Description ?? ''}`.toLowerCase();
      if (haystack.includes(needle)) {
        results.push({ conceptSlug: c.Slug, conceptName: c.Name, inst: { ID: c.Slug, name: c.Name } as any, matchedIn: 'concept' });
      }
    }
    // Match instances
    for (const { conceptSlug, conceptName, inst } of allInstances) {
      const haystack = JSON.stringify(inst).toLowerCase();
      if (haystack.includes(needle)) {
        results.push({ conceptSlug, conceptName, inst, matchedIn: 'instance' });
      }
    }
    return results.slice(0, 200);
  }, [q, concepts, allInstances]);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <input
            className="text"
            placeholder="search concepts + instances · name, slug, description, attributes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 14 }}
            autoFocus
          />
          {!q.trim() && (
            <div className="empty">
              Type to search. We look across every concept and every instance — names, slugs, descriptions, and all attribute values.
            </div>
          )}
          {q.trim() && hits.length === 0 && (
            <div className="empty">No matches for <code>"{q}"</code>.</div>
          )}
          {hits.length > 0 && (
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Concept</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={`${h.conceptSlug}-${h.inst.ID}-${i}`}>
                    <td style={{ color: 'var(--accent)' }}>{highlight(String(h.inst.name ?? h.inst.ID), q)}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{h.conceptName}</td>
                    <td>
                      <span style={{
                        fontSize: 10.5,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: h.matchedIn === 'concept' ? 'rgba(255,209,102,0.15)' : 'rgba(120,180,255,0.12)',
                        color: h.matchedIn === 'concept' ? 'var(--warn)' : 'var(--accent)',
                        border: `1px solid ${h.matchedIn === 'concept' ? 'rgba(255,209,102,0.4)' : 'rgba(120,180,255,0.35)'}`,
                      }}>
                        {h.matchedIn === 'concept' ? 'concept' : 'instance'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hits.length === 200 && (
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
              Showing first 200 matches — narrow your search.
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What gets searched.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Concept names + slugs + descriptions. Instance names + IDs + every attribute value (serialised as JSON). The match is plain substring — case-insensitive, no fancy ranking.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Try searching for:</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            <li><code>SF12</code> — every modulation with that spread factor</li>
            <li><code>915</code> — every region on 915 MHz</li>
            <li><code>flood</code> — routing schemes that mention flooding</li>
            <li><code>yagi</code> — directional antennas</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(255,209,102,0.3)', color: 'var(--text)', padding: '0 2px' }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Index — A-Z list of every instance across every concept
// ─────────────────────────────────────────────────────────────────────

function IndexTab() {
  const concepts = listConcepts();
  const allInstances = useMemo(() => {
    const out: Array<{ conceptSlug: string; conceptName: string; inst: Instance; label: string }> = [];
    for (const c of concepts) {
      for (const inst of listInstances(c.Slug)) {
        out.push({
          conceptSlug: c.Slug,
          conceptName: c.Name,
          inst,
          label: String(inst.name ?? inst.ID),
        });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [concepts]);

  // Group by first letter
  const byLetter = useMemo(() => {
    const m = new Map<string, typeof allInstances>();
    for (const x of allInstances) {
      const letter = (x.label[0] ?? '?').toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(x);
    }
    return m;
  }, [allInstances]);

  const letters = Array.from(byLetter.keys()).sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Every concept instance, alphabetically</h2>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
              {allInstances.length} instance{allInstances.length === 1 ? '' : 's'} across {concepts.length} concepts
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
            {letters.map((L) => (
              <a key={L} href={`#az-${L}`} style={{
                fontFamily: 'var(--mono)', fontSize: 12, padding: '2px 7px',
                background: 'var(--bg-elev-2)', borderRadius: 4, color: 'var(--accent)', textDecoration: 'none',
              }}>{L}</a>
            ))}
          </div>
          {letters.map((L) => (
            <div key={L} id={`az-${L}`} style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{L}</h3>
              <table className="data" style={{ fontSize: 12 }}>
                <tbody>
                  {byLetter.get(L)!.map((x, i) => (
                    <tr key={`${x.conceptSlug}-${x.inst.ID}-${i}`}>
                      <td style={{ color: 'var(--accent)', width: '40%' }}>{x.label}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{x.conceptName}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>{String(x.inst.ID)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why an A-Z index exists.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            When you know <em>what</em> you're looking for but not <em>which concept</em> it belongs to, this is the fastest way in. "Where's LongFast defined? Where's the Heltec V3?" — both answered in one scan.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Concept counts.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
            {concepts.map((c) => (
              <li key={c.Slug}>
                <strong>{c.Name}</strong>: {listInstances(c.Slug).length} instance{listInstances(c.Slug).length === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
