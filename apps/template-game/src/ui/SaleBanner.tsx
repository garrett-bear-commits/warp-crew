// Sale banner: flag `sale.summer` (rollout %, sticky per player) + the active `sale` schedule
// (id + payload.discount) from GET /v1/config. Config publish, no rebuild.
import { useGame } from '../game.tsx';

export function useSale(): { on: boolean; discount: number; scheduleId: string | null } {
  const { live } = useGame();
  const on = live?.flags?.['sale.summer'] === true;
  const sched = live?.schedules.find((s) => s.kind === 'sale' && s.active) ?? null;
  const d = sched?.payload?.discount;
  const discount = typeof d === 'number' && d > 0 && d < 100 ? d : 50;
  return { on, discount, scheduleId: sched?.id ?? null };
}

export function SaleBanner() {
  const sale = useSale();
  if (!sale.on) return null;
  return (
    <div className="banner sale" data-testid="sale-banner" data-discount={sale.discount}>
      Summer sale: <b>{sale.discount}% off</b> gems
      {sale.scheduleId ? <span data-testid="sale-schedule"> · {sale.scheduleId}</span> : null}
    </div>
  );
}
