import assert from 'node:assert/strict';
import {
  ANIMATION_PROFILES,
  CREW_CLIPS,
  advanceCrewAnimation,
  crewClipForActor,
  crewFrameDestination,
  crewFrameSource,
  crewPoseForActor,
  facingForMove,
  motionPolicy,
} from '../src/ui/crewAnimation.js';
import { HULL_PX, SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { fightCamera } from '../src/ui/bridge.js';

const profile = ANIMATION_PROFILES.crew_rig;

// Sunnyside clip lengths: 8-frame walk, 9-frame idle, 8-frame doing loop.
assert.equal(CREW_CLIPS.walk.frames, 8);
assert.equal(CREW_CLIPS.idle.frames, 9);
assert.equal(CREW_CLIPS.work.frames, 8);
assert.ok(CREW_CLIPS.walk.fps >= 8, 'walk cycle must read as walking');

// Clip selection: moving walks, stationed works, everything else idles.
assert.equal(crewClipForActor({ state: 'walk', atWork: true }), 'walk');
assert.equal(crewClipForActor({ state: 'doing', atWork: true }), 'work');
assert.equal(crewClipForActor({ state: 'doing', atWork: false }), 'idle');
assert.equal(crewClipForActor({ state: 'idle' }), 'idle');

// Frames: every frame of every clip is a distinct full cell of its strip.
for (const [clip, spec] of Object.entries(CREW_CLIPS)) {
  const seen = new Set();
  for (let frame = 0; frame < spec.frames * 2; frame++) {
    const source = crewFrameSource(clip, frame + 0.4, profile);
    assert.equal(source.frame, frame % spec.frames);
    assert.equal(source.sx, (frame % spec.frames) * profile.sourceCell.width);
    assert.equal(source.sy, 0);
    assert.equal(source.sw, profile.sourceCell.width);
    assert.equal(source.sh, profile.sourceCell.height);
    seen.add(source.sx);
  }
  assert.equal(seen.size, spec.frames, `${clip} uses every frame`);
}

// Advancing: walk steps through frames; a clip change restarts at frame 0.
const walker = { state: 'walk', frame: 0 };
const frames = new Set();
for (let i = 0; i < 20; i++) frames.add(Math.floor(advanceCrewAnimation(walker, 0.05, true, profile)));
assert.ok(frames.size >= 6, 'one second of walking shows most of the cycle');
walker.state = 'doing';
walker.atWork = true;
advanceCrewAnimation(walker, 0, true, profile);
assert.equal(walker.clip, 'work');
assert.equal(walker.frame, 0);
const still = { state: 'walk', frame: 3 };
advanceCrewAnimation(still, 0.5, false, profile);
assert.equal(still.frame, 0, 'reduced motion holds frame 0');

// Facing: left mirrors, vertical travel keeps the last horizontal side.
assert.equal(facingForMove('right', -1, 0), 'left');
assert.equal(facingForMove('left', 1, 0.3), 'right');
assert.equal(facingForMove('left', 0, 1), 'left');
assert.equal(facingForMove('right', 0.01, -1), 'right');
assert.equal(facingForMove(undefined, 0, 1), 'right');

// Grounding: the foot anchor lands on the actor's foot, flipped or not.
for (const flip of [false, true]) {
  const d = crewFrameDestination(100, 200, flip, profile);
  const ax = flip ? profile.sourceCell.width - profile.footAnchor.x : profile.footAnchor.x;
  assert.ok(Math.abs(d.x + ax * d.scale - 100) < 1e-9, 'foot x');
  assert.ok(Math.abs(d.y + profile.footAnchor.y * d.scale - 200) < 1e-9, 'foot y');
  assert.equal(d.flip, flip);
}
const mid = profile.sourceCell.width / 2;
assert.ok(Math.abs(profile.footAnchor.x - mid) <= 1, 'body centred so a flip does not jump');

// Size: on the v4 Sparrow the figure (~34 of 56 cell px) is about a third of a
// room's height, the proportion the art was drawn for. Rooms are measured from
// the layout; the Bridge is a short strip, so the median room is the yardstick.
const figureWorld = 34 * profile.scale;
const roomHeights = SPARROW_LAYOUT.rooms.map(room => room.h / 100 * HULL_PX.h).sort((a, b) => a - b);
const medianRoom = roomHeights[Math.floor(roomHeights.length / 2)];
assert.ok(figureWorld >= 90 && figureWorld <= 115, `figure ${figureWorld}px`);
assert.ok(figureWorld / medianRoom >= 0.28 && figureWorld / medianRoom <= 0.4,
  `crew are about a third of a room tall (${figureWorld}/${medianRoom})`);
assert.ok(figureWorld < Math.min(...roomHeights) * 0.6, 'crew fit inside the shortest room');
// The bigger hull makes a zoomed-in fight show fewer CSS px per world px than
// the v3 hull did (390/1536 vs 390/1152), so the floor is ~29 CSS px, not 30.
const fightScale = fightCamera({ w: 390, h: 420 }).scale;
assert.ok(figureWorld * fightScale >= 29, `29+ CSS px in the zoomed-in fight view on a 390px phone (${(figureWorld * fightScale).toFixed(1)})`);

const actor = { x: 50, y: 40, face: 'right', frame: 0, state: 'walk' };
for (const face of ['left', 'right']) {
  for (const [state, atWork, clip] of [['walk', false, 'walk'], ['idle', false, 'idle'], ['doing', true, 'work'], ['doing', false, 'idle']]) {
    for (let frame = 0; frame < 9; frame++) {
      const pose = crewPoseForActor({ ...actor, face, frame, state, atWork }, 390, 600, profile);
      assert.equal(pose.clip, clip);
      assert.equal(pose.flip, face === 'left');
      assert.deepEqual(pose.foot, { x: 195, y: 240 });
      const ax = pose.flip ? profile.sourceCell.width - profile.footAnchor.x : profile.footAnchor.x;
      assert.ok(Math.abs(pose.destination.x + ax * pose.destination.scale - 195) < 1e-9);
      assert.ok(Math.abs(pose.destination.y + profile.footAnchor.y * pose.destination.scale - 240) < 1e-9);
      assert.equal(pose.frame, frame % CREW_CLIPS[clip].frames);
      const frozen = crewPoseForActor({ ...actor, face, frame, state, atWork }, 390, 600, profile, { animate: false });
      assert.equal(frozen.frame, 0, 'reduced motion draws frame 0');
    }
  }
}

const normalMotion = motionPolicy(false);
assert.ok(normalMotion.animateFrames && normalMotion.thrusterParticles, 'normal motion disabled');
const reducedMotion = motionPolicy(true);
assert.ok(!reducedMotion.animateFrames && !reducedMotion.thrusterParticles, 'reduced motion still decorative');

console.log('crew_animation.test.mjs OK');
