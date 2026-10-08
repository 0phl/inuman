import { z } from 'zod';

/** The slice of JSON Schema that `z.toJSONSchema(rulesSchema, { io: 'input' })` produces for rules. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  maxLength?: number;
  minLength?: number;
  default?: unknown;
  label?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

export type Primitive = string | number | boolean;

interface Base {
  key: string;
  path: string[];
  /** i18n key from `.meta({ label })`. */
  label?: string;
}

export type FieldNode =
  | (Base & { kind: 'number'; min?: number; max?: number; step: number; integer: boolean })
  | (Base & { kind: 'enum'; options: Primitive[] })
  | (Base & { kind: 'boolean' })
  | (Base & { kind: 'string'; maxLength?: number })
  | (Base & { kind: 'group'; children: FieldNode[] })
  | (Base & { kind: 'unsupported' });

const cache = new WeakMap<z.ZodType, FieldNode[]>();

/** Builds (and caches) the editable field tree for a game's rules schema. */
export function rulesFields(schema: z.ZodType): FieldNode[] {
  const hit = cache.get(schema);
  if (hit) return hit;
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const fields = schemaToFields(json, json);
  cache.set(schema, fields);
  return fields;
}

function resolve(node: JsonSchema, root: JsonSchema): JsonSchema {
  let n = node;
  for (let i = 0; i < 8 && n.$ref; i++) {
    const m = /^#\/\$defs\/(.+)$/.exec(n.$ref);
    const target = m ? root.$defs?.[decodeURIComponent(m[1] as string)] : undefined;
    if (!target) break;
    // Sibling keywords (label, default) on the referencing node win.
    const { $ref: _ref, ...rest } = n;
    n = { ...target, ...rest };
  }
  return n;
}

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function typeOf(node: JsonSchema): string | undefined {
  if (Array.isArray(node.type)) return node.type.find((t) => t !== 'null');
  return node.type;
}

export function schemaToFields(node: JsonSchema, root: JsonSchema, path: string[] = []): FieldNode[] {
  const props = resolve(node, root).properties ?? {};
  return Object.entries(props).map(([key, raw]) => toField(key, raw, root, [...path, key]));
}

function toField(key: string, raw: JsonSchema, root: JsonSchema, path: string[]): FieldNode {
  const node = resolve(raw, root);
  const base: Base = { key, path, label: node.label };
  const variants = node.anyOf ?? node.oneOf;

  if (node.enum && node.enum.every(isPrimitive)) return { ...base, kind: 'enum', options: node.enum };
  if (variants && variants.length > 0) {
    const consts = variants.map((v) => resolve(v, root));
    if (consts.every((v) => 'const' in v && isPrimitive(v.const))) {
      return { ...base, kind: 'enum', options: consts.map((v) => v.const as Primitive) };
    }
  }

  switch (typeOf(node)) {
    case 'integer':
    case 'number': {
      const integer = typeOf(node) === 'integer';
      const min = node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum : undefined);
      const max = node.maximum ?? (node.exclusiveMaximum !== undefined ? node.exclusiveMaximum : undefined);
      const step = node.multipleOf ?? (integer ? 1 : 0.5);
      return { ...base, kind: 'number', min, max, step, integer };
    }
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'string':
      return { ...base, kind: 'string', maxLength: node.maxLength };
    case 'object':
      return { ...base, kind: 'group', children: schemaToFields(node, root, path) };
    default:
      return { ...base, kind: 'unsupported' };
  }
}

export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Immutable set; creates intermediate objects as needed. */
export function setAt<T>(obj: T, path: readonly string[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string, ...string[]];
  const src = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  return { ...src, [head]: setAt(src[head], rest, value) } as T;
}

/** Turns zod issues into "label path" pairs the editor can show next to Start. */
export function issuePaths(error: z.ZodError): string[][] {
  return error.issues.map((i) => i.path.map(String));
}
