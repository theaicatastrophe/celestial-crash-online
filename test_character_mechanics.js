'use strict';
const assert = require('node:assert/strict');
const createEngine = require('./source_ability_engine');
const catalog = require('./source_skill_catalog.json');
const rules = require('./source_mechanics');
const ARENA = { x: 45, y: 45, w: 630, h: 630 };
function makeFighter(id, team, uid) {
  const skillCD = [0,0,0,0];
  return { uid, playerId: uid, playerIndex: team, fighterId: id, id, team,
    x: team ? 410 : 280, y: team ? 360 : 360, vx: 0, vy: 0, r: 22,
    hp: rules.maxHpFor(id), maxHp: rules.maxHpFor(id), shield: 0, dead: false,
    age: 0, anim: 0, attackCD: 0, skillCD, cooldowns: skillCD, contactCD: 0.4,
    invuln: 0, stun: 0, slow: 0, rooted: 0, burn: 0, energy: 0, lastDir: 1,
    passiveTicks: 0, projectileCount: 0, markTarget: 0, melee: false, attackStyle: 'zp', stM:[0,0,0], sourceVariant:0, odetteAct:0, loversLead:0, focalorsStage:0, foForm:0, srEye:[0,0,0], srEyeT:[0,0,0], srAbs:0, srHoly:0, srFly:null, eiIl:[], eiMg:[], eiCv:0, mcSeals:5, mcBrk:[-99,-99,-99,-99,-99], mcUnr:0, mcRecoil:0, mcStrain:0 };
}
function makeRoom(a, b) {
 return { sim: { elapsed: 10, impacts: 0, events: [], fighters: [a,b], projectiles: [], sourceEffects: [], sourceDelayed: [], sourceTimeStop: {timer:0,owner:null,target:null,startedAt:0}, sourceFourthWall:{timer:0,x:0,y:0,side:4,owner:null} } };
}
const engine = createEngine({
  ARENA, sourceRules: rules, strict: true,
  emitEvent(room, type, payload) { room.sim.events.push({ type, ...payload }); },
  isEnemy(a,b) { return !!a && !!b && a.team !== b.team && !a.twin && !b.twin; },
  dealDamage(room, target, raw, source) {
    if (!target || target.dead || target.invuln > 0 || !Number.isFinite(raw) || raw <= 0) return 0;
    if (source && source.team === target.team) return 0;
    const amount = raw * 0.68 * (rules.DAMAGE_SCALE[source?.id] || 0.88);
    const blocked = Math.min(target.shield || 0, amount); target.shield = Math.max(0,(target.shield||0)-blocked);
    const before = target.hp; target.hp = Math.max(0,target.hp-(amount-blocked));
    if (target.hp<=0) target.dead=true;
    room.sim.impacts++;
    return before-target.hp;
  },
  heal(room, f, amount) { if(!f || f.dead || amount<=0)return 0; const before=f.hp;f.hp=Math.min(f.maxHp,f.hp+amount);return f.hp-before; }
});

// ---- Per-character mechanics that the original runs every frame ----
const num = (v) => typeof v === 'number' && Number.isFinite(v);
function step(room, seconds, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) {
    room.sim.elapsed += dt;
    engine.stepScheduled(room, dt);
    engine.stepEffects(room, dt);
    for (const q of room.sim.fighters) if (!q.dead) engine.passiveStep(room, q, dt);
  }
}

// 1. Every skill of every character produces real coordinates and no ability errors (long horizon).
{
  const bad = [];
  for (const entry of catalog.fighters) {
    if (entry.id === 'button') continue;
    entry.variants.forEach((variant, vi) => variant.skills.forEach((sk, idx) => {
      const A = makeFighter(entry.id, 0, 'a'), B = makeFighter('aries', 1, 'b');
      if (entry.id === 'odette') A.sourceVariant = vi; if (entry.id === 'lovers') A.loversLead = vi;
      const room = makeRoom(A, B); room.id = 'sanity';
      try { engine.castSkill(room, A, B, idx); step(room, 14); } catch (e) { bad.push(`${entry.id}.${sk.handler}: ${String(e.message).slice(0, 80)}`); return; }
      for (const e of room.sim.sourceEffects) if (!num(e.x) || !num(e.y)) bad.push(`${entry.id}.${sk.handler}: effect ${e.type}/${e.k} has non-numeric position`);
      for (const p of room.sim.projectiles) if (!num(p.x) || !num(p.y)) bad.push(`${entry.id}.${sk.handler}: projectile position`);
      for (const ev of room.sim.events) {
        if (ev.type === 'ability_error') bad.push(`${entry.id}.${sk.handler}: ${ev.message}`);
        for (const k of ['x', 'y', 'targetX', 'targetY']) if (k in ev && !num(ev[k])) bad.push(`${entry.id}.${sk.handler}: event ${ev.type}.${k}`);
      }
    }));
  }
  assert.deepEqual(bad, [], 'skill data sanity:\n' + bad.join('\n'));
  console.log('PASS every skill of every character yields numeric positions and no ability errors');
}

// 2. Seraphim: timers count down, wings release, attacks resume
{
  const A = makeFighter('seraphim', 0, 'sr'), B = makeFighter('aries', 1, 'srb'); const room = makeRoom(A, B); room.id = 'sr';
  engine.castSkill(room, A, B, 0);
  assert.ok(A.srFace > 1.4, 'cover-the-face starts');
  const before = room.sim.projectiles.length;
  step(room, 2.2);
  assert.equal(A.srFace, 0, 'cover-the-face timer counts down');
  assert.ok(room.sim.projectiles.length > before, 'eyes-open releases homing feathers');
  A.attackCD = 0; const n0 = room.sim.projectiles.length; engine.basicAttack(room, A, B, 200);
  assert.ok(room.sim.projectiles.length > n0, 'basic attack works again after the wings open');
  engine.castSkill(room, A, B, 3);
  assert.ok(A.srUlt, 'ultimate state starts'); step(room, 8);
  assert.equal(A.srUlt, null, 'ultimate state ends');
  // three different postures in a row = Thrice-Holy
  const C = makeFighter('seraphim', 0, 'sr2'), D = makeFighter('aries', 1, 'srd'); const room2 = makeRoom(C, D); room2.id = 'sr2';
  engine.castSkill(room2, C, D, 0); step(room2, 0.2); engine.castSkill(room2, C, D, 1); step(room2, 0.2); engine.castSkill(room2, C, D, 2);
  assert.ok(C.srHoly > 4, 'three different wing pairs trigger THRICE-HOLY');
  console.log('PASS Seraphim timers, eyes-open feathers, ultimate end, Thrice-Holy');
}

// 3. Odette: acts change at 67% / 34% health with the cutscene, new skills and stats
{
  const A = makeFighter('odette', 0, 'od'), B = makeFighter('aries', 1, 'odb'); const room = makeRoom(A, B); room.id = 'od';
  step(room, 3.2); assert.equal(A.odP | 0, 0);
  A.hp = A.maxHp * 0.5; step(room, 0.2);
  assert.ok(A.odCut > 0 && A.invuln > 0, 'cutscene starts and she is untouchable');
  step(room, 4.6);
  assert.equal(A.odP, 1, 'Act II reached'); assert.equal(A.sourceVariant, 1, 'Act II skill set selected'); assert.equal(A.pow, 1);
  assert.ok(room.sim.events.some(e => e.type === 'form_change' && e.form === 1), 'form change event');
  A.hp = A.maxHp * 0.2; A.odLock = 0; step(room, 4.8);
  assert.equal(A.odP, 2, 'Act III reached'); assert.equal(A.pow, 1.7);
  console.log('PASS Odette acts and cutscene');
}

// 4. Steve: mining gives materials (no explosion), timers count down, tools craft
{
  const A = makeFighter('steve', 0, 'sv'), B = makeFighter('aries', 1, 'svb'); const room = makeRoom(A, B); room.id = 'sv';
  const effectsBefore = room.sim.sourceEffects.length;
  engine.steveMine(A, 1, 1, A.x, A.y);
  assert.equal(A.stM[1], 1, 'mined a stone');
  assert.ok(room.sim.sourceEffects.slice(effectsBefore).every(e => e.k === 'svdrop'), 'mining drops an item instead of exploding');
  engine.steveMine(A, 1, 1, A.x, A.y);
  assert.equal(A.stT, 1, 'two stone craft the stone tools'); assert.ok(A.pow >= 1);
  A.svMine = 0.5; A.stSw = 0.3; step(room, 0.7);
  assert.equal(A.svMine, 0); assert.equal(A.stSw, 0);
  console.log('PASS Steve mining, crafting and timers');
}

// 5. Helpers with the original argument order
{
  const A = makeFighter('eidolon', 0, 'ei'), B = makeFighter('aries', 1, 'eib'); const room = makeRoom(A, B); room.id = 'ei';
  for (let i = 0; i < 4; i++) engine.castSkill(room, A, B, i === 3 ? 0 : i);
  assert.ok(A.eiIl.length > 0, 'Eidolon illusions exist');
  step(room, 12); assert.ok(A.eiIl.every(il => il.age < (il.life || 4)), 'illusions expire');
  console.log('PASS Eidolon illusions age out');
}
console.log('ALL CHARACTER MECHANICS TESTS PASSED');
