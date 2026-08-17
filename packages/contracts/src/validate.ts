// Node-side validation helpers (TypeBox Value). Not for browser bundles.
import { FormatRegistry, type TSchema, type Static } from '@sinclair/typebox';
import { Value, type ValueError } from '@sinclair/typebox/value';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));

export function check<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  return Value.Check(schema, value);
}

export function errors(schema: TSchema, value: unknown): ValueError[] {
  return [...Value.Errors(schema, value)];
}

export function assertValid<T extends TSchema>(
  schema: T,
  value: unknown,
  label = 'value',
): Static<T> {
  if (!Value.Check(schema, value)) {
    const errs = errors(schema, value)
      .slice(0, 5)
      .map((e) => `${e.path || '/'}: ${e.message}`)
      .join('; ');
    throw new Error(`${label} does not match schema: ${errs}`);
  }
  return value as Static<T>;
}
