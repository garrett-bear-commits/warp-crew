// Play area: click → dispatch {type:'click'}; buy auto/click upgrades; readouts (gold, gems,
// counter = progress ordinal, clicks); production shown × the `idle.rate` flag (config-driven
// display multiplier — the observable "config publish without rebuild"). Followers are read-only.
import { useGameState } from '@foundation/client/react';
import { autoPerTick, clickValue, TPS, upgradeCost } from '../engine.ts';
import { useGame } from '../game.tsx';
import { useLeaderRole } from './hooks.ts';

export function PlayArea() {
  const { client, live } = useGame();
  const role = useLeaderRole(client);
  const gold = useGameState(client, (s) => Math.floor(s.gold));
  const gems = useGameState(client, (s) => s.gems);
  const counter = useGameState(client, (s) => s.counter);
  const clicks = useGameState(client, (s) => s.clicks);
  const auto = useGameState(client, (s) => s.upgrades.auto);
  const clickLvl = useGameState(client, (s) => s.upgrades.click);
  const perClick = useGameState(client, (s) => clickValue(s));
  const perTick = useGameState(client, (s) => autoPerTick(s));
  const cosmetics = useGameState(client, (s) => s.cosmetics.join(','));
  const rateRaw = live?.flags?.['idle.rate'];
  const rate = typeof rateRaw === 'number' && rateRaw > 0 ? rateRaw : 1;
  const perSec = perTick * TPS * rate;
  const readOnly = role !== 'leader';
  const theme = live?.flags?.['ui.theme'];
  return (
    <section
      className="panel play"
      data-testid="play-area"
      data-theme={typeof theme === 'string' ? theme : 'classic'}
    >
      <h2>Play</h2>
      <div className="readouts">
        <span>
          Gold <b data-testid="gold">{gold}</b>
        </span>
        <span>
          Gems <b data-testid="gems">{gems}</b>
        </span>
        <span>
          Counter <b data-testid="counter">{counter}</b>
        </span>
        <span>
          Clicks <b data-testid="clicks">{clicks}</b>
        </span>
      </div>
      <button
        className="big"
        data-testid="click"
        disabled={readOnly}
        onClick={() => client.dispatch({ type: 'click' })}
      >
        Click (+{perClick})
      </button>
      <p className="muted">
        Production{' '}
        <b data-testid="production">
          {perSec} gold/s <span data-testid="idle-rate">×{rate}</span>
        </b>
      </p>
      <div className="row">
        <button
          data-testid="buy-auto"
          disabled={readOnly || gold < upgradeCost('auto', auto)}
          onClick={() => client.dispatch({ type: 'buy', upgrade: 'auto' })}
        >
          Auto-clicker (lvl <span data-testid="auto-level">{auto}</span>) —{' '}
          {upgradeCost('auto', auto)} gold
        </button>
        <button
          data-testid="buy-click"
          disabled={readOnly || gold < upgradeCost('click', clickLvl)}
          onClick={() => client.dispatch({ type: 'buy', upgrade: 'click' })}
        >
          Click power (lvl <span data-testid="click-level">{clickLvl}</span>) —{' '}
          {upgradeCost('click', clickLvl)} gold
        </button>
      </div>
      {cosmetics ? (
        <p className="muted" data-testid="cosmetics">
          Cosmetics: {cosmetics}
        </p>
      ) : null}
      {readOnly ? (
        <p className="muted" data-testid="follower-note">
          This tab is read-only; another tab is playing.
        </p>
      ) : null}
    </section>
  );
}
