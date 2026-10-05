// fakeFetch: a scripted fetch for client tests. Routes are matched by method+path prefix; each
// handler can return a Response, throw (network error), or delay. Records every call.
export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

export type FakeHandler = (call: FakeCall) => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof fetch;
  on(method: string, pathPrefix: string, handler: FakeHandler): void;
  calls: FakeCall[];
  /** Simulate the network being down: every call rejects with TypeError('network'). */
  offline: boolean;
  reset(): void;
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function fakeFetch(now: () => number = () => 0): FakeFetch {
  const routes: Array<{ method: string; prefix: string; handler: FakeHandler }> = [];
  const calls: FakeCall[] = [];
  const api: FakeFetch = {
    calls,
    offline: false,
    on(method, prefix, handler) {
      routes.unshift({ method: method.toUpperCase(), prefix, handler });
    },
    reset() {
      routes.length = 0;
      calls.length = 0;
      api.offline = false;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      const h = init?.headers;
      if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) headers[k.toLowerCase()] = v;
      else if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
      let body: unknown = init?.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          /* keep raw */
        }
      }
      const call: FakeCall = { method, url, headers, body, at: now() };
      calls.push(call);
      if (api.offline) throw new TypeError('network offline');
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const r = routes.find((x) => x.method === method && path.startsWith(x.prefix));
      if (!r) return json(404, { error: 'not_found', correlationId: 'fake' });
      return r.handler(call);
    }) as typeof fetch,
  };
  return api;
}
