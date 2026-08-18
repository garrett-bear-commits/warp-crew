import { describe, expect, it } from 'vitest';
import { diffOpenApi } from '../src/openapi-diff.ts';
import { buildOpenApi } from '../src/openapi.ts';

describe('openapi-diff: breaking-change detector (runs vs the last released tag in CI)', () => {
  const doc = buildOpenApi() as Record<string, unknown>;
  it('a document is not breaking against itself', () => {
    expect(diffOpenApi(doc, doc)).toEqual([]);
  });
  it('detects removed paths/operations, new required request fields, removed response fields and enum values', () => {
    const older = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const paths = older.paths as Record<string, Record<string, Record<string, unknown>>>;
    // pretend the old contract had an extra path and the saves response had an extra field, and the request lacked `reason`
    paths['/v1/legacy'] = { get: { operationId: 'legacy', responses: {} } };
    const put = paths['/v1/saves']!.put!;
    const reqSchema = (
      put.requestBody as { content: Record<string, { schema: Record<string, unknown> }> }
    ).content['application/json']!.schema;
    reqSchema.required = (reqSchema.required as string[]).filter((r) => r !== 'reason');
    const resSchema = (
      put.responses as Record<
        string,
        { content: Record<string, { schema: Record<string, unknown> }> }
      >
    )['200']!.content['application/json']!.schema;
    (resSchema.properties as Record<string, unknown>).legacyField = { type: 'string' };
    (resSchema.required as string[]).push('legacyField');
    const dispositions = (
      resSchema.properties as Record<string, { anyOf: Array<{ const: string }> }>
    ).disposition!;
    dispositions.anyOf.push({ const: 'legacy_disposition' });
    const breaking = diffOpenApi(older, doc);
    const kinds = breaking.map((b) => `${b.kind}:${b.detail}`);
    expect(kinds).toContain('path_removed:/v1/legacy');
    expect(kinds).toContain('request_required_added:reason');
    expect(kinds).toContain('response_property_removed:legacyField');
    expect(kinds).toContain('response_required_removed:legacyField');
    expect(kinds).toContain('enum_value_removed:legacy_disposition');
    // additive changes are fine
    expect(diffOpenApi(doc, older)).toEqual([]);
  });
});
