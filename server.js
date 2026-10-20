'use strict';

/*
 * Celestial Crash Online — server-authoritative automatic battle core v1
 *
 * Clients select a character and join a queue. This server owns movement,
 * attacks, projectile collisions, health, deaths, timers, and match results.
 * Clients may render snapshots, but client-supplied combat snapshots/results
 * are rejected. Ranked modes remain unrated previews until identity, rating
 * persistence, reconnect recovery, and further validation are implemented.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25_000;
const TICK_MS = 50;                 // 20 authoritative simulation ticks/sec
const SNAPSHOT_MS = 50;              // 20 state snapshots/sec
const MAX_QUEUE_PER_MODE = 300;
const MAX_FIGHTERS = 4;
const FIGHTER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
// Keep in sync with the 57 character IDs in CelestialCrash_Online_Prototype.html.
const FIGHTER_IDS = new Set([
  'aquarius','archivist','aries','blackhole','cancer','capricorn','ceres','chatgpt',
  'chrono','cinder','claude','comet','dola','earth','eidolon','focalors','fourthwall',
  'frostwisp','gemini','grok','jupiter','leo','libra','lovers','lunar','magnetar',
  'manacle','mars','mercury','metaai','mimic','moonbeam','nebula','neptune','nullity',
  'pebble','perplexity','photon','pisces','pluto','pulsar','quasar','sagittarius','saturn',
  'scorpio','seraphim','siren','solarflare','stardust','taurus','tidal','uranus','venus',
  'virgo','voidbloom','whitehole','zapmoth'
]);
const ARENA = Object.freeze({ x: 45, y: 45, w: 630, h: 630 });
const FIGHTER_R = 22;
const START_HP = 390;

const MODES = Object.freeze({
  classic_1v1: { label: 'Classic 1v1', players: 2, teams: 'versus', ranked: false },
  classic_2v2: { label: 'Classic 2v2', players: 4, teams: 'duos', ranked: false },
  classic_ffa4: { label: 'Classic 1v1v1v1', players: 4, teams: 'free-for-all', ranked: false },
  ranked_1v1: { label: 'Ranked 1v1', players: 2, teams: 'versus', ranked: true },
  ranked_2v2: { label: 'Ranked 2v2', players: 4, teams: 'duos', ranked: true }
});

// These are combat *profiles*, not a port of every bespoke offline ability.
// They provide distinct server-owned attack patterns while preserving the
// existing client renderer and keeping combat authoritative in Node.
const MELEE = new Set([
  'solarflare', 'photon', 'comet', 'lunar', 'magnetar',
  'aries', 'taurus', 'leo', 'scorpio', 'capricorn'
]);
const RANGED_VISUALS = Object.freeze({
  blackhole: 'voidbolt', solarflare: 'sunshot', photon: 'prism', nebula: 'spore',
  comet: 'meteor', chrono: 'chrono', lunar: 'moonshard', quasar: 'lance',
  pulsar: 'pulsarorb', voidbloom: 'seed', fourthwall: 'cursor', tidal: 'bubble',
  siren: 'echo', magnetar: 'lance', mimic: 'crystalshard', archivist: 'starfolio',
  gemini: 'zp', cancer: 'zp', virgo: 'zp', libra: 'zp', sagittarius: 'zp',
  aquarius: 'zp', pisces: 'zp'
});

const queues = new Map(Object.keys(MODES).map((mode) => [mode, []]));
const rooms = new Map();
const clients = new Map();

function queuedCount() {
  let total = 0;
  for (const q of queues.values()) total += q.length;
  return total;
}
function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/' || url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      service: 'celestial-crash-online',
      stage: 'server-authoritative-combat-v1',
      engineVersion: 'server-auto-battle-core-v1',
      queuedPlayers: queuedCount(),
      activeRooms: rooms.size,
      connectedPlayers: clients.size,
      supportedModes: Object.keys(MODES),
      simulationHz: Math.round(1000 / TICK_MS),
      snapshotsHz: Math.round(1000 / SNAPSHOT_MS),
      rankedRated: false,
      note: 'The server owns combat state and results. Clients are visual renderers. Ranked queues remain unrated previews. This core uses server-side general combat profiles; the full bespoke offline ability simulation is not yet parity-matched.'
    });
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204); res.end(); return;
  }
  json(res, 404, { error: 'not_found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function send(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify({ type, ...payload })); } catch { /* close event performs cleanup */ }
}
function sendError(ws, code, message) { send(ws, 'error', { code, message }); }
function sendRoom(room, type, payload = {}) {
  for (const player of room.players) send(player.ws, type, payload);
}
function removeFromQueues(player) {
  for (const queue of queues.values()) {
    const i = queue.indexOf(player);
    if (i >= 0) queue.splice(i, 1);
  }
  player.queuedMode = null;
}
function resetRoomPlayer(player) {
  player.room = null;
  player.fighterId = null;
  player.mode = null;
  player.queuedMode = null;
  player.team = null;
  player.playerIndex = null;
}
function leaveRoom(player, reason = 'player_left') {
  const room = player.room;
  if (!room || room.ended) return;
  room.ended = true;
  rooms.delete(room.id);
  for (const other of room.players) {
    if (other !== player) {
      send(other.ws, 'opponent_left', { reason, roomId: room.id, playerId: player.id });
    }
    resetRoomPlayer(other);
  }
}
function isEnemy(a, b, room) {
  if (!a || !b || a.uid === b.uid || a.dead || b.dead) return false;
  if (MODES[room.mode].teams === 'duos') return a.team !== b.team;
  return true;
}
function nearestEnemy(fighter, room) {
  let best = null, bestD = Infinity;
  for (const other of room.sim.fighters) {
    if (!isEnemy(fighter, other, room)) continue;
    const d = Math.hypot(other.x - fighter.x, other.y - fighter.y);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best ? { fighter: best, distance: bestD } : null;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function seededJitter() { return (Math.random() * 2 - 1); }
function emitEvent(room, type, payload = {}) {
  room.sim.eventSeq += 1;
  room.sim.events.push({ seq: room.sim.eventSeq, type, ...payload });
  if (room.sim.events.length > 80) room.sim.events.splice(0, room.sim.events.length - 80);
}
function capTeamShield(fighter) { fighter.shield = clamp(fighter.shield, 0, fighter.id === 'magnetar' ? 32 : 26); }

function initialPosition(player, mode, count) {
  if (count === 2) {
    return { x: ARENA.x + ARENA.w * (player.playerIndex === 0 ? 0.27 : 0.73), y: ARENA.y + ARENA.h * (player.playerIndex === 0 ? 0.47 : 0.53) };
  }
  if (mode.endsWith('_2v2')) {
    const left = player.team === 0;
    const seat = player.playerIndex % 2 === 0 ? -0.14 : 0.14;
    return { x: ARENA.x + ARENA.w * (left ? 0.27 : 0.73), y: ARENA.y + ARENA.h * (0.5 + seat) };
  }
  const angle = -Math.PI / 2 + player.playerIndex * Math.PI * 2 / count;
  const radius = Math.min(ARENA.w, ARENA.h) * 0.285;
  return { x: ARENA.x + ARENA.w / 2 + Math.cos(angle) * radius, y: ARENA.y + ARENA.h / 2 + Math.sin(angle) * radius };
}
function makeSimFighter(player, room) {
  const pos = initialPosition(player, room.mode, room.players.length);
  const angle = Math.random() * Math.PI * 2;
  const speed = 124 + Math.random() * 12;
  const melee = MELEE.has(player.fighterId);
  return {
    uid: crypto.randomUUID(), playerId: player.id, playerIndex: player.playerIndex,
    fighterId: player.fighterId, id: player.fighterId, team: player.team,
    x: pos.x, y: pos.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: FIGHTER_R, hp: START_HP, maxHp: START_HP, shield: 0, age: 0, anim: Math.random() * 10,
    dead: false, koTime: 0, attackCD: 1.1 + Math.random() * 0.35,
    skillCD: [2.4 + Math.random() * 0.6, 4.8 + Math.random() * 0.7, 7.0 + Math.random() * 0.8, 14.5 + Math.random()],
    contactCD: 0.45, hitFlash: 0, invuln: 0, stun: 0, burn: 0, rooted: 0, slow: 0,
    energy: 0, lastDir: player.team % 2 === 0 ? 1 : -1,
    melee, attackStyle: RANGED_VISUALS[player.fighterId] || 'starbolt',
    passiveTicks: 0, projectileCount: 0, markTarget: 0, dash: 0
  };
}
function makeRoom(players, mode) {
  const room = {
    id: crypto.randomUUID(), seed: crypto.randomBytes(4).readUInt32BE(0), mode,
    label: MODES[mode].label, players, createdAt: Date.now(), lastSnapshotAt: 0,
    ended: false, phase: 'battle', sim: { elapsed: 0, impacts: 0, seq: 0, eventSeq: 0, fighters: [], projectiles: [], events: [] }
  };
  players.forEach((player, playerIndex) => {
    player.room = room; player.mode = mode; player.playerIndex = playerIndex;
    player.team = MODES[mode].teams === 'duos' ? (playerIndex < 2 ? 0 : 1) : playerIndex;
  });
  room.sim.fighters = players.map((p) => makeSimFighter(p, room));
  rooms.set(room.id, room);
  const roster = room.sim.fighters.map((fighter) => ({
    playerId: fighter.playerId, playerIndex: fighter.playerIndex, team: fighter.team,
    fighterId: fighter.fighterId, uid: fighter.uid
  }));
  for (const player of players) {
    send(player.ws, 'match_found', {
      roomId: room.id, playerId: player.id, playerIndex: player.playerIndex,
      playerCount: players.length, team: player.team, mode, label: room.label,
      seed: room.seed, authority: false, phase: 'battle', simulation: 'server'
    });
  }
  sendRoom(room, 'battle_ready', {
    roomId: room.id, mode, label: room.label, seed: room.seed,
    authorityId: null, simulation: 'server', players: roster,
    playerCount: roster.length, rated: false,
    note: 'The server simulates combat. Clients only render the state.'
  });
  // Make a first snapshot immediately so both clients begin from the same state.
  broadcastSnapshot(room, true);
}
function enqueue(player, mode, fighterId) {
  if (player.room) { sendError(player.ws, 'already_in_room', 'Leave your current match before searching again.'); return; }
  if (!Object.hasOwn(MODES, mode)) { sendError(player.ws, 'invalid_mode', 'Choose a supported Celestial Crash online mode.'); return; }
  if (typeof fighterId !== 'string' || !FIGHTER_ID_RE.test(fighterId) || !FIGHTER_IDS.has(fighterId)) {
    sendError(player.ws, 'invalid_fighter_id', 'Choose a character from the Celestial Crash roster before searching.'); return;
  }
  if (player.queuedMode) {
    if (player.queuedMode === mode && queues.get(mode).includes(player)) {
      send(player.ws, 'queue_status', { queued: true, mode, position: queues.get(mode).indexOf(player) + 1, neededPlayers: MODES[mode].players });
      return;
    }
    removeFromQueues(player);
  }
  const queue = queues.get(mode);
  if (queue.length >= MAX_QUEUE_PER_MODE) { sendError(player.ws, 'queue_full', 'This mode is temporarily full. Try again shortly.'); return; }
  player.mode = mode; player.queuedMode = mode; player.fighterId = fighterId;
  queue.push(player);
  send(player.ws, 'queue_status', { queued: true, mode, position: queue.length, neededPlayers: MODES[mode].players });
  while (queue.length >= MODES[mode].players) {
    const matched = [];
    while (matched.length < MODES[mode].players && queue.length) {
      const candidate = queue.shift();
      if (candidate && candidate.ws.readyState === WebSocket.OPEN && candidate.queuedMode === mode && !candidate.room) {
        candidate.queuedMode = null; matched.push(candidate);
      }
    }
    if (matched.length === MODES[mode].players) makeRoom(matched, mode);
    else break;
  }
}

function dealDamage(room, target, rawDamage, source, reason = 'projectile') {
  if (!target || target.dead || target.invuln > 0) return 0;
  if (source && !isEnemy(source, target, room)) return 0;
  let damage = Math.max(0, rawDamage);
  if (target.id === 'blackhole') damage *= 0.9;
  if (target.id === 'quasar' && target.shield > 0) damage *= 0.92;
  if (target.id === 'chrono' && Math.random() < 0.08) {
    emitEvent(room, 'dodge', { targetUid: target.uid, x: target.x, y: target.y });
    return 0;
  }
  if (target.shield > 0) {
    const blocked = Math.min(target.shield, damage);
    target.shield -= blocked; damage -= blocked;
  }
  target.hp = Math.max(0, target.hp - damage);
  target.hitFlash = 0.18;
  target.energy = Math.min(100, target.energy + rawDamage * 0.25);
  target.passiveTicks += 1;
  room.sim.impacts += 1;
  if (source && source.id === 'magnetar' && reason === 'melee') source.shield = Math.min(32, source.shield + 1.25);
  if (source && source.id === 'solarflare') target.burn = Math.max(target.burn, 1.1);
  if (source && source.id === 'comet') { target.vx += (target.x - source.x) * 0.45; target.vy += (target.y - source.y) * 0.45; }
  emitEvent(room, 'hit', {
    ownerUid: source?.uid || null, targetUid: target.uid, x: target.x, y: target.y,
    damage: Math.round((rawDamage - (target.shield > 0 ? 0 : 0)) * 10) / 10,
    reason
  });
  if (target.hp <= 0) {
    target.dead = true; target.koTime = 0;
    emitEvent(room, 'ko', { ownerUid: source?.uid || null, targetUid: target.uid, x: target.x, y: target.y });
  }
  capTeamShield(target);
  if (source) capTeamShield(source);
  return damage;
}
function fireProjectile(room, source, target, skillIndex = null) {
  const dx = target.x - source.x, dy = target.y - source.y;
  const d = Math.hypot(dx, dy) || 1;
  const skill = skillIndex !== null;
  const speed = skill ? 315 : 260;
  const proj = {
    uid: crypto.randomUUID(), owner: source.uid, target: target.uid,
    x: source.x + dx / d * (source.r + 7), y: source.y + dy / d * (source.r + 7),
    vx: dx / d * speed, vy: dy / d * speed, r: skill ? 7 : 5,
    damage: skill ? (skillIndex === 3 ? 26 : 13 + skillIndex * 1.4) : (source.melee ? 10 : 7.5),
    age: 0, life: 1.65, type: source.attackStyle, rot: Math.atan2(dy, dx),
    skillIndex, team: source.team, trail: []
  };
  room.sim.projectiles.push(proj);
  emitEvent(room, skill ? 'skill' : 'attack', {
    ownerUid: source.uid, targetUid: target.uid, x: source.x, y: source.y,
    targetX: target.x, targetY: target.y, skillIndex,
    projectileType: proj.type
  });
}
function directStrike(room, source, target, skillIndex = null) {
  const skill = skillIndex !== null;
  const dx = target.x - source.x, dy = target.y - source.y;
  const d = Math.hypot(dx, dy) || 1;
  const damage = skill ? (skillIndex === 3 ? 28 : 14 + skillIndex * 1.2) : (source.id === 'comet' ? 13 : source.id === 'photon' || source.id === 'lunar' ? 11 : source.id === 'magnetar' ? 12 : 10);
  if (skill && skillIndex === 3) {
    // Server-authored ultimate: bounded burst radius centered on the target.
    emitEvent(room, 'ultimate', { ownerUid: source.uid, targetUid: target.uid, x: target.x, y: target.y, skillIndex });
    for (const fighter of room.sim.fighters) {
      if (isEnemy(source, fighter, room) && Math.hypot(fighter.x - target.x, fighter.y - target.y) < 115) {
        dealDamage(room, fighter, damage, source, 'ultimate');
      }
    }
  } else {
    dealDamage(room, target, damage, source, skill ? 'skill' : 'melee');
  }
  const knockback = source.id === 'comet' ? 62 : 40;
  target.vx += dx / d * knockback; target.vy += dy / d * knockback;
  emitEvent(room, skill ? 'skill' : 'attack', {
    ownerUid: source.uid, targetUid: target.uid, x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2, skillIndex
  });
}
function stepFighter(room, f, dt) {
  if (f.dead) { f.koTime += dt; return; }
  f.age += dt; f.anim += dt * 5;
  f.hitFlash = Math.max(0, f.hitFlash - dt);
  f.invuln = Math.max(0, f.invuln - dt);
  f.stun = Math.max(0, f.stun - dt);
  f.slow = Math.max(0, f.slow - dt);
  f.rooted = Math.max(0, f.rooted - dt);
  f.attackCD -= dt; f.contactCD = Math.max(0, f.contactCD - dt);
  f.markTarget = Math.max(0, f.markTarget - dt);
  f.burn -= dt;
  if (f.burn > 0 && Math.random() < dt * 2) dealDamage(room, f, 1.1, room.sim.fighters.find(q => q.id === 'solarflare' && !q.dead && isEnemy(q, f, room)) || null, 'burn');
  f.shield = Math.max(0, f.shield - dt * 2.2);
  if (f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + dt * 0.18);
  const mult = f.stun > 0 ? 0.2 : f.rooted > 0 ? 0.4 : f.slow > 0 ? 0.68 : 1;
  f.x += f.vx * dt * mult; f.y += f.vy * dt * mult;
  const left = ARENA.x + f.r, right = ARENA.x + ARENA.w - f.r;
  const top = ARENA.y + f.r, bottom = ARENA.y + ARENA.h - f.r;
  if (f.x < left) { f.x = left; f.vx = Math.abs(f.vx) * 0.985; f.lastDir = 1; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y }); }
  else if (f.x > right) { f.x = right; f.vx = -Math.abs(f.vx) * 0.985; f.lastDir = -1; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y }); }
  if (f.y < top) { f.y = top; f.vy = Math.abs(f.vy) * 0.985; }
  else if (f.y > bottom) { f.y = bottom; f.vy = -Math.abs(f.vy) * 0.985; }
  const speed = Math.hypot(f.vx, f.vy);
  if (speed < 82) { const a = Math.atan2(f.vy || seededJitter(), f.vx || seededJitter()); f.vx = Math.cos(a) * 90; f.vy = Math.sin(a) * 90; }
  if (speed > 225) { f.vx = f.vx / speed * 225; f.vy = f.vy / speed * 225; }

  const nearest = nearestEnemy(f, room);
  if (!nearest) return;
  const target = nearest.fighter, distance = nearest.distance;
  // Attacks are automatic and server-timed; client frame-rate cannot affect them.
  if (f.attackCD <= 0) {
    f.attackCD = (f.melee ? 1.0 : 1.25) + Math.random() * 0.22;
    if (f.melee) {
      if (distance <= f.r + target.r + 32) directStrike(room, f, target, null);
      else if (Math.random() < 0.35) fireProjectile(room, f, target, 0);
    } else {
      fireProjectile(room, f, target, null);
    }
  }
  for (let i = 0; i < f.skillCD.length; i++) {
    f.skillCD[i] -= dt;
    if (f.skillCD[i] <= 0) {
      const base = [3.3, 5.0, 6.6, 14.8][i];
      f.skillCD[i] = base + Math.random() * (i === 3 ? 1.4 : 0.9);
      if (i === 3) {
        if (distance < 360) {
          if (f.melee && distance < 160) directStrike(room, f, target, 3);
          else fireProjectile(room, f, target, 3);
        }
      } else if (distance < (i === 2 ? 330 : 420)) {
        if (f.melee && distance < 100) directStrike(room, f, target, i);
        else fireProjectile(room, f, target, i);
      }
      // One cast per server tick keeps work bounded.
      break;
    }
  }
  if (f.id === 'magnetar' && distance < 90 && f.shield < 32) f.shield = Math.min(32, f.shield + dt * 1.0);
  if (f.id === 'voidbloom' && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + dt * 0.28);
  capTeamShield(f);
}
function stepProjectiles(room, dt) {
  const kept = [];
  for (const proj of room.sim.projectiles) {
    proj.age += dt; proj.x += proj.vx * dt; proj.y += proj.vy * dt;
    proj.trail.push({ x: proj.x, y: proj.y }); if (proj.trail.length > 6) proj.trail.shift();
    const target = room.sim.fighters.find((f) => f.uid === proj.target);
    const source = room.sim.fighters.find((f) => f.uid === proj.owner);
    if (target && source && isEnemy(source, target, room) && Math.hypot(target.x - proj.x, target.y - proj.y) < target.r + proj.r + 4) {
      dealDamage(room, target, proj.damage, source, proj.skillIndex === null ? 'projectile' : 'skill');
      if (target.id === 'blackhole') proj.age = proj.life;
      if (proj.age < proj.life) emitEvent(room, 'impact', { ownerUid: source.uid, targetUid: target.uid, x: proj.x, y: proj.y });
      continue;
    }
    if (proj.age < proj.life && proj.x >= ARENA.x - 60 && proj.x <= ARENA.x + ARENA.w + 60 && proj.y >= ARENA.y - 60 && proj.y <= ARENA.y + ARENA.h + 60) kept.push(proj);
  }
  room.sim.projectiles = kept;
}
function stepCollisions(room) {
  const list = room.sim.fighters;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.dead || b.dead) continue;
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
      const min = a.r + b.r;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d, overlap = min - d;
      a.x -= nx * overlap * 0.51; a.y -= ny * overlap * 0.51;
      b.x += nx * overlap * 0.51; b.y += ny * overlap * 0.51;
      const av = a.vx * nx + a.vy * ny, bv = b.vx * nx + b.vy * ny, relative = av - bv;
      if (relative > 0) {
        a.vx += (bv - av) * nx; b.vx += (av - bv) * nx;
        a.vy += (bv - av) * ny; b.vy += (av - bv) * ny;
      }
      const hitSpeed = Math.max(0, relative);
      if (hitSpeed > 8 && isEnemy(a, b, room) && (a.contactCD <= 0 || b.contactCD <= 0)) {
        a.contactCD = b.contactCD = 0.48;
        const damage = 6 + Math.min(11, hitSpeed * 0.052);
        dealDamage(room, a, damage * 0.82, b, 'collision');
        dealDamage(room, b, damage * 0.82, a, 'collision');
        emitEvent(room, 'collision', { ownerUid: a.uid, targetUid: b.uid, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      for (const f of [a, b]) {
        f.x = clamp(f.x, ARENA.x + f.r, ARENA.x + ARENA.w - f.r);
        f.y = clamp(f.y, ARENA.y + f.r, ARENA.y + ARENA.h - f.r);
      }
    }
  }
}
function determineWinner(room) {
  const alive = room.sim.fighters.filter((f) => !f.dead && f.hp > 0);
  const aliveTeams = new Set(alive.map((f) => f.team));
  if (MODES[room.mode].teams === 'duos') {
    if (aliveTeams.size <= 1) return { fighter: alive.sort((a, b) => b.hp - a.hp)[0] || null, team: alive[0]?.team ?? null };
    return null;
  }
  if (alive.length <= 1) return { fighter: alive[0] || null, team: alive[0]?.team ?? null };
  return null;
}
function finishRoom(room, winner) {
  if (room.ended) return;
  room.ended = true; room.phase = 'completed';
  const result = {
    roomId: room.id, mode: room.mode, label: room.label,
    winnerPlayerId: winner?.fighter?.playerId || null,
    winnerTeam: Number.isInteger(winner?.team) ? winner.team : null,
    duration: Math.round(room.sim.elapsed * 10) / 10,
    rated: false,
    note: MODES[room.mode].ranked
      ? 'Ranked preview: ratings are not recorded. Competitive ranking is not enabled yet.'
      : 'Winner calculated by the server-authoritative combat core.'
  };
  for (const player of room.players) send(player.ws, 'match_result', result);
  rooms.delete(room.id);
  for (const player of room.players) resetRoomPlayer(player);
}
function publicFighter(f) {
  return {
    uid: f.uid, playerId: f.playerId, playerIndex: f.playerIndex, id: f.id,
    team: f.team, x: f.x, y: f.y, vx: f.vx, vy: f.vy, r: f.r,
    hp: f.hp, maxHp: f.maxHp, shield: f.shield, age: f.age, anim: f.anim,
    dead: f.dead, koTime: f.koTime, attackCD: f.attackCD, hitFlash: f.hitFlash,
    invuln: f.invuln, stun: f.stun, slow: f.slow, rooted: f.rooted,
    energy: f.energy, lastDir: f.lastDir, markTarget: f.markTarget
  };
}
function publicProjectile(p) {
  return {
    uid: p.uid, owner: p.owner, target: p.target, x: p.x, y: p.y,
    vx: p.vx, vy: p.vy, r: p.r, damage: p.damage, age: p.age, life: p.life,
    type: p.type, rot: p.rot, skillIndex: p.skillIndex, trail: p.trail.slice(-6)
  };
}
function broadcastSnapshot(room, force = false) {
  if (room.ended) return;
  const now = Date.now();
  if (!force && now - room.lastSnapshotAt < SNAPSHOT_MS) return;
  room.lastSnapshotAt = now;
  room.sim.seq += 1;
  const snapshot = {
    seq: room.sim.seq, elapsed: room.sim.elapsed, gameTime: room.sim.elapsed,
    impacts: room.sim.impacts, gameOver: false, matchStarted: true,
    fighters: room.sim.fighters.map(publicFighter),
    projectiles: room.sim.projectiles.slice(-70).map(publicProjectile),
    events: room.sim.events.slice(-80)
  };
  sendRoom(room, 'battle_snapshot', { roomId: room.id, snapshot });
}
function tickRoom(room, dt) {
  if (room.ended) return;
  room.sim.events = [];
  room.sim.elapsed += dt;
  for (const fighter of room.sim.fighters) stepFighter(room, fighter, dt);
  stepCollisions(room);
  stepProjectiles(room, dt);

  // A server-controlled overtime ramp prevents stalemates.
  if (room.sim.elapsed > 75) {
    const overtimeDps = 4 + (room.sim.elapsed - 75) * 3.5;
    for (const fighter of room.sim.fighters) {
      if (fighter.dead) continue;
      fighter.hp = Math.max(0, fighter.hp - overtimeDps * dt);
      if (fighter.hp <= 0) {
        fighter.dead = true;
        emitEvent(room, 'ko', { targetUid: fighter.uid, x: fighter.x, y: fighter.y, reason: 'overtime' });
      }
    }
  }
  const winner = determineWinner(room);
  if (winner) {
    // Send the final visual state before announcing the server-owned outcome.
    broadcastSnapshot(room, true);
    finishRoom(room, winner);
    return;
  }
  broadcastSnapshot(room);
}

wss.on('connection', (ws) => {
  const player = { id: crypto.randomUUID(), ws, room: null, fighterId: null, mode: null, queuedMode: null, team: null, playerIndex: null };
  clients.set(ws, player); ws.isAlive = true;
  send(ws, 'connected', { playerId: player.id, protocolVersion: 3, modes: Object.keys(MODES), simulation: 'server' });
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { sendError(ws, 'invalid_json', 'Send a valid JSON message.'); return; }
    if (!message || typeof message.type !== 'string') { sendError(ws, 'invalid_message', 'Every message must include a type.'); return; }
    switch (message.type) {
      case 'ping': send(ws, 'pong', { at: Date.now() }); break;
      case 'find_match': enqueue(player, message.mode, message.fighterId); break;
      case 'cancel_queue':
        removeFromQueues(player); send(player.ws, 'queue_status', { queued: false }); break;
      case 'leave_room':
        removeFromQueues(player); leaveRoom(player, 'player_left'); send(ws, 'left_room', {}); break;
      case 'battle_snapshot':
      case 'report_result':
        sendError(ws, 'server_authoritative', 'Combat snapshots and match results are calculated by the server and cannot be submitted by clients.');
        break;
      default: sendError(ws, 'unknown_message_type', `Unsupported message type: ${message.type}`);
    }
  });
  ws.on('close', () => {
    removeFromQueues(player); leaveRoom(player, 'opponent_disconnected'); clients.delete(ws);
  });
  ws.on('error', () => {});
});

let lastTickAt = Date.now();
const simulation = setInterval(() => {
  const now = Date.now();
  const dt = clamp((now - lastTickAt) / 1000, 0.001, 0.12);
  lastTickAt = now;
  // Copy the room list because a completed room is removed during a tick.
  for (const room of [...rooms.values()]) {
    try { tickRoom(room, dt); }
    catch (err) {
      console.error('Room simulation failed:', room.id, err?.stack || err);
      finishRoom(room, null);
    }
  }
}, TICK_MS);
simulation.unref();

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Celestial Crash server-authoritative core listening on 0.0.0.0:${PORT}`);
});
function shutdown() {
  clearInterval(heartbeat); clearInterval(simulation);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
