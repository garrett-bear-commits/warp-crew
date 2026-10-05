// Toasts: engine effects of kind `toast` (drained from the bounded ring via useEffects) + game
// notices. Effects are transient; anything the player must acknowledge lives in state (§5.1).
import { useEffects } from '@foundation/client/react';
import { useEffect, useState } from 'react';
import type { TemplateEffect } from '../engine.ts';
import { useGame } from '../game.tsx';

type ToastEffect = Extract<TemplateEffect, { kind: 'toast' }>;
const keyOf = (e: ToastEffect, i: number): string => `e${e.tick}-${i}-${e.payload.text}`;

export function Toasts() {
  const { client, toasts } = useGame();
  const effects = useEffects<TemplateEffect>(client, ['toast', 'coin']);
  // effects accumulate in the hook; each batch expires 6 s after it arrived (state is only set
  // from the timer callback, never synchronously in the effect)
  const [expired, setExpired] = useState<ReadonlySet<string>>(() => new Set());
  const toastEffects = effects.filter((e): e is ToastEffect => e.kind === 'toast');
  const keys = toastEffects.map(keyOf).join('|');
  useEffect(() => {
    if (!keys) return;
    const batch = keys.split('|');
    const h = setTimeout(() => setExpired((prev) => new Set([...prev, ...batch])), 6_000);
    return () => clearTimeout(h);
  }, [keys]);
  const shown = toastEffects
    .map((e, i) => ({ key: keyOf(e, i), text: e.payload.text }))
    .filter((t) => !expired.has(t.key))
    .slice(-8);
  const coins = effects.filter((e) => e.kind === 'coin').length;
  return (
    <div className="toasts" data-testid="toasts" data-coins={coins}>
      {shown.map((t) => (
        <div key={t.key} className="toast" data-testid="toast">
          {t.text}
        </div>
      ))}
      {toasts.map((t) => (
        <div key={`g${t.id}`} className="toast" data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
