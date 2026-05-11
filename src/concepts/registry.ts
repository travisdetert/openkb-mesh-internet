import type { Concept, Instance, ValidationError } from './schema';
import { validateInstance } from './schema';

import protocolConcept from './definitions/protocol.json';
import modulationConcept from './definitions/modulation.json';
import antennaConcept from './definitions/antenna.json';
import layerConcept from './definitions/layer.json';
import updateConcept from './definitions/update.json';
import updateTypeConcept from './definitions/update_type.json';
import topicConcept from './definitions/topic.json';
import frameConcept from './definitions/frame.json';
import environmentConcept from './definitions/environment.json';
import routingSchemeConcept from './definitions/routing_scheme.json';
import architectureConcept from './definitions/architecture.json';
import subscriptionConcept from './definitions/subscription.json';

// Vite glob import — every JSON in /instances/<slug>/*.json is auto-loaded.
const instanceModules = import.meta.glob('./instances/*/*.json', { eager: true });

const CONCEPTS: Concept[] = [
  protocolConcept as Concept,
  modulationConcept as Concept,
  antennaConcept as Concept,
  layerConcept as Concept,
  environmentConcept as Concept,
  routingSchemeConcept as Concept,
  updateTypeConcept as Concept,
  topicConcept as Concept,
  updateConcept as Concept,
  frameConcept as Concept,
  subscriptionConcept as Concept,
  architectureConcept as Concept,
];

const conceptBySlug = new Map<string, Concept>();
for (const c of CONCEPTS) conceptBySlug.set(c.Slug, c);

const instancesByConcept = new Map<string, Instance[]>();
for (const [path, mod] of Object.entries(instanceModules)) {
  // path like './instances/modulation/long-fast.json'
  const match = path.match(/\.\/instances\/([^/]+)\/[^/]+\.json$/);
  if (!match) continue;
  const conceptSlug = match[1];
  const data = (mod as { default: Instance }).default ?? (mod as Instance);
  const instance: Instance = { ...data, ConceptSlug: conceptSlug };
  if (!instancesByConcept.has(conceptSlug)) instancesByConcept.set(conceptSlug, []);
  instancesByConcept.get(conceptSlug)!.push(instance);
}

export function listConcepts(): Concept[] {
  return CONCEPTS.slice();
}

export function getConcept(slug: string): Concept | undefined {
  return conceptBySlug.get(slug);
}

export function listInstances(conceptSlug: string): Instance[] {
  return instancesByConcept.get(conceptSlug) ?? [];
}

export function getInstance(conceptSlug: string, id: string): Instance | undefined {
  return listInstances(conceptSlug).find((i) => i.ID === id);
}

export function validateAllInstances(): Record<string, ValidationError[]> {
  const out: Record<string, ValidationError[]> = {};
  for (const concept of CONCEPTS) {
    for (const instance of listInstances(concept.Slug)) {
      const errs = validateInstance(concept, instance);
      if (errs.length) out[`${concept.Slug}/${instance.ID}`] = errs;
    }
  }
  return out;
}
