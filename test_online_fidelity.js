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

// ---- Fidelity checks for the online server vs. the V45 original ----
const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a1 = src.indexOf('function ultimateGate'), a2 = src.indexOf('function stepFighter');
const { ultimateGate } = new Function(src.slice(a1, a2) + '; return { ultimateGate };')();
const b1 = src.indexOf('const FIGHTER_CORE_KEYS'), b2 = src.indexOf('function publicFighter(f)');
const { publicFighterState, publicFighterDelta } = new Function(src.slice(b1, b2) + '; return { publicFighterState, publicFighterDelta };')();

// 1. Global ultimate gate: one ultimate per 3.6-6.2 s window across the battle.
const gr = { sim: { elapsed: 5 } };
assert.equal(ultimateGate(gr), true, 'first ultimate is allowed');
assert.equal(ultimateGate(gr), false, 'a second ultimate right away is held back');
gr.sim.elapsed += 3.5; assert.equal(ultimateGate(gr), false, 'still inside the 3.6 s minimum');
gr.sim.elapsed += 3; assert.equal(ultimateGate(gr), true, 'allowed again after the window');
console.log('PASS global ultimate gate matches V45 (3.6-6.2 s)');

// 2. Basic-attack cadence range .85-1.08 and no skill range limit in server.js
assert.ok(/0\.95 \+ \(Math\.random\(\) \* 0\.23 - 0\.1\)/.test(src), 'basic attack cadence is .95 + rand(-.1,.13)');
assert.ok(!/maxRange/.test(src), 'skills have no distance limit (as in the original)');
console.log('PASS basic-attack cadence + unrestricted skill range');

// 3. Fighter state serialisation
const st = publicFighterState({ uid: 'x', hp: 5, foForm: 1, eiList: [1, 2, 3], mixed: [1, {}], fn: () => 1, nested: { a: 1, b: 'x' }, deep: { a: {} }, btLone: 3, _private: 1, big: 'x'.repeat(50) });
assert.equal(st.foForm, 1); assert.deepEqual(st.eiList, [1, 2, 3]); assert.deepEqual(st.nested, { a: 1, b: 'x' });
for (const k of ['uid', 'hp', 'mixed', 'fn', 'deep', 'btLone', '_private', 'big']) assert.ok(!(k in st), k + ' not sent');
const df = { uid: 'd', foForm: 0, charge: 1 };
let d1 = publicFighterDelta(df); assert.deepEqual(d1.set, { foForm: 0, charge: 1 }); assert.deepEqual(d1.del, []);
let d2 = publicFighterDelta(df); assert.deepEqual(d2.set, {}); assert.deepEqual(d2.del, []);
df.charge = 2; delete df.foForm; let d3 = publicFighterDelta(df);
assert.deepEqual(d3.set, { charge: 2 }); assert.deepEqual(d3.del, ['foForm']);
console.log('PASS fighter render-state serialisation + change-only deltas');

// 4. Engine: cast flag, ultimate con zone, sounds, Quasar redshift
const eng = createEngine({
  ARENA, sourceRules: rules, strict: true,
  emitEvent(room, type, payload) { room.sim.events.push({ type, ...payload }); },
  isEnemy(a, b) { return !!a && !!b && a.team !== b.team && !a.twin && !b.twin; },
  dealDamage(room, target, raw) { if (target && !target.dead) target.hp = Math.max(0, target.hp - raw * 0.5); return raw * 0.5; },
  heal() { return 0; }
});
{
  const A = makeFighter('quasar', 0, 'qa'), B = makeFighter('aries', 1, 'qb');
  const room = makeRoom(A, B); room.id = 'r1';
  const before = room.sim.projectiles.length;
  for (let i = 0; i < 4; i++) { A.attackCD = 0; eng.basicAttack(room, A, B, 200); }
  const shots = room.sim.projectiles.slice(before);
  assert.equal(shots.length, 4);
  assert.ok(shots[3].damage > shots[0].damage * 1.5 && shots[3].pierce === 1, '4th Quasar shot is the 1.55x piercing REDSHIFT');
  assert.ok(room.sim.sourceEffects.some(e => e.type === 'criticalray'), 'REDSHIFT ray effect exists');
  assert.ok(room.sim.events.some(e => e.type === 'source_text' && e.text === 'REDSHIFT!'), 'REDSHIFT text event');
  console.log('PASS Quasar every-4th-shot REDSHIFT');
}
{
  const A = makeFighter('aries', 0, 'aa'), B = makeFighter('taurus', 1, 'ab');
  const room = makeRoom(A, B); room.id = 'r2';
  eng.castSkill(room, A, B, 3);
  const cast = room.sim.events.filter(e => e.cast);
  assert.equal(cast.length, 1, 'exactly one cast event per skill cast');
  assert.ok(room.sim.sourceEffects.some(e => e.k === 'con'), 'ultimate adds the V45 arena "con" zone');
  console.log('PASS cast event + ultimate zone');
}
{
  const A = makeFighter('perplexity', 0, 'pa'), B = makeFighter('aries', 1, 'pb');
  const room = makeRoom(A, B); room.id = 'r3';
  let sounds = 0;
  for (let i = 0; i < 4; i++) { eng.castSkill(room, A, B, i); }
  sounds = room.sim.events.filter(e => e.type === 'sfx').length;
  eng.stepScheduled(room, 3); // delayed handler sounds
  sounds = room.sim.events.filter(e => e.type === 'sfx').length;
  assert.ok(sounds > 0, 'handler sounds become sfx events (' + sounds + ')');
  console.log('PASS handler sounds are forwarded as sfx events');
}
console.log('ALL ONLINE FIDELITY TESTS PASSED');
