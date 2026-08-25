import { useIdleCiv } from '../StoreProvider.tsx';

function fmt(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(1);
}

function signed(n: number): string {
  const t = fmt(n);
  return n > 0.05 ? `+${t}` : t;
}

export function Hud() {
  const view = useIdleCiv((s) => s.view);
  if (!view) return null;
  return (
    <header className="hud" data-testid="hud">
      <div className="hud-title">
        <strong data-testid="settlement-name">{view.title}</strong>
        <span data-testid="pop">
          {view.population}/{view.housing}
        </span>
      </div>
      <div className="hud-stocks">
        {view.stocks
          .filter((st) => st.visible)
          .map((st) => (
            <div
              key={st.id}
              className={st.warning ? 'stock warn' : 'stock'}
              data-testid={`stock-${st.id}`}
            >
              <span>{st.label}</span>
              <b>{fmt(st.amount)}</b>
              <small data-testid={`net-${st.id}`}>{signed(st.netPerMin)}/min</small>
            </div>
          ))}
      </div>
      {view.happiness !== 'hidden' ? (
        <div className="hud-civic" data-testid="amenities">
          Happiness {view.happiness} · Amenities {view.amenities}/{view.population}
        </div>
      ) : null}
      <ol className="path" data-testid="founders-path">
        {view.path.map((p) => (
          <li key={p.id} data-done={p.done ? '1' : '0'}>
            {p.label}
          </li>
        ))}
      </ol>
    </header>
  );
}
