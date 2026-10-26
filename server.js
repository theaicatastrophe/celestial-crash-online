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
const SOURCE_RULES = require('./source_mechanics');
const { applyV45DamageHooks, applyV45OnHit } = require('./source_combat_hooks');
const createSourceAbilityEngine = require('./source_ability_engine');

const PORT = Number(process.env.PORT || 10000);
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 25_000;
const TICK_MS = 50;                 // 20 authoritative simulation ticks/sec
const SNAPSHOT_MS = 50;              // 20 state snapshots/sec
const MAX_QUEUE_PER_MODE = 300;
const MAX_FIGHTERS = 4;
const FIGHTER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
// Full source V45 roster supported by the online server.
const FIGHTER_IDS = new Set([
  'aquarius','archivist','aries','blackhole','cancer','capricorn','ceres','chatgpt',
  'chrono','cinder','claude','comet','dola','earth','eidolon','focalors','fourthwall',
  'frostwisp','gemini','grok','jupiter','leo','libra','lovers','lunar','magnetar',
  'manacle','mars','mercury','metaai','mimic','moonbeam','nebula','neptune','nullity',
  'pebble','perplexity','photon','pisces','pluto','pulsar','quasar','sagittarius','saturn',
  'scorpio','seraphim','siren','solarflare','stardust','taurus','tidal','uranus','venus',
  'virgo','voidbloom','whitehole','zapmoth','button','odette','steve'
]);
const ARENA = Object.freeze({ x: 45, y: 45, w: 630, h: 630 });
const FIGHTER_R = 22;
const START_HP = SOURCE_RULES.BASE_HP;

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
      stage: 'full-roster-source-engine-v1',
      engineVersion: 'server-source-ability-engine-v1',
      snapshotEffects: true,
      presentation: 'sfx-cast-fx-v1',
      queuedPlayers: queuedCount(),
      activeRooms: rooms.size,
      connectedPlayers: clients.size,
      supportedModes: Object.keys(MODES),
      simulationHz: Math.round(1000 / TICK_MS),
      snapshotsHz: Math.round(1000 / SNAPSHOT_MS),
      rankedRated: false,
      note: 'The server owns combat state and results. The source ability engine routes the V45 handler catalog for the full roster, with server-safe adapters for visual/audio-only helpers. Button retains its bespoke pilot. Verify character behavior in live matches; exact visual/parity validation is ongoing. Ranked queues remain unrated previews.'
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
function capTeamShield(fighter) { SOURCE_RULES.capShield(fighter); }

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
  const isButton = player.fighterId === 'button';
  const maxHp = SOURCE_RULES.maxHpFor(player.fighterId);
  const startHp = SOURCE_RULES.initialHpFor(player.fighterId);
  const skillCD = [1.9 + Math.random() * 0.4, 4.2 + Math.random() * 0.4, 6.8 + Math.random() * 0.4, 14.5 + Math.random()];
  return {
    uid: crypto.randomUUID(), playerId: player.id, playerIndex: player.playerIndex,
    fighterId: player.fighterId, id: player.fighterId, team: player.team,
    x: pos.x, y: pos.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: FIGHTER_R, hp: startHp, maxHp, shield: 0, age: 0, anim: Math.random() * 10, lastHitAt: 0, sourceHealSecond: -1, sourceHealApplied: 0, mirrorTimer: 0, sourceSustainSecond: -1, sourceSustainGiven: 0,
    dead: false, koTime: 0, attackCD: isButton ? 0.78 + (Math.random() * 0.14 - 0.06) : 1.25 + Math.random() * 0.15,
    // Match V45's shared makeFighter initial cooldown bands for all characters.
    skillCD, cooldowns: skillCD, sourceVariant: 0, odetteAct: 0, loversLead: 0, focalorsStage: 0, foForm: 0, stM: [0,0,0],
    srEye: [0,0,0], srEyeT: [0,0,0], srAbs: 0, srHoly: 0, srFly: null, eiIl: [], eiMg: [], eiMgT: 0, mcSeals: 5, mcBrk: [-99,-99,-99,-99,-99], mcUnr: 0, mcRecoil: 0, mcStrain: 0,
    contactCD: 0.45, hitFlash: 0, invuln: 0, stun: 0, burn: 0, rooted: 0, slow: 0,
    energy: 0, lastDir: player.team % 2 === 0 ? 1 : -1,
    melee, attackStyle: isButton ? 'button' : (RANGED_VISUALS[player.fighterId] || 'starbolt'),
    passiveTicks: 0, projectileCount: 0, markTarget: 0, dash: 0,
    ...(isButton ? {
      btLone: 0, btWatch: 0, btHitSrc: null, btHitD: 0, btHitT: -99, btLoneCD: 0,
      btCtr: 0, btCounter: null, btCast: 0, btUlt: 0, btUltAge: 0, btUltMax: 6.6,
      btUltPower: 1, btUltPins: null, btUltTick: 0, btUltBurstDone: false,
      btSmile: 1, btSmileT: 1, btSeed: Math.random() * 50, btAx: 0, btAy: 0,
      btPinX: pos.x, btPinY: pos.y, btStitch: null, btDecoy: null
    } : {})
  };
}
function makeRoom(players, mode) {
  const room = {
    id: crypto.randomUUID(), seed: crypto.randomBytes(4).readUInt32BE(0), mode,
    label: MODES[mode].label, players, createdAt: Date.now(), lastSnapshotAt: 0,
    ended: false, phase: 'battle', sim: { elapsed: 0, impacts: 0, seq: 0, eventSeq: 0, fighters: [], projectiles: [], events: [], sourceEffects: [], sourceDelayed: [], sourceTimeStop: {timer:0,owner:null,target:null,startedAt:0}, sourceFourthWall: {timer:0,x:0,y:0,side:4,owner:null} }
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
  // V45 Steve: tool tier and mining soften incoming damage.
  if (target.id === 'steve' && !target.twin) {
    if (target.stT >= 2) rawDamage *= target.stT >= 4 ? 0.86 : 0.93;
    if (target.svMine > 0) rawDamage *= 0.75;
  }

  // Preserve the Button source wrapper: it adjusts incoming raw damage before
  // the shared V10 damage pipeline applies source tuning and the global .68 factor.
  if (target.id === 'button') {
    rawDamage *= target.btUlt > 0 ? 0.4 : 0.94;
    if (source && isEnemy(source, target, room) && !['burn', 'passive', 'button_passive', 'button_counter'].includes(reason)) {
      const d = Math.hypot(source.x - target.x, source.y - target.y);
      target.btWatch = 2.4; target.btHitSrc = source.uid; target.btHitD = d; target.btHitT = room.sim.elapsed;
      if (!(target.btCtr > 0) && !(target.btUlt > 0) && d < 150 && reason !== 'ultimate') {
        target.btCtr = 1.6;
        target.btCounter = { targetUid: source.uid, x2: source.x, y2: source.y, dueAt: room.sim.elapsed + 0.05, done: false };
        emitEvent(room, 'button_fx', { ownerUid: target.uid, targetUid: source.uid, fx: 'counter_start', x: target.x, y: target.y, targetX: source.x, targetY: source.y });
      }
    }
  }

  // V45's final hurt chain: V10 source multipliers + .68 raw factor, ability
  // factor, then zHurt's defender passives, then the target's shield.
  if (source && rawDamage > 0) target.lastHitAt = room.sim.elapsed;
  let damage = SOURCE_RULES.scaleOutgoingDamage(rawDamage, source?.id, reason);

  if (target.id === 'blackhole') damage *= 0.9;
  if (target.id === 'quasar' && target.shield > 0) damage *= 0.92;
  if (target.id === 'pebble') damage *= 0.9;
  if (target.id === 'earth') {
    damage *= 0.93;
    if (source?.id === 'blackhole') damage *= 0.68;
  }
  if (target.id === 'jupiter') damage *= 0.86;
  if (target.id === 'neptune' && target.hp < target.maxHp * 0.45) damage *= 0.8;

  // Apply source V45's shared Zodiac hurt chain before shield absorption.
  // This preserves defensive order (including Libra's damage cap) and combat
  // passives without trusting client-reported damage or status state.
  const sourcePassive = applyV45DamageHooks({
    room, target, source, reason, damage,
    emit: (type, payload) => emitEvent(room, type, payload)
  });
  if (sourcePassive.dodged) return 0;
  damage = sourcePassive.damage;

  // Evasion passives are resolved by the server, never by client visuals.
  const dodgeChance = target.id === 'chrono' ? 0.14 : target.id === 'nebula' ? 0.12 : target.id === 'mercury' ? 0.04 : target.id === 'zapmoth' ? 0.06 : 0;
  if (dodgeChance && Math.random() < dodgeChance) {
    emitEvent(room, 'dodge', { targetUid: target.uid, x: target.x, y: target.y });
    return 0;
  }
  if (target.id === 'photon' && Math.random() < 0.12) {
    target.shield = Math.min(SOURCE_RULES.shieldCapFor('photon'), (target.shield || 0) + 2.6);
    capTeamShield(target);
    emitEvent(room, 'dodge', { targetUid: target.uid, x: target.x, y: target.y, passive: 'lightstep', shield: target.shield });
    return 0;
  }

  const shieldBefore = target.shield;
  if (target.shield > 0) {
    const blocked = Math.min(target.shield, damage);
    target.shield -= blocked;
    damage -= blocked;
  }
  // Offensive source passives (slow/burn) are also authoritative.
  applyV45OnHit({ target, source, reason });
  const hpBefore = target.hp;
  target.hp = Math.max(0, target.hp - Math.max(0, damage));
  const healthDamage = Math.max(0, hpBefore - target.hp);
  target.hitFlash = 0.18;
  target.energy = Math.min(100, target.energy + Math.max(0, damage) * 0.25);
  const passiveIndex = target.passiveTicks;
  target.passiveTicks += 1;
  room.sim.impacts += 1;

  // Source-backed defensive shield triggers from zHurt; cap enforcement is
  // then performed using the same character-specific V10 shield-cap table.
  if (target.id === 'stardust' && passiveIndex % 5 === 4) target.shield += 6;
  if (target.id === 'earth' && passiveIndex % 7 === 6) target.shield += 4;
  if (target.id === 'siren' && passiveIndex % 6 === 5) target.shield += 2;
  if (target.id === 'saturn' && passiveIndex % 4 === 3) target.shield += 12;

  if (source && source.id === 'magnetar' && reason === 'melee') source.shield = Math.min(SOURCE_RULES.shieldCapFor('magnetar'), (source.shield || 0) + 1.25);
  if (source && source.id === 'solarflare') target.burn = Math.max(target.burn || 0, 1.3);
  if (source && source.id === 'comet') { target.vx += (target.x - source.x) * 0.8; target.vy += (target.y - source.y) * 0.8; }
  if (target.id === 'mimic') target.mirrorTimer = Math.max(target.mirrorTimer || 0, 0.35);

  // Source sustain is based on actual HP damage after shielding, with the
  // original per-second cap and per-character heal scaling applied afterwards.
  if (healthDamage > 0 && source && !source.twin && !SOURCE_RULES.NO_SUSTAIN_REASONS.has(reason) && SOURCE_RULES.SUSTAIN[source.id]) {
    const second = Math.floor(room.sim.elapsed);
    if (source.sourceSustainSecond !== second) { source.sourceSustainSecond = second; source.sourceSustainGiven = 0; }
    const amount = Math.min(healthDamage * SOURCE_RULES.SUSTAIN[source.id], Math.max(0, 4.2 - (source.sourceSustainGiven || 0)));
    if (amount > 0) {
      source.sourceSustainGiven = (source.sourceSustainGiven || 0) + amount;
      SOURCE_RULES.applySourceHeal(source, amount, room.sim.elapsed);
    }
  }

  capTeamShield(target);
  if (source) capTeamShield(source);
  // V45 Steve: 20% chance to pick up a material whenever his hit lands.
  if (healthDamage > 0 && source && source.id === 'steve' && !source.dead && !source.twin && reason !== 'burn' && Math.random() < 0.2) {
    try { SOURCE_ABILITIES.steveMine(source, 1, null, target.x, target.y); } catch { /* cosmetic pickup only */ }
  }
  emitEvent(room, 'hit', {
    ownerUid: source?.uid || null, targetUid: target.uid, x: target.x, y: target.y,
    damage: Math.round(healthDamage * 10) / 10,
    absorbed: Math.round(Math.max(0, shieldBefore - target.shield) * 10) / 10,
    reason
  });
  if (target.hp <= 0) {
    target.dead = true; target.koTime = 0;
    emitEvent(room, 'ko', { ownerUid: source?.uid || null, targetUid: target.uid, x: target.x, y: target.y });
  }
  return healthDamage;
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
function buttonSpend(room, f) {
  const loneliness = f.btLone || 0;
  f.btLone = 0;
  const power = 1 + loneliness / 100 * 0.6;
  if (loneliness >= 20) emitEvent(room, 'button_fx', { ownerUid: f.uid, fx: 'loneliness_spent', x: f.x, y: f.y, loneliness, power });
  return power;
}
function buttonDeal(room, target, raw, source, reason) {
  // Offline hurt() scales raw attacks by 0.68 before applying defenses.
  return dealDamage(room, target, raw, source, reason);
}
function buttonEmitSkill(room, f, target, index, payload = {}) {
  const names = ['btS0', 'btS1', 'btS2', 'btS3'];
  emitEvent(room, 'button_ability', {
    ownerUid: f.uid, targetUid: target?.uid || null, skillIndex: index, ability: names[index],
    x: f.x, y: f.y, targetX: target?.x, targetY: target?.y, ...payload
  });
}
function buttonRangedAttack(room, f, target) {
  const dx = target.x - f.x, dy = target.y - f.y, d = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx), speed = 312 + Math.random() * 36;
  const proj = {
    uid: crypto.randomUUID(), owner: f.uid, target: target.uid,
    x: f.x + dx / d * (f.r + 5), y: f.y + dy / d * (f.r + 5),
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 5,
    damage: 3.2, age: 0, life: 1.7, type: 'button', s: 'button', rot: angle,
    skillIndex: null, team: f.team, trail: []
  };
  room.sim.projectiles.push(proj);
  emitEvent(room, 'attack', { ownerUid: f.uid, targetUid: target.uid, x: f.x, y: f.y, targetX: target.x, targetY: target.y, projectileType: 'button' });
}
function buttonBasicAttack(room, f, target, distance) {
  if (f.dead || target.dead || f.attackCD > 0 || f.btUlt > 0) return;
  f.attackCD = 0.78 + (Math.random() * 0.14 - 0.06);
  f.btCast = Math.max(f.btCast || 0, 0.22);
  const angle = Math.atan2(target.y - f.y, target.x - f.x);
  if (distance < 120) {
    emitEvent(room, 'button_ability', { ownerUid: f.uid, targetUid: target.uid, ability: 'btpoke', x: f.x, y: f.y, angle, range: f.r + 58 });
    for (const foe of room.sim.fighters) {
      if (!isEnemy(f, foe, room)) continue;
      const d = Math.hypot(foe.x - f.x, foe.y - f.y);
      const a = Math.atan2(foe.y - f.y, foe.x - f.x) - angle;
      const da = Math.atan2(Math.sin(a), Math.cos(a));
      if (d >= f.r + 58 + foe.r || Math.abs(da) > 0.85) continue;
      buttonDeal(room, foe, 3.8, f, 'button_basic');
      foe.slow = Math.max(foe.slow || 0, 0.5);
      foe.vx += Math.cos(angle) * 60; foe.vy += Math.sin(angle) * 60;
    }
  } else {
    buttonRangedAttack(room, f, target);
  }
}
function castButtonSkill(room, f, target, index) {
  if (!target || target.dead || f.dead || f.btUlt > 0) return;
  f.skillCD[index] = SOURCE_RULES.cooldownAfterCastFor(f.id, index);
  const power = buttonSpend(room, f);
  f.btCast = index === 0 ? 0.4 : index === 1 ? 0.45 : index === 2 ? 0.35 : 0;
  if (index === 0) {
    const px = clamp(target.x + target.vx * 0.22, ARENA.x + 26, ARENA.x + ARENA.w - 26);
    const py = clamp(target.y + target.vy * 0.22, ARENA.y + 26, ARENA.y + ARENA.h - 26);
    const dx = px - f.x, dy = py - f.y, d = Math.hypot(dx, dy) || 1;
    const length = Math.min(470, d + 70), ux = dx / d, uy = dy / d;
    const x2 = f.x + ux * length, y2 = f.y + uy * length;
    buttonEmitSkill(room, f, target, index, { targetX: x2, targetY: y2, power });
    for (const foe of room.sim.fighters) {
      if (!isEnemy(f, foe, room)) continue;
      const sx = x2 - f.x, sy = y2 - f.y;
      const u = clamp(((foe.x - f.x) * sx + (foe.y - f.y) * sy) / (sx * sx + sy * sy || 1), 0, 1);
      if (Math.hypot(foe.x - f.x - sx * u, foe.y - f.y - sy * u) >= 20 + foe.r) continue;
      buttonDeal(room, foe, 6 * power, f, 'button_snare');
      foe.slow = Math.max(foe.slow || 0, 2.6 * power);
      foe.rooted = Math.max(foe.rooted || 0, 0.45 * power);
      emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: foe.uid, fx: 'snared', x: foe.x, y: foe.y });
    }
  } else if (index === 1) {
    const d = Math.hypot(target.x - f.x, target.y - f.y);
    const maxDistance = clamp(d + 85, 175, 310);
    f.btStitch = { targetUid: target.uid, maxDistance, damage: 26 * power, stun: 0.7, expiresAt: room.sim.elapsed + 7.5, power, snapped: false };
    buttonEmitSkill(room, f, target, index, { maxDistance, power, duration: 7.5 });
    emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: target.uid, fx: 'stitched', x: target.x, y: target.y, maxDistance });
  } else if (index === 2) {
    f.btDecoy = { x: f.x, y: f.y, radius: 20, expiresAt: room.sim.elapsed + 7, power, triggered: false };
    const away = Math.atan2(f.y - target.y, f.x - target.x) + (Math.random() * 0.8 - 0.4);
    f.vx = Math.cos(away) * 540; f.vy = Math.sin(away) * 540; f.dash = 0.38;
    f.invuln = Math.max(f.invuln || 0, 0.4);
    buttonEmitSkill(room, f, target, index, { power, duration: 7, decoyX: f.x, decoyY: f.y });
  } else {
    f.btUlt = 6.6; f.btUltAge = 0; f.btUltMax = 6.6; f.btUltPower = power;
    f.btPinX = f.x; f.btPinY = f.y; f.btUltPins = null; f.btUltTick = 0; f.btUltBurstDone = false;
    f.btSmileT = 0; f.vx = 0; f.vy = 0; f.invuln = Math.max(f.invuln || 0, 0.5);
    buttonEmitSkill(room, f, target, index, { power, duration: 6.6 });
  }
}
function buttonTriggerDecoy(room, owner, reason, triggerUid = null) {
  const decoy = owner?.btDecoy;
  if (!owner || !decoy || decoy.triggered) return;
  decoy.triggered = true;
  for (const foe of room.sim.fighters) {
    if (!isEnemy(owner, foe, room) || Math.hypot(foe.x - decoy.x, foe.y - decoy.y) > 150 + foe.r) continue;
    buttonDeal(room, foe, 20 * decoy.power, owner, 'button_decoy');
    const a = Math.atan2(foe.y - decoy.y, foe.x - decoy.x);
    foe.vx += Math.cos(a) * 250; foe.vy += Math.sin(a) * 250;
    foe.stun = Math.max(foe.stun || 0, 0.4); foe.slow = Math.max(foe.slow || 0, 1.4);
  }
  emitEvent(room, 'button_fx', { ownerUid: owner.uid, targetUid: triggerUid, fx: 'decoy_boom', reason, x: decoy.x, y: decoy.y, power: decoy.power });
  owner.btDecoy = null;
}
function stepButton(room, f, target, distance, dt) {
  for (const key of ['btCast', 'btUlt', 'btCtr', 'btLoneCD', 'btWatch']) f[key] = Math.max(0, (f[key] || 0) - dt);
  f.btSmile = (f.btSmile == null ? 1 : f.btSmile) + ((f.btSmileT ?? 1) - (f.btSmile == null ? 1 : f.btSmile)) * Math.min(1, dt * ((f.btSmileT ?? 1) < (f.btSmile ?? 1) ? 1.5 : 4));
  if (target) {
    const a = Math.atan2(target.y - f.y, target.x - f.x);
    f.btAx += (Math.cos(a) * 0.8 - (f.btAx || 0)) * Math.min(1, dt * 6);
    f.btAy += (Math.sin(a) * 0.6 - (f.btAy || 0)) * Math.min(1, dt * 6);
  }
  if ((f.btWatch || 0) > 0) {
    const hitter = room.sim.fighters.find(q => q.uid === f.btHitSrc);
    if (!hitter || hitter.dead) f.btWatch = 0;
    else if (Math.hypot(hitter.x - f.x, hitter.y - f.y) > (f.btHitD || 0) + 75 && !(f.btLoneCD > 0)) {
      f.btWatch = 0; f.btLoneCD = 0.8; f.btLone = Math.min(100, (f.btLone || 0) + 14);
      emitEvent(room, 'button_fx', { ownerUid: f.uid, fx: 'lone_gain', x: f.x, y: f.y, loneliness: f.btLone });
    }
  }
  if (f.btUlt > 0) {
    f.btUltAge += dt;
    f.x = f.btPinX; f.y = f.btPinY; f.vx *= 0.2; f.vy *= 0.2;
    for (let i = 0; i < 3; i++) f.skillCD[i] = Math.max(f.skillCD[i], 0.5);
    f.attackCD = Math.max(f.attackCD, 0.3);
    return;
  }
  // Original offline order checks ready skills before the basic attack.
  for (let i = 0; i < f.skillCD.length; i++) {
    f.skillCD[i] -= dt;
    if (f.skillCD[i] <= 0) { castButtonSkill(room, f, target, i); break; }
  }
  if (f.btUlt <= 0) buttonBasicAttack(room, f, target, distance);
}
function stepButtonPost(room, f, dt) {
  if (f.id !== 'button' || f.dead) return;
  // Counter-thread lashes after the brief wind-up; gameplay is decided here, visuals are an event.
  if (f.btCounter && !f.btCounter.done && room.sim.elapsed >= f.btCounter.dueAt) {
    const counter = f.btCounter; counter.done = true;
    const foe = room.sim.fighters.find(q => q.uid === counter.targetUid);
    if (foe && isEnemy(f, foe, room)) {
      const sx = f.x, sy = f.y, ex = counter.x2, ey = counter.y2;
      const vx = ex - sx, vy = ey - sy, u = clamp(((foe.x - sx) * vx + (foe.y - sy) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      if (Math.hypot(foe.x - sx - vx * u, foe.y - sy - vy * u) < 16 + foe.r) {
        buttonDeal(room, foe, 3.4, f, 'button_passive'); foe.slow = Math.max(foe.slow || 0, 1);
      }
      emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: foe.uid, fx: 'counter_snap', x: f.x, y: f.y, targetX: counter.x2, targetY: counter.y2 });
    }
    f.btCounter = null;
  }
  // Sewn Together remains active until the target escapes the tether distance or it expires.
  if (f.btStitch) {
    const st = f.btStitch, foe = room.sim.fighters.find(q => q.uid === st.targetUid);
    if (!foe || foe.dead || room.sim.elapsed >= st.expiresAt) {
      f.btStitch = null;
      emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: st.targetUid, fx: 'stitch_end', x: f.x, y: f.y });
    } else if (!st.snapped && Math.hypot(foe.x - f.x, foe.y - f.y) > st.maxDistance) {
      st.snapped = true;
      buttonDeal(room, foe, st.damage, f, 'button_stitch'); foe.stun = Math.max(foe.stun || 0, st.stun);
      const a = Math.atan2(foe.y - f.y, foe.x - f.x); foe.vx -= Math.cos(a) * 140; foe.vy -= Math.sin(a) * 140;
      emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: foe.uid, fx: 'stitch_snap', x: foe.x, y: foe.y, power: st.power });
      f.btStitch = null;
    }
  }
  // Decoy triggers on an enemy collision or a hostile projectile passing through it.
  if (f.btDecoy && !f.btDecoy.triggered) {
    if (room.sim.elapsed >= f.btDecoy.expiresAt) f.btDecoy = null;
    else {
      const d = f.btDecoy;
      const foe = room.sim.fighters.find(q => isEnemy(f, q, room) && Math.hypot(q.x - d.x, q.y - d.y) < d.radius + q.r + 4);
      if (foe) buttonTriggerDecoy(room, f, 'fighter', foe.uid);
      else {
        const p = room.sim.projectiles.find(q => {
          const shooter = room.sim.fighters.find(x => x.uid === q.owner);
          return shooter && isEnemy(f, shooter, room) && Math.hypot(q.x - d.x, q.y - d.y) < d.radius + (q.r || 5) + 4;
        });
        if (p) { room.sim.projectiles = room.sim.projectiles.filter(q => q !== p); buttonTriggerDecoy(room, f, 'projectile', p.owner); }
      }
    }
  }
  // Ultimate: delayed capture, repeated tick damage, then the dollhouse shockwave.
  if (f.btUlt > 0) {
    f.x = f.btPinX; f.y = f.btPinY; f.vx *= 0.2; f.vy *= 0.2;
    const age = f.btUltAge, foes = room.sim.fighters.filter(q => isEnemy(f, q, room));
    if (age >= 1.7 && !f.btUltPins && !f.btUltBurstDone) {
      f.btUltPins = Object.fromEntries(foes.map(q => [q.uid, { x: q.x, y: q.y }]));
      f.btUltTick = 0;
      emitEvent(room, 'button_fx', { ownerUid: f.uid, fx: 'ult_capture', x: f.x, y: f.y, power: f.btUltPower });
    }
    if (f.btUltPins && age < 4.95) {
      f.btUltTick -= dt;
      if (f.btUltTick <= 0) {
        f.btUltTick = 0.5;
        for (const q of foes) buttonDeal(room, q, 5 * f.btUltPower, f, 'button_ultimate_tick');
      }
      for (const q of foes) {
        const pin = f.btUltPins[q.uid] || (f.btUltPins[q.uid] = { x: q.x, y: q.y });
        const pull = Math.max(0, Math.min(1, (age - 1.7) / 2.4));
        q.x = clamp(pin.x, ARENA.x + q.r, ARENA.x + ARENA.w - q.r);
        q.y = clamp(pin.y - pull * 26, ARENA.y + q.r, ARENA.y + ARENA.h - q.r);
        q.vx *= 0.3; q.vy *= 0.3; q.slow = Math.max(q.slow || 0, 0.3);
      }
    }
    if (age >= 4.95 && !f.btUltBurstDone) {
      f.btUltBurstDone = true; f.btUltPins = null;
      for (const q of foes) {
        buttonDeal(room, q, 110 * f.btUltPower, f, 'button_ultimate');
        const a = Math.atan2(q.y - f.y, q.x - f.x); q.vx += Math.cos(a) * 420; q.vy += Math.sin(a) * 420; q.stun = Math.max(q.stun || 0, 1.1);
        emitEvent(room, 'button_fx', { ownerUid: f.uid, targetUid: q.uid, fx: 'ult_shock', x: q.x, y: q.y, power: f.btUltPower });
        buttonDeal(room, q, 60 * f.btUltPower, f, 'button_ultimate');
        q.vx += Math.cos(a) * 300; q.vy += Math.sin(a) * 300; q.stun = Math.max(q.stun || 0, 0.6);
      }
      SOURCE_RULES.applySourceHeal(f, 16, room.sim.elapsed); f.shield = Math.min(26, f.shield + 10); f.btSmileT = 1;
      emitEvent(room, 'button_fx', { ownerUid: f.uid, fx: 'ult_final', x: f.x, y: f.y, power: f.btUltPower });
    }
  }
}

const SOURCE_ABILITIES = createSourceAbilityEngine({
  ARENA,
  sourceRules: SOURCE_RULES,
  emitEvent(room, type, payload) { emitEvent(room, type, payload); },
  isEnemy(a, b, room) {
    if (!isEnemy(a, b, room)) return false;
    if ((a.twin && b.uid === a.mast) || (b.twin && a.uid === b.mast)) return false;
    if (a.grp && b.grp && a.grp === b.grp) return false;
    return true;
  },
  dealDamage(room, target, raw, source, reason) { return dealDamage(room, target, raw, source, reason); },
  heal(room, fighter, amount) { return SOURCE_RULES.applySourceHeal(fighter, amount, room.sim.elapsed); }
});

function ultimateGate(room) {
  const now = room.sim.elapsed;
  if ((room.sim.ultNext || 0) > now + 12) room.sim.ultNext = 0;
  if (now < (room.sim.ultNext || 0)) return false;
  room.sim.ultNext = now + 3.6 + Math.random() * 2.6;
  return true;
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
  f.burn = Math.max(0, f.burn - dt);
  f.mirrorTimer = Math.max(0, (f.mirrorTimer || 0) - dt);
  if (f.burn > 0 && Math.random() < dt * 2.08) dealDamage(room, f, 1.25, room.sim.fighters.find(q => q.id === 'solarflare' && !q.dead && isEnemy(q, f, room)) || null, 'burn');
  f.shield = Math.min(SOURCE_RULES.shieldCapFor(f.id, !!f.twin), Math.max(0, f.shield - dt * 3.0));
  const quietFor = room.sim.elapsed - (f.lastHitAt ?? room.sim.elapsed);
  if (f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + dt * (quietFor > 4 ? 0.72 : 0.12));
  const mult = f.stun > 0 ? 0.2 : f.rooted > 0 ? 0.4 : f.slow > 0 ? 0.68 : 1;
  f.dash = Math.max(0, (f.dash || 0) - dt);
  f.x += f.vx * dt * mult; f.y += f.vy * dt * mult;
  const left = ARENA.x + f.r, right = ARENA.x + ARENA.w - f.r;
  const top = ARENA.y + f.r, bottom = ARENA.y + ARENA.h - f.r;
  if (f.x < left) { f.x = left; f.vx = Math.abs(f.vx) * 0.985; f.lastDir = 1; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y, side: 0 }); }
  else if (f.x > right) { f.x = right; f.vx = -Math.abs(f.vx) * 0.985; f.lastDir = -1; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y, side: 1 }); }
  if (f.y < top) { f.y = top; f.vy = Math.abs(f.vy) * 0.985; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y, side: 2 }); }
  else if (f.y > bottom) { f.y = bottom; f.vy = -Math.abs(f.vy) * 0.985; emitEvent(room, 'wall', { ownerUid: f.uid, x: f.x, y: f.y, side: 3 }); }
  const speed = Math.hypot(f.vx, f.vy);
  if (speed < 82) { const a = Math.atan2(f.vy || seededJitter(), f.vx || seededJitter()); f.vx = Math.cos(a) * 90; f.vy = Math.sin(a) * 90; }
  const speedCap = f.dash > 0 ? 560 : 225;
  if (speed > speedCap) { f.vx = f.vx / speed * speedCap; f.vy = f.vy / speed * speedCap; }

  const nearest = nearestEnemy(f, room);
  if (!nearest) return;
  const target = nearest.fighter, distance = nearest.distance;
  if (f.id === 'button') {
    stepButton(room, f, target, distance, dt);
    capTeamShield(f);
    return;
  }
  // All non-Button characters now run their source-derived server handlers.
  // Button intentionally retains its separately tested bespoke online pilot.
  SOURCE_ABILITIES.passiveStep(room, f, dt);
  if (f.attackCD <= 0) {
    f.attackCD = 0.95 + (Math.random() * 0.23 - 0.1);   // V45: .95 + rand(-.1,.13)
    SOURCE_ABILITIES.basicAttack(room, f, target, distance);
  }
  for (let i = 0; i < f.skillCD.length; i++) {
    f.skillCD[i] = Math.max(0, f.skillCD[i] - dt);
    if (f.skillCD[i] <= 0) {
      // V45 rule: the original game has no range limit on skills, and only one
      // ultimate may start per 3.6-6.2 s window across the whole battle.
      if (i === 3 && !f.twin && !ultimateGate(room)) { f.skillCD[3] = 0.5 + Math.random() * 1.1; continue; }
      const accepted = SOURCE_ABILITIES.castSkill(room, f, target, i);
      f.skillCD[i] = accepted ? SOURCE_RULES.cooldownAfterCastFor(f.id, i) : 0.35;
      // One cast per server tick keeps long ult timelines and projectiles bounded.
      break;
    }
  }
  if (f.id === 'magnetar' && distance < 90 && f.shield < 32) f.shield = Math.min(32, f.shield + dt * 1.0);
  if (f.id === 'voidbloom' && Math.random() < dt * 0.95) SOURCE_RULES.applySourceHeal(f, 0.5, room.sim.elapsed);
  capTeamShield(f);
}
function stepProjectiles(room, dt) {
  const kept = [];
  const fighterByUid = new Map(room.sim.fighters.map(f => [f.uid, f]));
  for (const proj of room.sim.projectiles) {
    const source = fighterByUid.get(proj.owner);
    let target = fighterByUid.get(proj.target);
    if (!source || source.dead || proj.age >= proj.life) continue;
    proj.age += dt;
    if (proj.homing && target && !target.dead && isEnemy(source, target, room)) {
      const speed = Math.max(1, Math.hypot(proj.vx || 0, proj.vy || 0));
      const dx = target.x - proj.x, dy = target.y - proj.y, d = Math.hypot(dx,dy) || 1;
      const turn = clamp((proj.homing || 0) * dt * 6, 0, 1);
      const vx = proj.vx/speed*(1-turn) + dx/d*turn, vy = proj.vy/speed*(1-turn) + dy/d*turn;
      const n = Math.hypot(vx,vy) || 1; proj.vx = vx/n*speed; proj.vy=vy/n*speed;
    }
    proj.x += proj.vx * dt; proj.y += proj.vy * dt;
    proj.rot = Math.atan2(proj.vy, proj.vx);
    if (!Array.isArray(proj.trail)) proj.trail = [];
    proj.trail.push({ x: proj.x, y: proj.y }); if (proj.trail.length > 6) proj.trail.shift();
    target = fighterByUid.get(proj.target);
    if ((!target || target.dead || !isEnemy(source, target, room)) && proj.homing) {
      target = room.sim.fighters.filter(q => isEnemy(source, q, room)).sort((a,b)=>Math.hypot(a.x-proj.x,a.y-proj.y)-Math.hypot(b.x-proj.x,b.y-proj.y))[0] || null;
      if (target) proj.target = target.uid;
    }
    let hit = false;
    if (target && !target.dead && isEnemy(source, target, room) && Math.hypot(target.x - proj.x, target.y - proj.y) < (target.r || 22) + (proj.r || 5) + 4) {
      proj.hitUids = proj.hitUids || [];
      if (!proj.hitUids.includes(target.uid)) {
        proj.hitUids.push(target.uid); hit = true;
        const reason = proj.reason || (proj.skillIndex === null || proj.skillIndex === undefined ? 'projectile' : (proj.skillIndex === 3 ? 'ultimate' : 'skill'));
        try {
          if (typeof proj.hit === 'function') proj.hit(proj, target, source);
          else dealDamage(room, target, proj.damage || 0, source, reason);
        } catch (error) {
          emitEvent(room, 'ability_error', { fighterId: source.id, handler: 'projectile_hit', message: String(error?.message || error).slice(0, 120) });
        }
        emitEvent(room, 'impact', { ownerUid: source.uid, targetUid: target.uid, x: proj.x, y: proj.y, source: proj.source || 'projectile' });
      }
    }
    if (hit && (proj.pierce || 0) > 0) {
      proj.pierce -= 1;
      const nextTarget = room.sim.fighters.filter(q => isEnemy(source, q, room) && !proj.hitUids.includes(q.uid)).sort((a,b)=>Math.hypot(a.x-proj.x,a.y-proj.y)-Math.hypot(b.x-proj.x,b.y-proj.y))[0];
      if (nextTarget) proj.target = nextTarget.uid;
      else proj.age = proj.life;
    } else if (hit) {
      // Keep source callbacks and reflected projectiles alive only when requested.
      if (proj.reflectable) proj.age = proj.life;
      else if (proj.pierce === undefined || proj.pierce <= 0) proj.age = proj.life;
    }
    if (proj.age < proj.life && proj.x >= ARENA.x - 80 && proj.x <= ARENA.x + ARENA.w + 80 && proj.y >= ARENA.y - 80 && proj.y <= ARENA.y + ARENA.h + 80) kept.push(proj);
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
        emitEvent(room, 'collision', { ownerUid: a.uid, targetUid: b.uid, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, hitSpeed: Math.round(hitSpeed) });
      }
      for (const f of [a, b]) {
        f.x = clamp(f.x, ARENA.x + f.r, ARENA.x + ARENA.w - f.r);
        f.y = clamp(f.y, ARENA.y + f.r, ARENA.y + ARENA.h - f.r);
      }
    }
  }
}
function determineWinner(room) {
  const alive = room.sim.fighters.filter((f) => !f.twin && !f.dead && f.hp > 0);
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
const FIGHTER_CORE_KEYS = new Set(['uid','playerId','playerIndex','fighterId','id','team','x','y','vx','vy','r','hp','maxHp','shield','age','anim','dead','koTime','attackCD','hitFlash','invuln','stun','slow','rooted','energy','lastDir','markTarget','skillCD','cooldowns','trail','c','contactCD','grp','name','twin','mast','life','dash','burn','pow','sourceSummon','srFly','srV','srTrail','srSeq']);
// Character-specific state (forms, illusions, charges, seals ...) that the original
// renderers read. Only plain numbers/booleans/short strings/small flat objects are sent.
function publicFighterState(f) {
  const out = {};
  let bytes = 0;
  const num = (v) => Math.round(v * 1000) / 1000;
  for (const [k, v] of Object.entries(f)) {
    if (FIGHTER_CORE_KEYS.has(k) || k.startsWith('_') || k.startsWith('bt')) continue;
    let val;
    if (typeof v === 'number') { if (!Number.isFinite(v)) continue; val = num(v); }
    else if (typeof v === 'boolean') val = v;
    else if (typeof v === 'string') { if (v.length > 32) continue; val = v; }
    else if (Array.isArray(v)) {
      if (v.length > 24 || !v.every(x => (typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean')) continue;
      val = v.map(x => typeof x === 'number' ? num(x) : x);
    } else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {}; let ok = true, n = 0;
      for (const [kk, vv] of Object.entries(v)) {
        if (++n > 16) { ok = false; break; }
        if (typeof vv === 'number' && Number.isFinite(vv)) o[kk] = num(vv);
        else if (typeof vv === 'boolean' || (typeof vv === 'string' && vv.length <= 24)) o[kk] = vv;
        else { ok = false; break; }
      }
      if (!ok) continue;
      val = o;
    } else continue;
    const size = k.length + JSON.stringify(val).length + 4;
    if (bytes + size > 2400) break;
    bytes += size; out[k] = val;
  }
  return out;
}
function publicFighterDelta(f) {
  const cur = publicFighterState(f);
  const sent = f._fxSent || (f._fxSent = {});
  const set = {}, del = [];
  for (const [k, v] of Object.entries(cur)) {
    const json = JSON.stringify(v);
    if (sent[k] !== json) { set[k] = v; sent[k] = json; }
  }
  for (const k of Object.keys(sent)) if (!(k in cur)) { del.push(k); delete sent[k]; }
  return { set, del };
}
function publicFighter(f) {
  return {
    uid: f.uid, playerId: f.playerId, playerIndex: f.playerIndex, id: f.id,
    team: f.team, x: f.x, y: f.y, vx: f.vx, vy: f.vy, r: f.r,
    hp: f.hp, maxHp: f.maxHp, shield: f.shield, age: f.age, anim: f.anim,
    dead: f.dead, koTime: f.koTime, attackCD: f.attackCD, hitFlash: f.hitFlash,
    invuln: f.invuln, stun: f.stun, slow: f.slow, rooted: f.rooted,
    energy: f.energy, lastDir: f.lastDir, markTarget: f.markTarget, sourceVariant: f.sourceVariant || 0, odetteAct: f.odetteAct || 0, loversLead: f.loversLead || 0,
    focalorsStage: f.focalorsStage || 0, foForm: f.foForm || 0, srFace: f.srFace || 0, srFeet: f.srFeet || 0, srFly: typeof f.srFly === 'object' && f.srFly ? Math.max(0, (f.srFly.dur || 0) - (f.srFly.t || 0)) : (f.srFly || 0),
    mcSeals: f.mcSeals, mcUnr: f.mcUnr, stSw: f.stSw || 0, svTool: f.svTool || 0, twin: !!f.twin, mast: f.mast || null, life: f.life || 0,
    dash: f.dash || 0, burn: f.burn || 0, name: f.name || null, sourceSummon: !!f.sourceSummon, pow: f.pow || 1, grp: f.twin ? (f.grp || null) : undefined,
    ...(() => { const d = publicFighterDelta(f); const o = {}; if (Object.keys(d.set).length) o.fx = d.set; if (d.del.length) o.fxDel = d.del; return o; })(),
    ...(f.id === 'button' ? {
      btLone: f.btLone, btWatch: f.btWatch, btHitSrc: f.btHitSrc, btHitD: f.btHitD,
      btHitT: f.btHitT, btLoneCD: f.btLoneCD, btCtr: f.btCtr, btCast: f.btCast,
      btUlt: f.btUlt, btUltMax: f.btUltMax, btSmile: f.btSmile, btSmileT: f.btSmileT,
      btSeed: f.btSeed, btAx: f.btAx, btAy: f.btAy, btPinX: f.btPinX, btPinY: f.btPinY
    } : {})
  };
}
function publicEffectOpts(o) {
  // Only plain data is sent to clients: numbers, strings, booleans and short numeric arrays.
  const out = {};
  if (!o || typeof o !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (n >= 40) break;
    if (typeof v === 'number') { if (Number.isFinite(v)) { out[k] = Math.round(v * 1000) / 1000; n++; } }
    else if (typeof v === 'string') { out[k] = v.slice(0, 40); n++; }
    else if (typeof v === 'boolean') { out[k] = v; n++; }
    else if (Array.isArray(v) && v.length <= 12 && v.every(x => typeof x === 'number' && Number.isFinite(x))) { out[k] = v; n++; }
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const sub = {}; let ok = true, m = 0;
      for (const [kk, vv] of Object.entries(v)) {
        if (++m > 8) { ok = false; break; }
        if (typeof vv === 'number' && Number.isFinite(vv)) sub[kk] = Math.round(vv * 1000) / 1000;
        else if (typeof vv === 'boolean') sub[kk] = vv;
        else if (typeof vv === 'string') sub[kk] = vv.slice(0, 80);
        else { ok = false; break; }
      }
      if (ok) { out[k] = sub; n++; }
    }
  }
  return out;
}
function publicEffect(e) {
  // The server's generic zone effect is the original V45 "z" effect on the client.
  const isZone = e.type === 'source_zone' || e.z;
  if (e._netSent) {
    // Already known by the clients: send only what moves/changes (snapshots stay small).
    const small = { uid: e.uid, x: e.x, y: e.y, age: e.age, duration: e.duration, r: e.r, target: e.target || null };
    if (Number.isFinite(e.angle)) small.angle = e.angle;
    if (isZone) {
      const o = publicEffectOpts(e.o), json = JSON.stringify(o);
      if (json !== e._netO) { small.o = o; e._netO = json; }
    }
    return small;
  }
  e._netSent = true;
  const out = {
    uid: e.uid, type: isZone ? 'z' : e.type, x: e.x, y: e.y, owner: e.owner, target: e.target || null,
    age: e.age, duration: e.duration, r: e.r, level: e.level || 1
  };
  if (Number.isFinite(e.angle)) out.angle = e.angle;
  if (isZone) { out.z = 1; out.k = e.k; out.s = e.s || e.ownerId || null; out.o = publicEffectOpts(e.o); e._netO = JSON.stringify(out.o); }
  return out;
}
const PROJECTILE_SKIP = new Set(['uid','owner','target','x','y','vx','vy','r','damage','age','life','type','s','rot','skillIndex','trail','hit','hitUids','team','reason','source','special','pierce','homing','rawDamage']);
// Per-projectile render hints from the original (volley colour/index, lead, form ...).
function publicProjectileExtras(p) {
  const out = {}; let n = 0;
  for (const [k, v] of Object.entries(p)) {
    if (PROJECTILE_SKIP.has(k) || k.startsWith('_') || n >= 8) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = Math.round(v * 100) / 100; n++; }
    else if (typeof v === 'boolean') { out[k] = v; n++; }
    else if (typeof v === 'string' && v.length <= 24) { out[k] = v; n++; }
  }
  return out;
}
function publicProjectile(p) {
  return {
    uid: p.uid, owner: p.owner, target: p.target, x: p.x, y: p.y,
    vx: p.vx, vy: p.vy, r: p.r, damage: p.damage, age: p.age, life: p.life,
    type: p.type, s: p.s, rot: p.rot, skillIndex: p.skillIndex, trail: p.trail.slice(-6),
    ...publicProjectileExtras(p)
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
    effects: (room.sim.sourceEffects || []).filter(e => e && e.age < e.duration).slice(-90).map(publicEffect),
    timeStop: room.sim.sourceTimeStop ? { timer: room.sim.sourceTimeStop.timer, owner: room.sim.sourceTimeStop.owner, target: room.sim.sourceTimeStop.target } : null,
    fourthWall: room.sim.sourceFourthWall ? { timer: room.sim.sourceFourthWall.timer, x: room.sim.sourceFourthWall.x, y: room.sim.sourceFourthWall.y, side: room.sim.sourceFourthWall.side, owner: room.sim.sourceFourthWall.owner?.uid || room.sim.sourceFourthWall.owner || null } : null,
    events: room.sim.events.slice(-80)
  };
  // Serialise once for every player, rounding long floats (positions, velocities, ages) to 2 decimals.
  const payload = JSON.stringify({ type: 'battle_snapshot', roomId: room.id, snapshot },
    (key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value));
  for (const player of room.players) {
    if (player.ws.readyState !== WebSocket.OPEN) continue;
    try { player.ws.send(payload); } catch { /* close event performs cleanup */ }
  }
  // Events are only cleared after they were actually sent, so a skipped snapshot never loses visuals.
  room.sim.events = [];
}
function tickRoom(room, dt) {
  if (room.ended) return;
  room.sim.elapsed += dt;
  SOURCE_ABILITIES.stepScheduled(room, dt);
  for (const fighter of [...room.sim.fighters]) stepFighter(room, fighter, dt);
  for (const fighter of room.sim.fighters) stepButtonPost(room, fighter, dt);
  stepCollisions(room);
  stepProjectiles(room, dt);
  SOURCE_ABILITIES.stepEffects(room, dt);
  SOURCE_ABILITIES.stepSummons(room, dt);
  if (room.sim.fighters.length > MAX_FIGHTERS + 16) room.sim.fighters = room.sim.fighters.filter(f => !f.twin || !f.dead).slice(-MAX_FIGHTERS - 16);

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
