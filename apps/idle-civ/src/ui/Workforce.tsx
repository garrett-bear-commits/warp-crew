import { useIdleCiv } from '../StoreProvider.tsx';
import type { ProfessionId } from '../sim/index.ts';

export function Workforce() {
  const view = useIdleCiv((s) => s.view);
  const selected = useIdleCiv((s) => s.selectedProfession);
  const preview = useIdleCiv((s) => s.preview);
  const select = useIdleCiv((s) => s.selectProfession);
  const assign = useIdleCiv((s) => s.assign);
  const fundJob = useIdleCiv((s) => s.fundJob);
  const craftTool = useIdleCiv((s) => s.craftTool);
  const openPack = useIdleCiv((s) => s.openFounderPack);
  if (!view) return null;
  return (
    <footer className="dock" data-testid="workforce">
      <div className="laborers" data-testid="laborers">
        Laborers <b>{view.laborers}</b>
      </div>
      <div className="jobs">
        {view.workers
          .filter((w) => w.visible)
          .map((w) => (
            <div
              key={w.profession}
              className={selected === w.profession ? 'job selected' : 'job'}
              data-testid={`job-${w.profession}`}
            >
              <button
                className="job-label"
                onClick={() =>
                  select(selected === w.profession ? null : (w.profession as ProfessionId))
                }
              >
                {w.label}
                {w.cardLabel ? <small> {w.cardLabel}</small> : null}
              </button>
              <div className="stepper">
                <button
                  data-testid={`minus-${w.profession}`}
                  disabled={!w.canMinus}
                  onClick={() => assign(w.profession as Exclude<ProfessionId, 'laborer'>, -1)}
                >
                  −
                </button>
                <b data-testid={`count-${w.profession}`}>{w.count}</b>
                <button
                  data-testid={`plus-${w.profession}`}
                  disabled={!w.canPlus}
                  onClick={() => assign(w.profession as Exclude<ProfessionId, 'laborer'>, 1)}
                >
                  +
                </button>
              </div>
              <small>{w.rateLabel}</small>
            </div>
          ))}
      </div>
      {preview && selected && selected !== 'laborer' ? (
        <p className="preview" data-testid="assign-preview">
          +1 {selected}: Food {preview.foodNet.toFixed(2)}/min · Wood {preview.woodNet.toFixed(2)}
          /min
        </p>
      ) : null}
      <div className="builds">
        {view.jobs
          .filter((j) => j.status !== 'hidden')
          .map((j) => (
            <div key={j.id} className="build" data-testid={`build-${j.id}`}>
              <span>
                {j.label}
                {j.status === 'building' && j.etaSec !== null && Number.isFinite(j.etaSec)
                  ? ` · ${Math.ceil(j.etaSec)}s`
                  : j.status === 'funded'
                    ? ' · needs a Builder'
                    : j.status === 'complete'
                      ? ' · done'
                      : ''}
              </span>
              {j.status === 'available' ? (
                <button data-testid={`fund-${j.id}`} onClick={() => fundJob(j.id)}>
                  Fund {j.costs}
                </button>
              ) : (
                <progress max={100} value={j.workPct} />
              )}
            </div>
          ))}
      </div>
      {view.workbenchLevel >= 1 ? (
        <div className="tools" data-testid="tools">
          <p>Tools cover one worker. The Work Kit covers a whole profession.</p>
          {view.tools.map((t) => (
            <button
              key={t.kind}
              data-testid={`craft-${t.kind}`}
              disabled={!t.craftable}
              onClick={() => craftTool(t.kind)}
            >
              {t.label} {t.covered ? `· ${t.covered} equipped` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {view.founderGranted && view.hamletCelebrationDone && !view.founderOpened ? (
        <button className="pack" data-testid="open-founder-pack" onClick={openPack}>
          Open Founder’s Pack
        </button>
      ) : null}
    </footer>
  );
}
