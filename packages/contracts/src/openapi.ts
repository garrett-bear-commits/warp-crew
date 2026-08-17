import type { TSchema } from '@sinclair/typebox';
import { CONTRACT_VERSION } from './enums.ts';
import { ErrorEnvelope } from './common.ts';
import { ROUTES, isMutation, type RouteDef } from './routes.ts';

type Json = Record<string, unknown>;

/** Strip TypeBox symbol keys and $id-based refs into inline schemas (OpenAPI 3.1 accepts JSON Schema 2020-12). */
function clean(schema: TSchema): Json {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (seen.has(v)) return {};
      seen.add(v);
      const out: Json = {};
      for (const [k, val] of Object.entries(v as Json)) {
        if (k === '$id') continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(schema) as Json;
}

function paramsFrom(route: RouteDef): Json[] {
  const params: Json[] = [];
  const add = (where: 'path' | 'query', schema: TSchema | undefined) => {
    if (!schema) return;
    const props = (schema as Json).properties as Record<string, TSchema> | undefined;
    const required = ((schema as Json).required as string[] | undefined) ?? [];
    for (const [name, s] of Object.entries(props ?? {})) {
      params.push({
        name,
        in: where,
        required: where === 'path' ? true : required.includes(name),
        schema: clean(s),
      });
    }
  };
  add('path', route.params);
  add('query', route.query);
  return params;
}

export function buildOpenApi(): Json {
  const paths: Json = {};
  const errorRef = { $ref: '#/components/schemas/ErrorEnvelope' };
  for (const r of ROUTES) {
    const oaPath = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const op: Json = {
      operationId: r.id,
      summary: r.summary,
      tags: [r.feature],
      'x-auth': r.auth,
      ...(r.adminScope ? { 'x-admin-scope': r.adminScope } : {}),
      ...(r.stepUp ? { 'x-step-up': true } : {}),
      ...(isMutation(r) ? { 'x-mutation': true, 'x-idempotency': 'commandId' } : {}),
      parameters: paramsFrom(r),
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: clean(r.response) } },
        },
        '400': {
          description: 'validation_failed | bad_request',
          content: { 'application/json': { schema: errorRef } },
        },
        '401': {
          description: 'unauthorized',
          content: { 'application/json': { schema: errorRef } },
        },
        '422': {
          description: 'idempotency_mismatch',
          content: { 'application/json': { schema: errorRef } },
        },
        '426': {
          description: 'build_too_old',
          content: { 'application/json': { schema: errorRef } },
        },
        '429': {
          description: 'rate_limited',
          content: { 'application/json': { schema: errorRef } },
        },
        '503': {
          description: 'retry_later | not_configured',
          content: { 'application/json': { schema: errorRef } },
        },
        ...Object.fromEntries(
          (r.statuses ?? []).map((s) => [
            String(s),
            { description: `status ${s}`, content: { 'application/json': { schema: errorRef } } },
          ]),
        ),
      },
    };
    if (r.body) {
      const contentType = r.auth === 'beacon' ? 'text/plain' : 'application/json';
      op.requestBody = { required: true, content: { [contentType]: { schema: clean(r.body) } } };
    }
    const p = (paths[oaPath] as Json | undefined) ?? {};
    p[r.method.toLowerCase()] = op;
    paths[oaPath] = p;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Game Foundation API',
      version: CONTRACT_VERSION,
      description:
        'One deployment + one database = one game + one environment (ADR-003). Every mutation carries a client-minted commandId. serverNow in every response. Refusals are 200 with a disposition (ADR-019).',
    },
    servers: [{ url: 'http://localhost:8080' }],
    paths,
    components: {
      schemas: { ErrorEnvelope: clean(ErrorEnvelope) },
      securitySchemes: {
        playerToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Provider-signed player token; x-player-key header carries the claimed key.',
        },
        adminKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-admin-key-id',
          description: 'Paired with x-admin-secret; scoped.',
        },
        opsSecret: { type: 'apiKey', in: 'header', name: 'x-ops-secret' },
      },
    },
  };
}
