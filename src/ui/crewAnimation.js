// @ts-nocheck
import { CREW_RIG } from '../data/crewRigManifest.js';

// Baked Sunnyside-rig sheets: one horizontal strip per clip, facing right.
// Left is a mirror; up/down movement keeps the last horizontal facing.
export const CREW_CLIPS = Object.freeze(Object.fromEntries(
  Object.entries(CREW_RIG.animations).map(([id, clip]) => [id, Object.freeze({ id, ...clip })])
));

export const ANIMATION_PROFILES = Object.freeze({
  crew_rig: Object.freeze({
    id: 'crew_rig',
    sourceCell: Object.freeze({ width: CREW_RIG.cell.w, height: CREW_RIG.cell.h }),
    footAnchor: Object.freeze({ x: CREW_RIG.footAnchor.x, y: CREW_RIG.footAnchor.y }),
    // World pixels per sheet pixel. The figure is ~34 sheet px tall, so ~102
    // world px: about 45% of a room's height, close to FTL's proportions.
    // Readable when zoomed in (~38 CSS px on a 390 px phone, the default in
    // fights); the whole-ship view is an overview.
    scale: 3,
    shadow: Object.freeze({ width: 48, height: 12, offsetY: 1 }),
    clips: CREW_CLIPS,
  }),
});

export function animationProfileFor() {
  return ANIMATION_PROFILES.crew_rig;
}

/** Walk while moving, work at a station, idle otherwise. */
export function crewClipForActor(actor) {
  if (actor?.state === 'walk') return 'walk';
  if (actor?.state === 'doing' && actor.atWork) return 'work';
  return 'idle';
}

/** Mirror only for leftward facing; vertical travel keeps the last side. */
export function facingForMove(previous, dx, dy) {
  if (Math.abs(dx) > 1e-4 && Math.abs(dx) >= 0.2 * Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return previous === 'left' ? 'left' : 'right';
}

/** Advance an actor's clip clock. Changing clip restarts it at frame 0. */
export function advanceCrewAnimation(actor, dt, animate = true, profile = animationProfileFor()) {
  const clip = crewClipForActor(actor);
  if (actor.clip !== clip) {
    actor.clip = clip;
    actor.frame = 0;
  }
  const spec = profile.clips[clip];
  actor.frame = animate ? (actor.frame + dt * spec.fps) % spec.frames : 0;
  return actor.frame;
}

export function crewFrameSource(clip, frame, profile = animationProfileFor()) {
  const spec = profile.clips[clip] || profile.clips.idle;
  const column = Math.max(0, Math.floor(frame)) % spec.frames;
  return {
    clip: spec.id,
    frame: column,
    sx: column * profile.sourceCell.width,
    sy: 0,
    sw: profile.sourceCell.width,
    sh: profile.sourceCell.height,
  };
}

export function crewFrameDestination(footX, footY, flip = false, profile = animationProfileFor(), scale = profile.scale) {
  const anchorX = flip ? profile.sourceCell.width - profile.footAnchor.x : profile.footAnchor.x;
  return {
    x: footX - anchorX * scale,
    y: footY - profile.footAnchor.y * scale,
    width: profile.sourceCell.width * scale,
    height: profile.sourceCell.height * scale,
    scale,
    flip,
  };
}

export function crewPoseForActor(actor, width, height, profile = animationProfileFor(), { animate = true } = {}) {
  const foot = {
    x: actor.x / 100 * width,
    y: actor.y / 100 * height,
  };
  const clip = crewClipForActor(actor);
  const source = crewFrameSource(clip, animate ? actor.frame || 0 : 0, profile);
  const flip = (actor.face || 'right') === 'left';
  const destination = crewFrameDestination(foot.x, foot.y, flip, profile);
  return { foot, clip, frame: source.frame, flip, source, destination };
}

export function motionPolicy(reduced = false) {
  return {
    animateFrames: !reduced,
    thrusterParticles: !reduced,
  };
}
