// Multi-tab test doubles: an in-memory Web Locks (one holder per name, ifAvailable + steal) and a
// BroadcastChannel factory whose channels see each other — so several GameClients on the same
// player can share one "origin" (world.ls) and elect a leader like sibling tabs do.
import type { ChannelLike } from '../../src/generations.ts';
import type { LocksLike } from '../../src/tabs/leader.ts';

export function fakeLocks(): LocksLike & { holders(): number } {
  const held = new Map<string, { release: () => void; reject: (e: Error) => void }>();
  return {
    holders: () => held.size,
    request(name, options, cb) {
      const cur = held.get(name);
      if (cur && !options.steal) {
        if (options.ifAvailable) return Promise.resolve(cb(null));
        return new Promise(() => {}); // would queue; tests never wait on it
      }
      if (cur && options.steal) {
        held.delete(name);
        cur.reject(new Error('AbortError'));
      }
      return new Promise((resolve, reject) => {
        held.set(name, {
          release: () => {
            held.delete(name);
          },
          reject,
        });
        Promise.resolve(cb({ name }))
          .then((v) => {
            held.delete(name);
            resolve(v);
          })
          .catch(reject);
      });
    },
  };
}

/** Channels created by the returned factory deliver to every other channel of the same name. */
export function channelPeers(): (name: string) => ChannelLike {
  const peers = new Map<string, Set<ChannelLike>>();
  return (name) => {
    const set = peers.get(name) ?? new Set<ChannelLike>();
    peers.set(name, set);
    const ch: ChannelLike = {
      onmessage: null,
      postMessage(m) {
        for (const p of set) if (p !== ch) p.onmessage?.({ data: m });
      },
      close() {
        set.delete(ch);
      },
    };
    set.add(ch);
    return ch;
  };
}
