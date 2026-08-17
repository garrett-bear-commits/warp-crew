// Input journal (§5.2 Journal, ADR-016, ADR-020). Records inputs {tick, now, kind, name, args?};
// args only for actions with a bounded schema (per-name allowlist, no free text); a ring bounded
// in bytes (32 KiB, LIMITS.journalRingBytes) persisted on autosave (spool); shipped on the timer
// path (≤ 16 KiB per call) in mode `on`, in `errors_only` only after a game_error breadcrumb;
// never at teardown. breadcrumbs() = last 20 name+tick.
import type { JournalEntry, JournalShipBody } from '@foundation/contracts';
import type { JournalEntryKind, JournalMode } from '@foundation/contracts/enums';
import { LIMITS } from '@foundation/contracts/enums';
import { utf8Bytes } from '../storage/codec.ts';
import type { Spool } from '../storage/spool.ts';

export type JournalArgValue = number | boolean | string;
export type JournalArgs = Record<string, JournalArgValue>;

/** Per action name: `true` = every bounded arg allowed, or an explicit key allowlist. */
export type ArgsAllowlist = Record<string, true | readonly string[]>;

export interface JournalRecordInput {
  tick: number;
  now: number;
  kind: JournalEntryKind;
  name: string;
  args?: JournalArgs | undefined;
}

export interface JournalOptions {
  mode: JournalMode;
  /** Ring bound in bytes (default LIMITS.journalRingBytes = 32 KiB). */
  ringBytes?: number;
  /** Ship bound in bytes per call (default LIMITS.journalMaxBytesPerCall = 16 KiB). */
  shipBytes?: number;
  /** Which action names may carry args (and which keys). Names absent here ship without args. */
  argsAllowlist?: ArgsAllowlist;
  /** Persist the ring on autosave into this spool (IndexedDB or memory). */
  spool?: Spool;
  spoolKey?: string;
}

export interface Breadcrumb {
  name: string;
  tick: number;
}

export interface ShipBatch {
  fromSeq: number;
  entries: JournalEntry[];
  /** Call after a successful ship (or `disabled`) to advance the shipped cursor. */
  ack(): void;
}

export interface Journal {
  readonly mode: JournalMode;
  record(input: JournalRecordInput): void;
  entries(): readonly JournalEntry[];
  bytes(): number;
  breadcrumbs(): Breadcrumb[];
  /** game_error observed: in errors_only mode the next timer path ships the ring. */
  markError(): void;
  /** True when the timer path should ship now (mode on with entries; errors_only after an error). */
  shouldShip(): boolean;
  /** Take up to shipBytes of unshipped entries; null when nothing to ship. Never used at teardown. */
  takeForShip(): ShipBatch | null;
  /** Build the wire body for a batch (commandId minted by the caller, reused on retry). */
  shipBody(
    batch: ShipBatch,
    commandId: string,
    generation: number,
    buildVersion: string,
  ): JournalShipBody;
  /** Attach the spool once the player is known (boot). */
  bindSpool(spool: Spool, key: string): void;
  /** Persist the ring + cursor to the spool (autosave path). No-op without a spool. */
  persist(): Promise<void>;
  /** Load a previously persisted ring (boot). */
  load(): Promise<void>;
  clear(): void;
}

const MAX_NAME = 64;
const MAX_ARG_KEY = 32;
const MAX_ARG_STR = 64;

function boundArgs(
  args: JournalArgs | undefined,
  allow: true | readonly string[] | undefined,
): JournalArgs | undefined {
  if (!args || !allow) return undefined;
  const out: JournalArgs = {};
  let n = 0;
  for (const [k, v] of Object.entries(args)) {
    if (allow !== true && !allow.includes(k)) continue;
    if (k.length > MAX_ARG_KEY) continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      out[k] = v;
    } else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > MAX_ARG_STR ? v.slice(0, MAX_ARG_STR) : v;
    else continue;
    if (++n >= 16) break;
  }
  return n > 0 ? out : undefined;
}

export function createJournal(o: JournalOptions): Journal {
  const ringBytes = o.ringBytes ?? LIMITS.journalRingBytes;
  const shipBytes = o.shipBytes ?? LIMITS.journalMaxBytesPerCall;
  const allow = o.argsAllowlist ?? {};
  let spool: Spool | undefined = o.spool;
  let spoolKey: string | undefined = o.spoolKey;
  const ring: JournalEntry[] = [];
  const sizes: number[] = [];
  let total = 0;
  /** Monotonic ship cursor within (player, generation): index of the next entry to ship. */
  let shippedSeq = 0;
  /** Absolute seq of ring[0]. */
  let baseSeq = 0;
  let errorPending = false;

  const evictToFit = (): void => {
    while (total > ringBytes && ring.length > 0) {
      ring.shift();
      total -= sizes.shift()!;
      baseSeq++;
      if (shippedSeq < baseSeq) shippedSeq = baseSeq;
    }
  };

  const api: Journal = {
    mode: o.mode,
    record(input) {
      if (o.mode === 'off') return;
      const name = input.name.length > MAX_NAME ? input.name.slice(0, MAX_NAME) : input.name;
      const entry: JournalEntry = {
        tick: Math.max(0, Math.floor(input.tick)),
        now: Math.max(0, Math.floor(input.now)),
        kind: input.kind,
        name,
      };
      const args = input.kind === 'action' ? boundArgs(input.args, allow[name]) : undefined;
      if (args) entry.args = args;
      const size = utf8Bytes(JSON.stringify(entry)) + 1;
      if (size > ringBytes) return; // a single oversize entry never enters the ring
      ring.push(entry);
      sizes.push(size);
      total += size;
      evictToFit();
    },
    entries: () => ring,
    bytes: () => total,
    breadcrumbs() {
      return ring.slice(-20).map((e) => ({ name: e.name, tick: e.tick }));
    },
    markError() {
      if (o.mode !== 'off') errorPending = true;
    },
    shouldShip() {
      if (o.mode === 'off') return false;
      const unshipped = baseSeq + ring.length - shippedSeq;
      if (unshipped <= 0) return false;
      return o.mode === 'on' || errorPending;
    },
    takeForShip() {
      if (!api.shouldShip()) return null;
      const start = shippedSeq - baseSeq;
      const entries: JournalEntry[] = [];
      let bytes = 2;
      for (let i = start; i < ring.length; i++) {
        const s = sizes[i]!;
        if (bytes + s > shipBytes) break;
        if (entries.length >= 500) break;
        entries.push(ring[i]!);
        bytes += s;
      }
      if (entries.length === 0) return null;
      const fromSeq = shippedSeq;
      const count = entries.length;
      return {
        fromSeq,
        entries,
        ack() {
          shippedSeq = Math.max(shippedSeq, fromSeq + count);
          if (shippedSeq >= baseSeq + ring.length) errorPending = false;
        },
      };
    },
    shipBody(batch, commandId, generation, buildVersion) {
      return {
        commandId,
        generation,
        fromSeq: batch.fromSeq,
        entries: batch.entries,
        buildVersion,
      };
    },
    bindSpool(sp, key) {
      spool = sp;
      spoolKey = key;
    },
    async persist() {
      if (!spool || !spoolKey || o.mode === 'off') return;
      try {
        await spool.put(spoolKey, JSON.stringify({ ring, baseSeq, shippedSeq, errorPending }));
      } catch {
        /* the journal never blocks play */
      }
    },
    async load() {
      if (!spool || !spoolKey || o.mode === 'off') return;
      try {
        const raw = await spool.get(spoolKey);
        if (!raw) return;
        const p = JSON.parse(raw) as {
          ring?: JournalEntry[];
          baseSeq?: number;
          shippedSeq?: number;
          errorPending?: boolean;
        };
        if (!Array.isArray(p.ring)) return;
        ring.length = 0;
        sizes.length = 0;
        total = 0;
        for (const e of p.ring) {
          if (!e || typeof e !== 'object' || typeof e.name !== 'string') continue;
          const size = utf8Bytes(JSON.stringify(e)) + 1;
          ring.push(e);
          sizes.push(size);
          total += size;
        }
        baseSeq = typeof p.baseSeq === 'number' ? p.baseSeq : 0;
        shippedSeq = typeof p.shippedSeq === 'number' ? Math.max(p.shippedSeq, baseSeq) : baseSeq;
        errorPending = p.errorPending === true;
        evictToFit();
      } catch {
        /* corrupt spool: start empty */
      }
    },
    clear() {
      ring.length = 0;
      sizes.length = 0;
      total = 0;
      baseSeq = 0;
      shippedSeq = 0;
      errorPending = false;
    },
  };
  return api;
}
