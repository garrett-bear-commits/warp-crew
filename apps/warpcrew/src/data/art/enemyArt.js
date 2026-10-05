// @ts-nocheck
// Enemy ship cutaways: which art each encounter uses and where its targetable rooms sit.
import layouts from './enemyLayouts.json' with { type: 'json' };
import { artUrl } from '../../shared/artUrl.js';

export const ENEMY_FAMILIES = Object.freeze(Object.keys(layouts).filter(key => key !== 'encounters'));

export function enemyArtFor(encounterId) {
  const family = layouts.encounters?.[encounterId] || 'pirate';
  const layout = layouts[family] || layouts.pirate;
  return {
    family,
    image: artUrl(layout.image),
    aspect: layout.sourceSize.width / layout.sourceSize.height,
    rooms: Object.fromEntries(layout.rooms.map(room => [room.id, { left: room.left, top: room.top, width: room.width, height: room.height }])),
    mounts: layout.mounts || [],
  };
}
