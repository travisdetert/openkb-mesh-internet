// OpenKB Concept (EAV) schema. Mirrors the model in
// ~/Sites/openkb.cloud/Modules/Concept and ~/Sites/openkb-desktop/src/modules/concept.
// One Concept defines a type; Attributes are its typed fields; Instances conform.

export type AttributeType =
  | 'String'
  | 'Text'
  | 'Number'
  | 'Boolean'
  | 'Date'
  | 'Email'
  | 'URL'
  | 'JSON'
  | 'Reference'; // points at another concept by Slug

export interface Attribute {
  Name: string;
  Slug: string;
  Type: AttributeType;
  Description?: string;
  Label?: string;
  Icon?: string;
  Required?: boolean;
  Collection?: boolean;
  DefaultValue?: unknown;
  ReferenceConcept?: string; // when Type === 'Reference', the target Concept's Slug
}

export interface Concept {
  Name: string;
  Slug: string;
  Description?: string;
  Icon?: string;
  Active?: boolean;
  Category?: string;
  Attributes: Attribute[];
}

export interface Instance {
  ID: string;
  ConceptSlug: string;
  // Plus dynamic attribute values keyed by Attribute.Slug.
  [attributeSlug: string]: unknown;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateInstance(concept: Concept, instance: Instance): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const attr of concept.Attributes) {
    const v = instance[attr.Slug];
    const missing = v === undefined || v === null || v === '';
    if (attr.Required && missing) {
      errors.push({ field: attr.Slug, message: `${attr.Name} is required` });
      continue;
    }
    if (missing) continue;
    if (attr.Collection) {
      if (!Array.isArray(v)) {
        errors.push({ field: attr.Slug, message: `${attr.Name} must be an array` });
        continue;
      }
      for (const item of v) {
        const e = checkType(attr, item);
        if (e) { errors.push({ field: attr.Slug, message: e }); break; }
      }
    } else {
      const e = checkType(attr, v);
      if (e) errors.push({ field: attr.Slug, message: e });
    }
  }
  return errors;
}

function checkType(attr: Attribute, v: unknown): string | null {
  switch (attr.Type) {
    case 'String':
    case 'Text':
    case 'Email':
    case 'URL':
    case 'Reference':
      return typeof v === 'string' ? null : `${attr.Name} must be a string`;
    case 'Number':
      return typeof v === 'number' && !Number.isNaN(v) ? null : `${attr.Name} must be a number`;
    case 'Boolean':
      return typeof v === 'boolean' ? null : `${attr.Name} must be a boolean`;
    case 'Date':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v))
        ? null
        : `${attr.Name} must be an ISO date string`;
    case 'JSON':
      return typeof v === 'object' ? null : `${attr.Name} must be an object`;
  }
}
