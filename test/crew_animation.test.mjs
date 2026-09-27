import {
  ANIMATION_PROFILES,
  crewPoseForActor,
  motionPolicy,
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

const actor = { x: 50, y: 40, dir: 'down', frame: 0, state: 'walk' };
const expectedFoot = { x: 195, y: 240 };
for (const direction of ['down', 'left', 'right', 'up']) {
  for (const state of ['walk', 'idle', 'doing']) {
    for (let frame = 0; frame < 4; frame++) {
      const pose = crewPoseForActor(
        { ...actor, dir: direction, frame, state },
        390,
        600,
        profile
      );
      if (pose.foot.x !== expectedFoot.x || pose.foot.y !== expectedFoot.y) {
        throw new Error(`${direction}/${state}/${frame} moved feet to ${pose.foot.x},${pose.foot.y}`);
      }
      const anchoredX = pose.destination.x + profile.footAnchor.x * pose.destination.scale;
      const anchoredY = pose.destination.y + profile.footAnchor.y * pose.destination.scale;
      if (
        Math.abs(anchoredX - expectedFoot.x) > 0.001
        || Math.abs(anchoredY - expectedFoot.y) > 0.001
      ) {
        throw new Error(`${direction}/${state}/${frame} destination is not grounded`);
      }
    }
  }
}

const normalMotion = motionPolicy(false);
if (!normalMotion.animateFrames || !normalMotion.thrusterParticles) {
  throw new Error('normal motion disabled');
}
const reducedMotion = motionPolicy(true);
if (reducedMotion.animateFrames || reducedMotion.thrusterParticles) {
  throw new Error('reduced motion still decorative');
}

console.log('crew_animation.test.mjs OK');
