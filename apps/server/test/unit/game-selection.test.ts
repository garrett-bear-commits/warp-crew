import { describe, expect, it } from 'vitest';
import { selectGame } from '../../src/games.ts';

describe('Jest deployment game selection', () => {
  it('keeps the exact token audience while GAME_CONFIG selects the rules', () => {
    const audience = '01a0aefd-c256-77ed-81e3-4b67d1f0c6c0';
    const deployed = selectGame(audience, 'template');
    const local = selectGame('template');
    expect(deployed.game.gameId).toBe(audience);
    expect(deployed.policy).toBe(local.policy);
    expect({ ...deployed.game, gameId: 'template' }).toEqual(local.game);
    expect(local.game.gameId).toBe('template');
    expect(selectGame('idle-civ').game.gameId).toBe('idle-civ');
    expect(() => selectGame(audience)).toThrow('unknown game config');
    expect(() => selectGame(audience, 'unknown')).toThrow('unknown game config');
  });
});
