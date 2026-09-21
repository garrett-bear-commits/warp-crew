import {
  ANIMATION_PROFILES,
  walkFrameDestination,
  walkFrameSource,
} from '../src/ui/crewAnimation.js';

const profile = ANIMATION_PROFILES.standard_humanoid;
const expectedRows = { down: 0, left: 1, right: 2, up: 3 };

for (const [direction, row] of Object.entries(expectedRows)) {
  for (let frame = 0; frame < 8; frame++) {
    const source = walkFrameSource(direction, frame, profile);
    if (source.sy !== row * 96 + 12) {
      throw new Error(`${direction} row ${source.sy}`);
    }
    if (source.sx !== (frame % 4) * 96 + 24) {
      throw new Error(`${direction} frame ${frame}`);
    }
    if (source.sx + source.sw > 384 || source.sy + source.sh > 384) {
      throw new Error(`${direction}/${frame} crop outside sheet`);
    }
  }
}

const destination = walkFrameDestination(100, 200, profile, 52);
if (destination.height !== 52 || destination.width !== 52 * 48 / 72) {
  throw new Error('display dimensions');
}
if (Math.abs(destination.x + profile.footAnchor.x * destination.scale - 100) > 0.001) {
  throw new Error('foot x moved');
}
if (Math.abs(destination.y + profile.footAnchor.y * destination.scale - 200) > 0.001) {
  throw new Error('foot y moved');
}
if (profile.displayHeight < 44) throw new Error('phone sprite too small');

console.log('crew_animation.test.mjs OK');
