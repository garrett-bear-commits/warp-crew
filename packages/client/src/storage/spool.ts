// Journal spool (§5.2, ADR-005): IndexedDB is used ONLY for the journal spool; it is optional and
// falls back to memory (and to the localStorage tier when given one) when IndexedDB is absent,
// blocked, or throws. A small async string KV is all the journal needs.

export interface Spool {
  readonly backend: 'indexeddb' | 'memory';
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface IdbLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

const DB_NAME = 'foundation-journal';
const STORE = 'spool';

function openDb(idb: IdbLike): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

function txRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let req: IDBRequest<T>;
    try {
      const tx = db.transaction(STORE, mode);
      req = fn(tx.objectStore(STORE));
    } catch (e) {
      reject(e);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'));
  });
}

export function memorySpool(): Spool {
  const m = new Map<string, string>();
  return {
    backend: 'memory',
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
  };
}

/**
 * Create the spool. Probes `indexedDB` (injectable) once; every failure degrades to memory for
 * the rest of the session — the journal is a debugging aid and must never block play.
 */
export async function createSpool(
  idb: IdbLike | null | undefined = (globalThis as { indexedDB?: IdbLike }).indexedDB,
): Promise<Spool> {
  if (!idb) return memorySpool();
  let db: IDBDatabase;
  try {
    db = await openDb(idb);
  } catch {
    return memorySpool();
  }
  const fallback = memorySpool();
  let broken = false;
  const guard = async <T>(fn: () => Promise<T>, alt: () => Promise<T>): Promise<T> => {
    if (broken) return alt();
    try {
      return await fn();
    } catch {
      broken = true;
      return alt();
    }
  };
  return {
    backend: 'indexeddb',
    get: (k) =>
      guard(
        () =>
          txRequest<string | undefined>(
            db,
            'readonly',
            (s) => s.get(k) as IDBRequest<string | undefined>,
          ).then((v) => (typeof v === 'string' ? v : null)),
        () => fallback.get(k),
      ),
    put: (k, v) =>
      guard(
        () => txRequest(db, 'readwrite', (s) => s.put(v, k)).then(() => undefined),
        () => fallback.put(k, v),
      ),
    delete: (k) =>
      guard(
        () => txRequest(db, 'readwrite', (s) => s.delete(k)).then(() => undefined),
        () => fallback.delete(k),
      ),
  };
}
