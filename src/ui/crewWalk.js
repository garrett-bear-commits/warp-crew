// @ts-nocheck
import { ROOMS, SPARROW_LAYOUT, homeRoomId, ROOM_GRAPH, THRUSTERS, roomAtExact, pathRooms } from '../data/starterShip.js';
import { findPath, clampWalkable, nearestWalkableInRoom } from '../data/navGrid.js';
import { sheetFor, walkAssetFor, WALK_FRAMES } from './crewArt.js';
import { crewPoseForActor, motionPolicy } from './crewAnimation.js';
import { onTick } from './stageLoop.js';

const agents = new Map();
let canvas = null;
let ctx = null;
let w = 0;
let h = 0;
let dpr = 1;
let clock = 0;
let started = false;
let battle = false;
let reducedMotion = false;
let motionQuery = null;
let activeDeparture = null;
const particles = [];

const WALK_SPEED = 9;
const ARRIVE = 1.2;

const readyForShipTask = (crew) => !['expedition', 'injured', 'reserve'].includes(crew.status);

export function departureActionBlocked(action) {
  return ['exp-start', 'exp-launch', 'exp-claim', 'exp-skip', 'exp-abort'].includes(action);
}

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
  if (!['briefing', 'choice'].includes(player?.activeContract?.stage)) return [];
  const routeRooms = ['bridge', 'engineering'];
  return crew.filter(readyForShipTask).slice(0, routeRooms.length).map((member, index) => {
    const room = ROOMS.find((candidate) => candidate.id === routeRooms[index]);
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
    state: 'idle',
    path: [],
    timer: 0.4 + jitter * 1.8,
    jitter,
    frame: 0,
    fps: 7,
    assignment: null,
    authoredTarget: null,
  };
  agents.set(a.id, a);
  return a;
}

function appendPath(pts, x0, y0, x1, y1, roomHint, via = null) {
  const seg = findPath(x0, y0, x1, y1);
  for (const p of seg) {
    pts.push({ x: p.x, y: p.y, room: p.room || roomHint });
  }
  if (pts.length && via) {
    pts[pts.length - 1] = { ...pts[pts.length - 1], room: roomHint, via };
  }
}

function beginWalk(a, destId) {
  const dest = nearestWalkableInRoom(destId, a.jitter);
  const pts = [];
  let x = a.x;
  let y = a.y;
  let room = a.room;

  if (destId !== room) {
    const waypoints = pathRooms(room, destId);
    for (const waypoint of waypoints) {
      appendPath(pts, x, y, waypoint.x, waypoint.y, waypoint.room, waypoint.via);
      x = waypoint.x;
      y = waypoint.y;
      if (waypoint.via === 'door-enter') room = destId;
    }
  }
  appendPath(pts, x, y, dest.x, dest.y, destId);

  if (!pts.length) {
    a.state = 'idle';
    a.timer = 1.1 + a.jitter;
    return;
  }
  a.path = pts;
  a.state = 'walk';
  a.timer = 0;
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

function beginAuthoredTarget(a, target) {
  a.assignment = assignmentKey(target);
  a.authoredTarget = target;
  const final = target.anchors.at(-1);
  if (target.immediate) {
    a.x = final.x;
    a.y = final.y;
    a.room = target.roomId;
    a.path = [];
    a.state = 'doing';
    a.timer = Infinity;
    a.frame = 0;
    return;
  }

  const pts = [];
  let x = a.x;
  let y = a.y;
  if (a.room !== target.roomId) {
    for (const waypoint of pathRooms(a.room, target.roomId)) {
      appendPath(pts, x, y, waypoint.x, waypoint.y, waypoint.room, waypoint.via);
      x = waypoint.x;
      y = waypoint.y;
    }
  }
  for (const anchor of target.anchors) {
    appendPath(pts, x, y, anchor.x, anchor.y, target.roomId);
    pts.push({ ...anchor, room: target.roomId, via: 'authored-anchor' });
    x = anchor.x;
    y = anchor.y;
  }
  a.path = pts;
  a.state = pts.length ? 'walk' : 'doing';
  a.timer = pts.length ? 0 : Infinity;
}

function faceFrom(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy) * 0.85) return dx < 0 ? 'left' : 'right';
  if (Math.abs(dy) < 0.04) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

function stepAgent(a, dt, animateFrames = true) {
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
    a.state = 'doing';
    a.timer = a.assignment ? Infinity : battle ? 3.2 : 1.8 + a.jitter * 2.0;
    finishDepartureActor(a);
    return;
  }
  const d = dist(a, tgt);
  if (d <= ARRIVE) {
    a.x = tgt.x;
    a.y = tgt.y;
    if (tgt.via === 'door-enter') a.room = tgt.room;
    else a.room = tgt.room || roomAtExact(a.x, a.y)?.id || a.room;
    a.path.shift();
    if (!a.path.length) {
      a.state = 'doing';
      a.timer = a.assignment ? Infinity : battle ? 3.2 : 1.8 + a.jitter * 2.0;
      finishDepartureActor(a);
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
  a.frame = animateFrames ? (a.frame + dt * a.fps) % WALK_FRAMES : 0;
  a.room = roomAtExact(a.x, a.y)?.id || a.room;
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  w = Math.max(1, rect.width);
  h = Math.max(1, rect.height);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = (w * dpr) | 0;
  canvas.height = (h * dpr) | 0;
  ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
}

function spawnThrust(dt) {
  const rate = battle ? 70 : 38;
  for (const t of THRUSTERS) {
    const n = rate * dt;
    const extra = n - (n | 0) > Math.random() ? 1 : 0;
    const count = (n | 0) + extra;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: t.x + (Math.random() - 0.5) * 3.2,
        y: t.y + Math.random() * 1.2,
        vx: (Math.random() - 0.5) * 6,
        vy: 18 + Math.random() * 28,
        life: 0.28 + Math.random() * 0.35,
        max: 0.5,
        hue: Math.random() < 0.35 ? 190 : 28,
      });
    }
  }
}

function drawThrusters(g, dt, policy) {
  if (policy.thrusterParticles) spawnThrust(dt);
  else particles.length = 0;
  const pulse = policy.thrusterParticles ? 0.55 + Math.sin(clock * 14) * 0.25 : 0.7;
  for (const t of THRUSTERS) {
    const px = (t.x / 100) * w;
    const py = (t.y / 100) * h;
    const rad = g.createRadialGradient(px, py, 1, px, py + 10, 28);
    rad.addColorStop(0, `rgba(180,240,255,${0.55 * pulse})`);
    rad.addColorStop(0.35, `rgba(80,200,255,${0.28 * pulse})`);
    rad.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = rad;
    g.beginPath();
    g.ellipse(px, py + 8, 11, 22, 0, 0, Math.PI * 2);
    g.fill();
    const flame = g.createLinearGradient(px, py, px, py + 26);
    flame.addColorStop(0, `rgba(255,255,220,${0.7 * pulse})`);
    flame.addColorStop(0.4, `rgba(80,220,255,${0.45 * pulse})`);
    flame.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = flame;
    g.beginPath();
    g.moveTo(px - 4, py);
    g.lineTo(px + 4, py);
    g.lineTo(px + 1.5, py + 18 + pulse * 8);
    g.lineTo(px - 1.5, py + 18 + pulse * 8);
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
    const px = (p.x / 100) * w;
    const py = (p.y / 100) * h;
    g.fillStyle =
      p.hue > 100
        ? `rgba(120,230,255,${a * 0.7})`
        : `rgba(255,${160 + ((1 - a) * 60) | 0},60,${a})`;
    const sz = 1.2 + a * 2.2;
    g.fillRect(px, py, sz, sz);
  }
}

function drawAgent(g, a) {
  const asset = walkAssetFor(a.templateId, a.role, a.bodyFamily);
  const pose = crewPoseForActor(a, w, h, asset.profile);
  const { foot, source, destination } = pose;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(
    foot.x,
    foot.y + asset.profile.shadow.offsetY,
    asset.profile.shadow.width / 2,
    asset.profile.shadow.height / 2,
    0,
    0,
    Math.PI * 2
  );
  g.fill();

  if (asset.image && asset.image.complete && asset.image.naturalWidth) {
    g.imageSmoothingEnabled = false;
    g.drawImage(
      asset.image,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      destination.x,
      destination.y,
      destination.width,
      destination.height
    );
  } else {
    const sheet = sheetFor(a.templateId, a.role);
    if (sheet) {
      g.imageSmoothingEnabled = false;
      const iw = 32;
      g.drawImage(
        Object.assign(new Image(), { src: sheet.url }),
        0,
        0,
        iw,
        iw,
        destination.x,
        destination.y,
        destination.width,
        destination.height
      );
    } else {
      g.fillStyle = '#5ce1ff';
      g.fillRect(
        destination.x + destination.width * 0.28,
        destination.y + destination.height * 0.3,
        destination.width * 0.44,
        destination.height * 0.7
      );
    }
  }
  g.restore();
}

function tick(sim, dt) {
  if (!canvas || !ctx || !w) return;
  if (!canvas.isConnected) return;
  clock += sim;
  const policy = motionPolicy(reducedMotion);
  for (const a of agents.values()) stepAgent(a, sim, policy.animateFrames);
  const list = [...agents.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
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
  for (const a of list) drawAgent(g, a);
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
      if (a.assignment?.startsWith('contract-station') && a.authoredTarget) {
        beginAuthoredTarget(a, { ...a.authoredTarget, immediate: true });
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
  for (const a of agents.values()) beginWalk(a, a.home);
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
  for (const [id] of agents) {
    if (live.has(id)) continue;
    agents.delete(id);
  }
  if (!started && typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(motionQuery);
    motionQuery.addEventListener?.('change', setReducedMotion);
  }
  const targets = new Map(crewTargetStates(player, { reducedMotion }).map((target) => [target.crewInstanceId, target]));
  for (const [id, a] of agents) {
    if (a.assignment?.startsWith('expedition-departure')) continue;
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
