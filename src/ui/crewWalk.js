// @ts-nocheck
import { ROOMS, SPARROW_LAYOUT, HULL_PX, homeRoomId, ROOM_GRAPH, THRUSTERS } from '../data/starterShip.js';
import { findPath, isWalkablePct, clampWalkable, nearestWalkableInRoom } from '../data/navGrid.js';
import { routeToWorkAnchor } from '../data/shipRoutes.js';
import { normalizeAssignments, STATIONS } from '../systems/stations.js';
import { walkAssetFor, preloadCrewRig } from './crewArt.js';
import { advanceCrewAnimation, crewPoseForActor, facingForMove, motionPolicy } from './crewAnimation.js';
import { onTick } from './stageLoop.js';

const agents = new Map();
let canvas = null;
let ctx = null;
let w = 0;
let h = 0;
let clock = 0;
let started = false;
let battle = false;
let reducedMotion = false;
let motionQuery = null;
let activeDeparture = null;
const arrivals = new Map();
const particles = [];

const WALK_SPEED = 9;
const ARRIVE = 1.2;

const readyForShipTask = (crew) => !['expedition', 'injured', 'reserve'].includes(crew.status);

export function crewTargetStates(player, {
  departingCrewInstanceIds = [],
  reducedMotion: immediate = false,
} = {}) {
  const crew = player?.crew || [];
  if (departingCrewInstanceIds.length) {
    const byId = new Map(crew.map((member) => [member.instanceId, member]));
    return departingCrewInstanceIds.filter((id) => byId.has(id)).map((crewInstanceId) => ({
      crewInstanceId,
      mode: 'expedition-departure',
      roomId: 'cargo',
      anchors: [
        { ...SPARROW_LAYOUT.anchors.cargoDeparture },
        { ...SPARROW_LAYOUT.anchors.airlock },
      ],
      immediate,
    }));
  }
  const assignments = normalizeAssignments(player);
  const onDuty = crew.filter(readyForShipTask);
  const contractStage = ['briefing', 'choice'].includes(player?.activeContract?.stage);
  const legacyRooms = ['bridge', 'engineering'];
  const occupied = new Set(onDuty.map(member => STATIONS[assignments[member.instanceId]]?.roomId).filter(Boolean));
  const boarders = player?.activeEncounter && !player.activeEncounter.result ? player.activeEncounter.boarders : null;
  // The defender stays one beat after the fight so the win is visible in the room.
  const defending = boarders?.defenderId && (boarders.phase === 'aboard'
    || (boarders.phase === 'repelled' && player.activeEncounter.beat <= boarders.repelledBeat + 1));
  const repelRoom = defending ? STATIONS[boarders.target]?.roomId : null;
  // FTL-lite fights: crew stand in whichever room the fight engine has them in.
  const ftl = player?.activeEncounter?.version === 3 && !player.activeEncounter.result ? player.activeEncounter : null;
  if (ftl) {
    return onDuty.flatMap((member, index) => {
      const fighter = ftl.crew.find(c => c.id === member.instanceId);
      const roomId = STATIONS[ftl.intent?.moves?.[member.instanceId] || fighter?.room]?.roomId;
      const room = ROOMS.find((candidate) => candidate.id === roomId);
      if (!room) return [];
      const sameRoom = ftl.crew.filter(c => c.room === fighter.room);
      const slot = Math.max(0, sameRoom.findIndex(c => c.id === member.instanceId));
      return { crewInstanceId: member.instanceId, mode: 'contract-station', roomId: room.id,
        anchors: [{ x: room.workAnchor.x - slot * 3, y: room.workAnchor.y + (slot % 2 ? 2 : 0) }], immediate };
    });
  }
  return onDuty.flatMap((member) => {
    if (repelRoom && member.instanceId === boarders.defenderId) {
      const room = ROOMS.find((candidate) => candidate.id === repelRoom);
      return {
        crewInstanceId: member.instanceId,
        mode: 'repel-boarders',
        roomId: room.id,
        anchors: [{ x: room.workAnchor.x - 3, y: room.workAnchor.y }],
        immediate,
      };
    }
    let roomId = STATIONS[assignments[member.instanceId]]?.roomId;
    if (!roomId && contractStage) {
      roomId = legacyRooms.find(id => !occupied.has(id));
      if (roomId) occupied.add(roomId);
    }
    if (!roomId) return [];
    const room = ROOMS.find((candidate) => candidate.id === roomId);
    return {
      crewInstanceId: member.instanceId,
      mode: 'contract-station',
      roomId: room.id,
      anchors: [{ ...room.workAnchor }],
      immediate,
    };
  });
}

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pickTask(a) {
  if (battle) return a.home;
  const opts = (ROOM_GRAPH[a.room] || ROOMS.map((r) => r.id)).filter((id) => id !== a.room);
  if (!opts.length) return a.home;
  const i = Math.floor((hash01(a.id + String(clock | 0)) + a.jitter) * opts.length) % opts.length;
  return opts[i];
}

function spawn(crew) {
  const home = homeRoomId(crew.role);
  const pos = nearestWalkableInRoom(home, hash01(crew.instanceId));
  const jitter = hash01(crew.instanceId);
  const a = {
    id: crew.instanceId,
    templateId: crew.templateId,
    role: crew.role,
    bodyFamily: crew.bodyFamily || 'standard_humanoid',
    home,
    room: home,
    x: pos.x,
    y: pos.y,
    dir: jitter > 0.5 ? 'right' : 'left',
    face: jitter > 0.5 ? 'right' : 'left',
    state: 'idle',
    atWork: false,
    clip: 'idle',
    path: [],
    timer: 0.4 + jitter * 1.8,
    jitter,
    frame: 0,
    assignment: null,
    authoredTarget: null,
  };
  agents.set(a.id, a);
  return a;
}

function beginWalk(a, destId) {
  const route = routeToWorkAnchor({ x: a.x, y: a.y, room: a.room }, destId);
  if (!route.ok) {
    console.warn('[crew-route]', a.id, route.reason);
    a.path = [];
    a.state = 'idle';
    a.timer = 1.1 + a.jitter;
    return;
  }
  a.path = route.points;
  a.state = 'walk';
  a.timer = 0;
}

// Stationed crew run the work loop; crew visiting another room stand idle.
function atWorkFor(a) {
  const job = a.assignment || '';
  if (job.startsWith('expedition-departure') || job.startsWith('crew-arrival') || job === 'departure-complete') return false;
  if (job.startsWith('contract-station') || job.startsWith('repel-boarders') || job.startsWith('hostile')) return true;
  return a.room === a.home;
}

function settle(a, timer) {
  a.state = 'doing';
  a.timer = timer;
  a.atWork = atWorkFor(a);
}

function assignmentKey(target) {
  return `${target.mode}:${target.roomId}:${target.immediate ? 'immediate' : 'animated'}`;
}

function finishDepartureActor(a) {
  if (!activeDeparture?.pending.has(a.id)) return;
  a.assignment = 'departure-complete';
  a.authoredTarget = null;
  activeDeparture.pending.delete(a.id);
  if (activeDeparture.pending.size) return;
  const done = activeDeparture.onDone;
  activeDeparture = null;
  done?.();
}

function finishAuthoredActor(a) {
  finishDepartureActor(a);
  if (!arrivals.has(a.id)) return;
  const done = arrivals.get(a.id);
  arrivals.delete(a.id);
  a.assignment = null;
  a.authoredTarget = null;
  settle(a, 3);
  done?.();
}

function beginAuthoredTarget(a, target) {
  a.assignment = assignmentKey(target);
  a.authoredTarget = target;
  const final = target.anchors.at(-1);
  const route = routeToWorkAnchor({ x: a.x, y: a.y, room: a.room }, target.roomId);
  if (!route.ok) {
    console.warn('[crew-route]', a.id, route.reason);
    a.path = [];
    settle(a, Infinity);
    finishAuthoredActor(a);
    return;
  }
  const pts = [...route.points];
  let previous = pts.at(-1) || a;
  for (const anchor of target.anchors) {
    const segment = findPath(previous.x, previous.y, anchor.x, anchor.y, { strict: true });
    let before = previous;
    const valid = segment?.length && segment.every((point) => {
      const steps = Math.max(2, Math.ceil(Math.hypot(point.x - before.x, point.y - before.y) * 4));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!isWalkablePct(before.x + (point.x - before.x) * t, before.y + (point.y - before.y) * t)) return false;
      }
      before = point;
      return true;
    });
    if (!valid) {
      console.warn('[crew-route]', a.id, 'disconnected');
      a.path = [];
      settle(a, Infinity);
      finishAuthoredActor(a);
      return;
    }
    pts.push(...segment.map((point) => ({ ...point, room: target.roomId })));
    pts.push({ ...anchor, room: target.roomId, via: 'authored-anchor' });
    previous = anchor;
  }
  if (target.immediate) {
    a.x = final.x;
    a.y = final.y;
    a.room = target.roomId;
    a.path = [];
    settle(a, Infinity);
    a.frame = 0;
    return;
  }
  a.path = pts;
  if (pts.length) {
    a.state = 'walk';
    a.timer = 0;
  } else settle(a, Infinity);
}

function faceFrom(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy) * 0.85) return dx < 0 ? 'left' : 'right';
  if (Math.abs(dy) < 0.04) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

function stepAgent(a, dt, animateFrames = true) {
  stepMotion(a, dt);
  advanceCrewAnimation(a, dt, animateFrames);
}

function stepMotion(a, dt) {
  if (a.state === 'idle') {
    a.timer -= dt;
    if (a.timer <= 0) beginWalk(a, pickTask(a));
    return;
  }
  if (a.state === 'doing') {
    if (a.assignment) return;
    a.timer -= dt;
    if (a.timer <= 0) {
      const goHome = a.room !== a.home && a.jitter + (clock % 3) * 0.1 > 0.55;
      beginWalk(a, goHome || battle ? a.home : pickTask(a));
    }
    return;
  }

  const tgt = a.path[0];
  if (!tgt) {
    settle(a, a.assignment ? Infinity : battle ? 3.2 : 1.8 + a.jitter * 2.0);
    finishAuthoredActor(a);
    return;
  }
  const d = dist(a, tgt);
  if (d <= ARRIVE) {
    a.x = tgt.x;
    a.y = tgt.y;
    if (tgt.via === 'door-enter') a.room = tgt.room;
    a.path.shift();
    if (!a.path.length) {
      settle(a, a.assignment ? Infinity : battle ? 3.2 : 1.8 + a.jitter * 2.0);
      finishAuthoredActor(a);
    }
    return;
  }
  const ux = (tgt.x - a.x) / d;
  const uy = (tgt.y - a.y) / d;
  const step = Math.min(d, WALK_SPEED * dt);
  const nx = a.x + ux * step;
  const ny = a.y + uy * step;
  const clamped = clampWalkable(nx, ny);
  a.x = clamped.x;
  a.y = clamped.y;
  a.dir = faceFrom(ux, uy);
  a.face = facingForMove(a.face, ux, uy);
}

function resize() {
  if (!canvas) return;
  // The canvas lives inside the already transformed hull-sized world layer.
  // Its bitmap must use world pixels; measuring the transformed rect applies
  // the camera scale to crew and thrusters a second time.
  w = HULL_PX.w;
  h = HULL_PX.h;
  if (canvas.width === w && canvas.height === h && ctx) return;
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
}

function spawnThrust(dt) {
  const rate = battle ? 60 : 30;
  for (const t of THRUSTERS) {
    const size = t.size || 1;
    const n = rate * size * dt;
    const count = (n | 0) + (n - (n | 0) > Math.random() ? 1 : 0);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: t.x + (Math.random() - 0.5) * 2.4 * size,
        y: t.y + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (14 + Math.random() * 16) * (0.7 + size * 0.3),
        life: 0.22 + Math.random() * 0.28,
        max: 0.5,
        size,
        hot: Math.random() < 0.55,
      });
    }
  }
}

function drawThrusters(g, dt, policy) {
  if (policy.thrusterParticles) spawnThrust(dt);
  else particles.length = 0;
  const flicker = policy.thrusterParticles
    ? 0.82 + Math.sin(clock * 31) * 0.08 + Math.sin(clock * 17.3) * 0.1
    : 0.9;
  const boost = battle ? 1.25 : 1;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const t of THRUSTERS) {
    const size = (t.size || 1) * (w / 390);
    const px = (t.x / 100) * w;
    const py = (t.y / 100) * h;
    const halfW = 13 * size;
    const len = 46 * size * flicker * boost;
    // Soft bloom that sits on the nozzle lip.
    const bloom = g.createRadialGradient(px, py, 0, px, py, halfW * 2.4);
    bloom.addColorStop(0, `rgba(150,225,255,${0.5 * flicker})`);
    bloom.addColorStop(0.5, `rgba(60,150,255,${0.18 * flicker})`);
    bloom.addColorStop(1, 'rgba(40,90,255,0)');
    g.fillStyle = bloom;
    g.beginPath();
    g.ellipse(px, py + halfW * 0.3, halfW * 2.4, halfW * 1.6, 0, 0, Math.PI * 2);
    g.fill();
    // Outer plume.
    const outer = g.createLinearGradient(px, py, px, py + len);
    outer.addColorStop(0, `rgba(110,200,255,${0.75 * flicker})`);
    outer.addColorStop(0.45, `rgba(70,120,255,${0.35 * flicker})`);
    outer.addColorStop(1, 'rgba(90,60,255,0)');
    g.fillStyle = outer;
    g.beginPath();
    g.moveTo(px - halfW, py);
    g.quadraticCurveTo(px - halfW * 0.9, py + len * 0.45, px, py + len);
    g.quadraticCurveTo(px + halfW * 0.9, py + len * 0.45, px + halfW, py);
    g.closePath();
    g.fill();
    // White-hot core.
    const coreLen = len * 0.55;
    const core = g.createLinearGradient(px, py, px, py + coreLen);
    core.addColorStop(0, `rgba(255,255,255,${0.95 * flicker})`);
    core.addColorStop(0.5, `rgba(190,240,255,${0.6 * flicker})`);
    core.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = core;
    g.beginPath();
    g.moveTo(px - halfW * 0.45, py);
    g.quadraticCurveTo(px - halfW * 0.35, py + coreLen * 0.5, px, py + coreLen);
    g.quadraticCurveTo(px + halfW * 0.35, py + coreLen * 0.5, px + halfW * 0.45, py);
    g.closePath();
    g.fill();
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    const a = p.life / p.max;
    const scale = w / 390;
    g.fillStyle = p.hot ? `rgba(200,240,255,${a * 0.8})` : `rgba(90,140,255,${a * 0.6})`;
    const sz = (1 + a * 2) * scale * (0.6 + p.size * 0.4);
    g.fillRect((p.x / 100) * w - sz / 2, (p.y / 100) * h, sz, sz);
  }
  g.restore();
}

// Raider colours: the frame is tinted blood-red only where the sprite has pixels.
let raiderCanvas = null;
function raiderFrame(image, source) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  raiderCanvas ||= document.createElement('canvas');
  if (raiderCanvas.width !== source.sw || raiderCanvas.height !== source.sh) {
    raiderCanvas.width = source.sw;
    raiderCanvas.height = source.sh;
  }
  const t = raiderCanvas.getContext?.('2d');
  if (!t) return null;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, source.sw, source.sh);
  t.imageSmoothingEnabled = false;
  t.drawImage(image, source.sx, source.sy, source.sw, source.sh, 0, 0, source.sw, source.sh);
  t.globalCompositeOperation = 'source-atop';
  t.fillStyle = 'rgba(200,20,20,0.5)';
  t.fillRect(0, 0, source.sw, source.sh);
  return raiderCanvas;
}

function drawAgent(g, a, animate = true) {
  const asset = walkAssetFor(a.templateId, a.role);
  const profile = asset.profile;
  const pose = crewPoseForActor(a, w, h, profile, { animate });
  const { foot, source, destination } = pose;
  const image = asset.images[pose.clip] || asset.images.idle || asset.images.walk;
  g.__wcActorInstanceId = a.id;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(
    foot.x,
    foot.y + profile.shadow.offsetY,
    profile.shadow.width / 2,
    profile.shadow.height / 2,
    0,
    0,
    Math.PI * 2
  );
  g.fill();
  if (a.hostile) {
    g.strokeStyle = 'rgba(255,80,70,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(foot.x, foot.y + profile.shadow.offsetY, profile.shadow.width / 2 + 3, profile.shadow.height / 2 + 2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  const frame = image && a.hostile ? raiderFrame(image, source) : null;
  if (image) {
    g.imageSmoothingEnabled = false;
    const src = frame || image;
    const [sx, sy] = frame ? [0, 0] : [source.sx, source.sy];
    if (pose.flip) {
      g.translate(destination.x + destination.width, destination.y);
      g.scale(-1, 1);
      g.drawImage(src, sx, sy, source.sw, source.sh, 0, 0, destination.width, destination.height);
    } else {
      g.drawImage(src, sx, sy, source.sw, source.sh, destination.x, destination.y, destination.width, destination.height);
    }
  }
  g.restore();
  g.__wcActorInstanceId = null;
}

function tick(sim, dt) {
  if (!canvas || !ctx || !w) return;
  if (!canvas.isConnected) return;
  if (!reducedMotion) clock += sim;
  const policy = motionPolicy(reducedMotion);
  // Authored station/departure snaps are applied when their state changes.
  // Ambient walking and separation nudges are purely decorative.
  if (!reducedMotion) for (const a of agents.values()) stepAgent(a, sim, policy.animateFrames);
  const list = [...agents.values()];
  for (let i = 0; !reducedMotion && i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if ([a, b].some(actor => actor.assignment?.startsWith('expedition-departure') || actor.assignment?.startsWith('crew-arrival') || actor.assignment === 'departure-complete')) continue;
      const d = dist(a, b);
      if (d < 4 && d > 0.01) {
        const push = ((4 - d) / 4) * 0.28;
        const sx = (a.x - b.x) / d;
        const ac = clampWalkable(a.x + sx * push, a.y);
        const bc = clampWalkable(b.x - sx * push, b.y);
        a.x = ac.x;
        b.x = bc.x;
      }
    }
  }
  const g = ctx;
  g.clearRect(0, 0, w, h);
  list.sort((p, q) => p.y - q.y);
  for (const a of list) drawAgent(g, a, policy.animateFrames);
  drawThrusters(g, dt, policy);
}

function setReducedMotion(event) {
  const next = Boolean(event?.matches);
  reducedMotion = next;
  if (next) {
    particles.length = 0;
    const departureIds = activeDeparture ? [...activeDeparture.pending] : [];
    for (const id of departureIds) {
      const a = agents.get(id);
      if (a?.authoredTarget) beginAuthoredTarget(a, { ...a.authoredTarget, immediate: true });
    }
    for (const a of agents.values()) {
      if ((a.assignment?.startsWith('contract-station') || a.assignment?.startsWith('crew-arrival')) && a.authoredTarget) {
        beginAuthoredTarget(a, { ...a.authoredTarget, immediate: true });
        if (arrivals.has(a.id)) finishAuthoredActor(a);
      }
    }
    for (const id of departureIds) {
      const a = agents.get(id);
      if (a) finishDepartureActor(a);
    }
    return;
  }
  for (const a of agents.values()) {
    if (!a.assignment?.startsWith('contract-station') || !a.authoredTarget) continue;
    a.authoredTarget = { ...a.authoredTarget, immediate: false };
    a.assignment = assignmentKey(a.authoredTarget);
  }
}

export function setBattleStations(on) {
  battle = Boolean(on);
  if (!battle) return;
  for (const a of agents.values()) {
    if (a.assignment?.startsWith('expedition-departure') || a.assignment === 'departure-complete' || a.assignment?.startsWith('crew-arrival')) continue;
    beginWalk(a, a.home);
  }
}

export function stopCrewSim() {
  canvas = null;
  ctx = null;
}

export function holdCrewForDeparture(crewInstanceIds) {
  for (const id of crewInstanceIds || []) {
    const a = agents.get(id);
    if (a) a.assignment = 'expedition-departure:held';
  }
}

/** Drop obsolete boarding animation without delivering its completion callback. */
export function cancelCrewDeparture() {
  activeDeparture = null;
  for (const a of agents.values()) {
    if (!a.assignment?.startsWith('expedition-departure') && a.assignment !== 'departure-complete') continue;
    a.assignment = null;
    a.authoredTarget = null;
    a.path = [];
    a.state = 'idle';
    a.timer = 0;
  }
}

export function holdCrewForArrival(player, crewInstanceId) {
  const member = player.crew.find(crew => crew.instanceId === crewInstanceId);
  if (!member) return;
  const actor = agents.get(crewInstanceId) || spawn(member);
  Object.assign(actor, SPARROW_LAYOUT.anchors.airlock, {
    room: 'cargo', path: [], state: 'doing', timer: Infinity,
    assignment: 'crew-arrival:held', authoredTarget: null, atWork: false,
  });
}

export function moveCrewToArrival(player, crewInstanceId, { onDone, reducedMotion: immediate = reducedMotion } = {}) {
  const actor = agents.get(crewInstanceId);
  if (!actor) { onDone?.(); return; }
  const room = ROOMS.find(candidate => candidate.id === 'weapons');
  arrivals.set(crewInstanceId, onDone);
  beginAuthoredTarget(actor, {
    crewInstanceId, mode: 'crew-arrival', roomId: room.id,
    anchors: [{ ...room.workAnchor }], immediate,
  });
  if (immediate) finishAuthoredActor(actor);
}

export function moveCrewToDeparture(player, crewInstanceIds, {
  reducedMotion: immediate = reducedMotion,
  onDone,
} = {}) {
  const targets = crewTargetStates(player, {
    departingCrewInstanceIds: crewInstanceIds,
    reducedMotion: immediate,
  });
  const visible = targets.filter((target) => agents.has(target.crewInstanceId));
  if (immediate) particles.length = 0;
  if (!visible.length) {
    onDone?.();
    return targets;
  }
  activeDeparture = {
    pending: new Set(visible.map((target) => target.crewInstanceId)),
    onDone,
  };
  for (const target of visible) beginAuthoredTarget(agents.get(target.crewInstanceId), target);
  if (immediate) {
    for (const target of visible) finishDepartureActor(agents.get(target.crewInstanceId));
  }
  return targets;
}

const RAIDER_LOOKS = ['merc_hex', 'merc_skarn', 'merc_vorn'];

/** Boarders are hostile actors that walk in from the airlock to the room they sabotage. */
function syncHostiles(player, live) {
  const encounter = player?.activeEncounter;
  const boarders = encounter && !encounter.result ? encounter.boarders : null;
  // v1 boarders count raiders; v3 boarders are one party shown as three raiders while it holds.
  const count = boarders?.phase === 'aboard' ? (encounter.version === 3 ? Math.max(1, Math.ceil(boarders.hp / 10)) : boarders.strength) : 0;
  const roomId = count ? STATIONS[encounter.version === 3 ? boarders.room : boarders.target]?.roomId : null;
  const room = ROOMS.find((candidate) => candidate.id === roomId);
  for (let i = 0; i < count && room; i++) {
    const id = `hostile:${i}`;
    live.add(id);
    let a = agents.get(id);
    if (!a) {
      const airlock = SPARROW_LAYOUT.anchors.airlock;
      a = {
        id, hostile: true, templateId: RAIDER_LOOKS[i % RAIDER_LOOKS.length], role: 'security', bodyFamily: 'standard_humanoid',
        home: 'cargo', room: 'cargo', x: airlock.x + i * 0.8, y: airlock.y, dir: 'right', face: 'right', state: 'idle',
        atWork: false, clip: 'idle', path: [], timer: 0, jitter: i / 3, frame: 0, assignment: null, authoredTarget: null,
      };
      agents.set(id, a);
    }
    const target = { crewInstanceId: id, mode: 'hostile', roomId: room.id,
      anchors: [{ x: room.workAnchor.x + 2 + i * 2, y: room.workAnchor.y + (i % 2 ? 2 : -1) }], immediate: reducedMotion };
    if (a.assignment !== assignmentKey(target)) beginAuthoredTarget(a, target);
  }
}

export function syncCrewLayer(el, player) {
  if (!el) return;
  if (el.tagName === 'CANVAS') {
    canvas = el;
    resize();
    if (!el._wcRo) {
      el._wcRo = new ResizeObserver(() => resize());
      el._wcRo.observe(el);
    }
  }
  const live = new Set();
  for (const c of player.crew || []) {
    const retainedDeparture = agents.get(c.instanceId)?.assignment?.startsWith('expedition-departure');
    if (c.status === 'expedition' && !retainedDeparture) continue;
    live.add(c.instanceId);
    if (!agents.has(c.instanceId)) spawn(c);
    const a = agents.get(c.instanceId);
    a.templateId = c.templateId;
    a.role = c.role;
    a.bodyFamily = c.bodyFamily || 'standard_humanoid';
    a.home = homeRoomId(c.role);
  }
  syncHostiles(player, live);
  for (const [id] of agents) {
    if (live.has(id)) continue;
    agents.delete(id);
  }
  preloadCrewRig([...agents.values()].map(a => a.templateId));
  if (!started && typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(motionQuery);
    motionQuery.addEventListener?.('change', setReducedMotion);
  }
  const targets = new Map(crewTargetStates(player, { reducedMotion }).map((target) => [target.crewInstanceId, target]));
  for (const [id, a] of agents) {
    if (a.assignment?.startsWith('expedition-departure') || a.assignment?.startsWith('crew-arrival')) continue;
    const target = targets.get(id);
    if (target && a.assignment !== assignmentKey(target)) beginAuthoredTarget(a, target);
    else if (!target && a.assignment?.startsWith('contract-station')) {
      a.assignment = null;
      a.authoredTarget = null;
      a.state = 'idle';
      a.timer = 0;
    }
  }
  if (!started) {
    started = true;
    onTick(tick);
    window.addEventListener('resize', resize);
  }
}
