import { useIdleCiv } from '../StoreProvider.tsx';

export function Overlays() {
  const overlay = useIdleCiv((s) => s.overlay);
  const view = useIdleCiv((s) => s.view);
  const nameDraft = useIdleCiv((s) => s.nameDraft);
  const setNameDraft = useIdleCiv((s) => s.setNameDraft);
  const equipKit = useIdleCiv((s) => s.equipKit);
  const nameSettlement = useIdleCiv((s) => s.nameSettlement);
  const skipName = useIdleCiv((s) => s.skipName);
  const finishHamlet = useIdleCiv((s) => s.finishHamlet);
  const equipFounderCard = useIdleCiv((s) => s.equipFounderCard);
  const ackReturnReport = useIdleCiv((s) => s.ackReturnReport);
  const dismissDailySupply = useIdleCiv((s) => s.dismissDailySupply);
  if (!view || overlay === 'none' || overlay === 'boot') return null;

  if (overlay === 'kit') {
    return (
      <section className="sheet" data-testid="overlay-kit">
        <h2>Woven Baskets</h2>
        <p>
          A Work Kit changes every Forager. A crafted tool later will fully equip only one worker.
        </p>
        <button data-testid="equip-kit" onClick={equipKit}>
          Equip on Foragers
        </button>
      </section>
    );
  }
  if (overlay === 'name') {
    return (
      <section className="sheet" data-testid="overlay-name">
        <h2>Name the settlement</h2>
        <input
          data-testid="name-input"
          maxLength={24}
          value={nameDraft}
          placeholder="Riverbend"
          onChange={(e) => setNameDraft(e.target.value)}
        />
        <div className="row">
          <button
            data-testid="name-confirm"
            disabled={!nameDraft.trim()}
            onClick={() => nameSettlement(nameDraft)}
          >
            Raise the sign
          </button>
          <button data-testid="name-skip" onClick={skipName}>
            Later
          </button>
        </div>
      </section>
    );
  }
  if (overlay === 'hamlet') {
    return (
      <section className="sheet" data-testid="overlay-hamlet">
        <h2>{view.settlementName ? `${view.settlementName} is a Hamlet` : 'A Hamlet stands'}</h2>
        <p>The path is in. The fire is bigger. This is a place now.</p>
        <button data-testid="finish-hamlet" onClick={finishHamlet}>
          Look around
        </button>
      </section>
    );
  }
  if (overlay === 'founderCard') {
    return (
      <section className="sheet" data-testid="overlay-founder">
        <h2>Founder’s Pack</h2>
        <p>Three current-stage cards. Equip one into an empty profession socket.</p>
        {view.founderCards.map((c) => (
          <button
            key={c.id}
            data-testid={`equip-card-${c.id}`}
            onClick={() => equipFounderCard(c.id)}
          >
            {c.label} · {c.profession} ×{c.modifier.toFixed(2)}
          </button>
        ))}
      </section>
    );
  }
  if (overlay === 'returnReport' && view.returnReport) {
    const r = view.returnReport;
    return (
      <section className="sheet" data-testid="overlay-return">
        <h2>While away</h2>
        <p>
          Credited {Math.round(r.creditedMs / 60000)}m
          {r.frozenMs ? ` · frozen ${Math.round(r.frozenMs / 60000)}m` : ''}.
        </p>
        <ul>
          <li>
            Food {r.foodDelta >= 0 ? '+' : ''}
            {r.foodDelta.toFixed(0)}
          </li>
          <li>
            Wood {r.woodDelta >= 0 ? '+' : ''}
            {r.woodDelta.toFixed(0)}
          </li>
          {r.completedJobs.length ? <li>Finished: {r.completedJobs.join(', ')}</li> : null}
          {r.arrivals ? <li>{r.arrivals} arrived, still Laborers</li> : null}
          {r.storageSaturated.length ? <li>Full: {r.storageSaturated.join(', ')}</li> : null}
        </ul>
        <p>{r.nextBottleneck}</p>
        <button data-testid="ack-return" onClick={ackReturnReport}>
          Back to camp
        </button>
      </section>
    );
  }
  if (overlay === 'dailySupply') {
    return (
      <section className="sheet" data-testid="overlay-daily">
        <h2>Daily Supply Pack</h2>
        <p>The next free pack returns tomorrow. No shop, no Crowns, no price.</p>
        <button data-testid="ack-daily" onClick={dismissDailySupply}>
          I’ll be here
        </button>
      </section>
    );
  }
  return null;
}
