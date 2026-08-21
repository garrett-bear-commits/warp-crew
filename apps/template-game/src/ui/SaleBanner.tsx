// Promotional visibility demo. It never alters or advertises checkout prices: those come only from
// the platform product catalog/Developer Console.
import { useGame } from '../game.tsx';

export function useSale(): { on: boolean; scheduleId: string | null } {
  const { live } = useGame();
  const on = live?.flags?.['sale.summer'] === true;
  const sched = live?.schedules.find((s) => s.kind === 'sale' && s.active) ?? null;
  return { on, scheduleId: sched?.id ?? null };
}

export function SaleBanner() {
  const sale = useSale();
  if (!sale.on) return null;
  return (
    <div className="banner sale" data-testid="sale-banner">
      Summer event active. <b>See checkout for the platform price.</b>
      {sale.scheduleId ? <span data-testid="sale-schedule"> · {sale.scheduleId}</span> : null}
    </div>
  );
}
