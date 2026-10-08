import type { z } from 'zod';
import { getAt, rulesFields, type FieldNode } from './rulesForm';

export type LeafField = Exclude<FieldNode, { kind: 'group' } | { kind: 'unsupported' }>;

export interface RuleChange {
  /** The changed field plus the groups it sits in (outermost first), for "Group › Field" labels. */
  trail: FieldNode[];
  field: LeafField;
  from: unknown;
  to: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every editable rule whose value differs from the game's defaults, in form order. */
export function rulesDiff(schema: z.ZodType, rules: unknown): RuleChange[] {
  const defaults = schema.parse({});
  const out: RuleChange[] = [];
  const walk = (fields: readonly FieldNode[], trail: FieldNode[]) => {
    for (const f of fields) {
      if (f.kind === 'group') walk(f.children, [...trail, f]);
      else if (f.kind !== 'unsupported') {
        const from = getAt(defaults, f.path);
        const to = getAt(rules, f.path);
        if (!same(from, to)) out.push({ trail: [...trail, f], field: f, from, to });
      }
    }
  };
  walk(rulesFields(schema), []);
  return out;
}
