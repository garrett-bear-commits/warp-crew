// Rendering helpers (ADR-021 / §7): every node is built with createElement + textContent.
// No HTML string is ever parsed. Images are only shown when the decoded bytes carry a real
// PNG/JPEG/GIF/WebP signature ("images by magic bytes"); anything else renders as text.

type Child = Node | string | null | undefined;

/** Create an element; string children become text nodes (never markup). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

/** Text-only element: the string is assigned via textContent so markup stays inert. */
export function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace the children of `node` with the given ones. */
export function replace(node: Element, children: Child[]): void {
  clear(node);
  append(node, children);
}

// ─── Values ────────────────────────────────────────────────────────

/** Epoch ms → ISO string; `new Date(ms)` with an argument is allowed (ADR-009). */
export function fmtTime(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

export function fmtValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

// ─── Tables / key-value ─────────────────────────────────────────────

export interface Column<T> {
  header: string;
  cell: (row: T) => Child | Child[];
  wrap?: boolean;
}

export function table<T>(columns: Column<T>[], rows: T[]): HTMLTableElement {
  const thead = el('thead', {}, [
    el(
      'tr',
      {},
      columns.map((c) => text('th', c.header)),
    ),
  ]);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const c of columns) {
      const v = c.cell(row);
      const td = el('td', c.wrap ? { class: 'wrap' } : {}, Array.isArray(v) ? v : [v]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  return el('table', {}, [thead, tbody]);
}

export function keyValue(pairs: Array<[string, unknown]>): HTMLDListElement {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of pairs) {
    dl.appendChild(text('dt', k));
    dl.appendChild(text('dd', fmtValue(v)));
  }
  return dl;
}

export function pill(label: string): HTMLSpanElement {
  return text('span', label, `pill ${label.replace(/[^a-z_]/g, '')}`);
}

// ─── Images by magic bytes ─────────────────────────────────────────

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp';

const SIGNATURES: Array<{ kind: ImageKind; at: number; bytes: number[] }> = [
  { kind: 'png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'jpeg', at: 0, bytes: [0xff, 0xd8, 0xff] },
  { kind: 'gif', at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
];

/** Sniff the image type from the first bytes. WebP = "RIFF" + 4 size bytes + "WEBP". */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  for (const s of SIGNATURES) {
    if (bytes.length < s.at + s.bytes.length) continue;
    if (s.bytes.every((b, i) => bytes[s.at + i] === b)) return s.kind;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'webp';
  return null;
}

/** Decode up to `max` bytes of a base64 payload (enough for any signature). */
export function decodeBase64Prefix(b64: string, max = 32): Uint8Array | null {
  const clean = b64.replace(/\s+/g, '');
  // 4 base64 chars → 3 bytes; keep whole quads so atob never sees a truncated group.
  const quads = Math.ceil(max / 3);
  const head = clean.slice(0, quads * 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(head)) return null;
  try {
    const bin = atob(head);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const DATA_URL = /^data:([a-z0-9.+/-]*);base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * Returns a normalised `data:image/<kind>;base64,…` URL when the payload's magic bytes identify a
 * PNG/JPEG/GIF/WebP; null otherwise (SVG, HTML, mislabelled data, anything unsniffable).
 */
export function safeImageDataUrl(value: string): string | null {
  const m = DATA_URL.exec(value);
  if (!m) return null;
  const payload = m[2] ?? '';
  const bytes = decodeBase64Prefix(payload);
  if (!bytes) return null;
  const kind = sniffImage(bytes);
  if (!kind) return null;
  return `data:image/${kind};base64,${payload.replace(/\s+/g, '')}`;
}

// ─── JSON tree ─────────────────────────────────────────────────────

const MAX_NODES = 5000;

/** Render arbitrary JSON as nested <details>; falls back to a <pre> when the value is huge. */
export function jsonTree(value: unknown): HTMLElement {
  const budget = { left: MAX_NODES };
  const root = el('div', { class: 'tree' });
  const node = renderValue(value, budget);
  if (budget.left <= 0) {
    return el('pre', { class: 'raw' }, [JSON.stringify(value, null, 2) ?? '']);
  }
  root.appendChild(node);
  return root;
}

function leaf(value: unknown): Node {
  if (typeof value === 'string') {
    const img = safeImageDataUrl(value);
    if (img) {
      const image = el('img', { alt: 'embedded image (verified by magic bytes)' });
      image.src = img;
      return el('span', { class: 'v' }, [image]);
    }
    return text('span', JSON.stringify(value), 'v');
  }
  return text('span', fmtValue(value), 'v');
}

function renderValue(value: unknown, budget: { left: number }): Node {
  budget.left--;
  if (budget.left <= 0) return text('span', '…', 'v');
  if (value === null || typeof value !== 'object') return leaf(value);
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);
  const label = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  const details = el('details', entries.length <= 20 ? { open: '' } : {}, [text('summary', label)]);
  const ul = el('ul');
  for (const [k, v] of entries) {
    if (budget.left <= 0) {
      ul.appendChild(text('li', '…'));
      break;
    }
    const li = el('li', {}, [text('span', `${k}: `, 'k'), renderValue(v, budget)]);
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}
