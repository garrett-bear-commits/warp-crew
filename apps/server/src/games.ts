// games/<id>/ registry: GAME_ID selects the config + policy (ADR-003: configuration only).
import type { GameConfig, GamePolicy } from '@foundation/server';
import { idleCivGame } from '../games/idle-civ/game.config.ts';
import { idleCivPolicy } from '../games/idle-civ/policy.ts';
import { templateGame } from '../games/template/game.config.ts';
import { templatePolicy } from '../games/template/policy.ts';

export const GAMES: Record<string, { game: GameConfig; policy: GamePolicy }> = {
  template: { game: templateGame, policy: templatePolicy },
  'idle-civ': { game: idleCivGame, policy: idleCivPolicy },
};

export function selectGame(gameId: string): { game: GameConfig; policy: GamePolicy } {
  const g = GAMES[gameId];
  if (!g) throw new Error(`unknown GAME_ID ${gameId}; known: ${Object.keys(GAMES).join(', ')}`);
  return g;
}
