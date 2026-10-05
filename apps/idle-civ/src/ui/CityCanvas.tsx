import { useIdleCiv } from '../StoreProvider.tsx';

export function CityCanvas() {
  const view = useIdleCiv((s) => s.view);
  if (!view) return null;
  const people = view.population;
  return (
    <main
      className="city"
      data-testid="city"
      data-stage={view.stage}
      data-fire={view.campfireLevel}
    >
      <div className={`ground ${view.stage === 'hamlet' ? 'open' : ''}`}>
        <div className="forage" />
        <div className="timber" />
        {Array.from({ length: Math.max(0, 5 - (view.hutComplete ? 2 : 0)) }, (_, i) => (
          <div key={`tent-${i}`} className={`tent tent-${i}`} />
        ))}
        {view.hutComplete ? <div className="hut" data-testid="hut" /> : null}
        <div
          className={`campfire lv${view.campfireLevel} ${view.foodWarning ? 'dim' : 'bright'}`}
          data-testid="campfire"
        />
        {view.workbenchLevel >= 1 ? <div className="workbench" data-testid="workbench" /> : null}
        {view.stage === 'hamlet' ? <div className="path-line" /> : null}
        <div className="people" data-testid="people">
          {Array.from({ length: people }, (_, i) => (
            <span key={i} className={`person p${i % 5}`} />
          ))}
        </div>
      </div>
      <p className="hint" data-testid="hint">
        {view.hint}
      </p>
    </main>
  );
}
