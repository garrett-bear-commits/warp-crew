// Breaking-change detector for the OpenAPI document (§9 "oasdiff breaking vs last released tag").
// Pure and dependency-free: it runs in CI against `git show <last-tag>:packages/contracts/openapi.json`
// when a released tag exists; without a tag there is nothing to diff (reported, never faked).
type Json = Record<string, unknown>;

export interface BreakingChange {
  kind:
    | 'path_removed'
    | 'operation_removed'
    | 'request_required_added'
    | 'request_property_removed'
    | 'response_property_removed'
    | 'response_required_removed'
    | 'enum_value_removed';
  where: string;
  detail: string;
}

const props = (schema: unknown): Record<string, unknown> =>
  ((schema as Json | undefined)?.properties as Record<string, unknown> | undefined) ?? {};
const required = (schema: unknown): string[] =>
  ((schema as Json | undefined)?.required as string[] | undefined) ?? [];

function enumValues(schema: unknown): string[] | null {
  const s = schema as Json | undefined;
  if (!s) return null;
  if (Array.isArray(s.anyOf)) {
    const vals = (s.anyOf as Json[])
      .map((x) => x.const)
      .filter((v) => typeof v === 'string') as string[];
    return vals.length ? vals : null;
  }
  return Array.isArray(s.enum) ? (s.enum as string[]) : null;
}

/** Compare request/response schemas of one operation (old → new). */
function diffSchemas(
  where: string,
  oldS: unknown,
  newS: unknown,
  direction: 'request' | 'response',
  out: BreakingChange[],
): void {
  const oldP = props(oldS);
  const newP = props(newS);
  if (direction === 'request') {
    for (const r of required(newS))
      if (!required(oldS).includes(r))
        out.push({ kind: 'request_required_added', where, detail: r });
    for (const k of Object.keys(oldP))
      if (!(k in newP)) out.push({ kind: 'request_property_removed', where, detail: k });
  } else {
    for (const k of Object.keys(oldP))
      if (!(k in newP)) out.push({ kind: 'response_property_removed', where, detail: k });
    for (const r of required(oldS))
      if (!required(newS).includes(r))
        out.push({ kind: 'response_required_removed', where, detail: r });
  }
  for (const k of Object.keys(oldP)) {
    if (!(k in newP)) continue;
    const oe = enumValues(oldP[k]);
    const ne = enumValues(newP[k]);
    if (oe && ne)
      for (const v of oe)
        if (!ne.includes(v))
          out.push({ kind: 'enum_value_removed', where: `${where}.${k}`, detail: v });
    // one level of nesting is enough for our flat contracts; recurse for objects
    if (props(oldP[k]) && Object.keys(props(oldP[k])).length)
      diffSchemas(`${where}.${k}`, oldP[k], newP[k], direction, out);
  }
}

export function diffOpenApi(oldDoc: Json, newDoc: Json): BreakingChange[] {
  const out: BreakingChange[] = [];
  const oldPaths = (oldDoc.paths as Record<string, Record<string, Json>>) ?? {};
  const newPaths = (newDoc.paths as Record<string, Record<string, Json>>) ?? {};
  for (const [path, ops] of Object.entries(oldPaths)) {
    const nops = newPaths[path];
    if (!nops) {
      out.push({ kind: 'path_removed', where: path, detail: path });
      continue;
    }
    for (const [method, op] of Object.entries(ops)) {
      const nop = nops[method];
      if (!nop) {
        out.push({
          kind: 'operation_removed',
          where: `${method.toUpperCase()} ${path}`,
          detail: String(op.operationId ?? ''),
        });
        continue;
      }
      const where = `${method.toUpperCase()} ${path}`;
      const oreq =
        ((op.requestBody as Json | undefined)?.content as Record<string, Json> | undefined) ?? {};
      const nreq =
        ((nop.requestBody as Json | undefined)?.content as Record<string, Json> | undefined) ?? {};
      for (const ct of Object.keys(oreq))
        if (nreq[ct])
          diffSchemas(`${where} request`, oreq[ct]!.schema, nreq[ct]!.schema, 'request', out);
      const ores = (
        (op.responses as Record<string, Json> | undefined)?.['200']?.content as
          Record<string, Json> | undefined
      )?.['application/json']?.schema;
      const nres = (
        (nop.responses as Record<string, Json> | undefined)?.['200']?.content as
          Record<string, Json> | undefined
      )?.['application/json']?.schema;
      if (ores && nres) diffSchemas(`${where} response`, ores, nres, 'response', out);
    }
  }
  return out;
}
