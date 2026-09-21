// @ts-nocheck

export const DIRECTION_ROW = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });

export const ANIMATION_PROFILES = Object.freeze({
  standard_humanoid: Object.freeze({
    id: 'standard_humanoid',
    sourceCell: Object.freeze({ width: 96, height: 96 }),
    frameCrop: Object.freeze({ x: 24, y: 12, width: 48, height: 72 }),
    footAnchor: Object.freeze({ x: 24, y: 66 }),
    displayHeight: 52,
    shadow: Object.freeze({ width: 18, height: 5, offsetY: 1 }),
    framesPerDirection: 4,
    fps: 7,
  }),
});

export function animationProfileFor(bodyFamily = 'standard_humanoid') {
  return ANIMATION_PROFILES[bodyFamily] || ANIMATION_PROFILES.standard_humanoid;
}

export function walkFrameSource(direction, frame, profile = animationProfileFor()) {
  const row = DIRECTION_ROW[direction] ?? DIRECTION_ROW.down;
  const column = Math.floor(frame) % profile.framesPerDirection;
  return {
    sx: column * profile.sourceCell.width + profile.frameCrop.x,
    sy: row * profile.sourceCell.height + profile.frameCrop.y,
    sw: profile.frameCrop.width,
    sh: profile.frameCrop.height,
  };
}

export function walkFrameDestination(
  footX,
  footY,
  profile = animationProfileFor(),
  displayHeight = profile.displayHeight
) {
  const scale = displayHeight / profile.frameCrop.height;
  return {
    x: footX - profile.footAnchor.x * scale,
    y: footY - profile.footAnchor.y * scale,
    width: profile.frameCrop.width * scale,
    height: displayHeight,
    scale,
  };
}

export function crewPoseForActor(actor, width, height, profile = animationProfileFor()) {
  const foot = {
    x: actor.x / 100 * width,
    y: actor.y / 100 * height,
  };
  const source = walkFrameSource(
    actor.dir,
    actor.state === 'walk' ? actor.frame : 0,
    profile
  );
  const destination = walkFrameDestination(foot.x, foot.y, profile);
  return { foot, source, destination };
}

export function motionPolicy(reduced = false) {
  return {
    animateFrames: !reduced,
    thrusterParticles: !reduced,
  };
}
