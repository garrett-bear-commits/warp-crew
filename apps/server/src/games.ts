// games/<id>/ registry: GAME_CONFIG (default GAME_ID) selects the config + policy (ADR-003:
// configuration only).
import type { GameConfig, GamePolicy } from '@foundation/server';
import { idleCivGame } from '../games/idle-civ/game.config.ts';
import { idleCivPolicy } from '../games/idle-civ/policy.ts';
import { templateGame } from '../games/template/game.config.ts';
import { templatePolicy } from '../games/template/policy.ts';
import { warpcrewGame } from '../games/warpcrew/game.config.ts';
import { warpcrewPolicy } from '../games/warpcrew/policy.ts';

export const GAMES: Record<string, { game: GameConfig; policy: GamePolicy }> = {
  template: { game: templateGame, policy: templatePolicy },
  'idle-civ': { game: idleCivGame, policy: idleCivPolicy },
  warpcrew: { game: warpcrewGame, policy: warpcrewPolicy },
};

/**
 * GAME_ID stays the exact signed Jest audience (a Jest game's id is a UUID); GAME_CONFIG selects
 * the app rules. Without GAME_CONFIG the GAME_ID names the rules, as before.
 */
export function selectGame(
  gameId: string,
  gameConfig = gameId,
): { game: GameConfig; policy: GamePolicy } {
  const g = GAMES[gameConfig];
  if (!g)
    throw new Error(`unknown game config ${gameConfig}; known: ${Object.keys(GAMES).join(', ')}`);
  return { game: { ...g.game, gameId }, policy: g.policy };
}
