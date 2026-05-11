import React from 'react';
import type { Attribute, Concept, Instance } from './schema';
import { getInstance } from './registry';

export function ConceptInstanceView({ concept, instance }: { concept: Concept; instance: Instance }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>
        {String(instance.name ?? instance.ID)}
      </h2>
      <dl className="kv">
        {concept.Attributes.map((attr) => {
          const v = instance[attr.Slug];
          if (v === undefined || v === null || v === '') return null;
          if (attr.Slug === 'name') return null;
          return (
            <React.Fragment key={attr.Slug}>
              <dt>{attr.Name}</dt>
              <dd><AttributeValue attr={attr} value={v} /></dd>
            </React.Fragment>
          );
        })}
      </dl>
    </div>
  );
}

function AttributeValue({ attr, value }: { attr: Attribute; value: unknown }) {
  if (attr.Collection && Array.isArray(value)) {
    if (attr.Type === 'Reference' && attr.ReferenceConcept) {
      return (
        <span>
          {value.map((id, i) => (
            <React.Fragment key={String(id)}>
              {i > 0 && ', '}
              <ReferenceLink conceptSlug={attr.ReferenceConcept!} id={String(id)} />
            </React.Fragment>
          ))}
        </span>
      );
    }
    return <span>{value.map((v) => String(v)).join(', ')}</span>;
  }
  if (attr.Type === 'Reference' && attr.ReferenceConcept) {
    return <ReferenceLink conceptSlug={attr.ReferenceConcept} id={String(value)} />;
  }
  if (attr.Type === 'URL' && typeof value === 'string') {
    return <a href={value} target="_blank" rel="noreferrer">{value}</a>;
  }
  if (attr.Type === 'Boolean') {
    return <span>{value ? 'yes' : 'no'}</span>;
  }
  if (attr.Type === 'Text' && typeof value === 'string') {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>;
  }
  return <span>{String(value)}</span>;
}

function ReferenceLink({ conceptSlug, id }: { conceptSlug: string; id: string }) {
  const target = getInstance(conceptSlug, id);
  const label = target ? String(target.name ?? target.ID) : id;
  return <code style={{ color: 'var(--accent, #5cc8ff)' }}>{label}</code>;
}
