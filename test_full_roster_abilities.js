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
const coverage = engine.sourceCoverage();
assert.equal(coverage.rosterCount, 60, 'catalog covers all 60 source-defined fighters');
assert.equal(coverage.uniqueHandlers, 252, 'catalog contains all 252 unique handler keys');
assert.equal(coverage.coveredHandlers, coverage.uniqueHandlers, `all source skill handlers are routed: ${coverage.missing.join(', ')}`);
assert.deepEqual(coverage.missing, [], 'no source skill handler is un-routed');
let castCount = 0;
let catalogCastableCount = 0;
const failures = [];
for (const entry of catalog.fighters) {
  for (let vi = 0; vi < entry.variants.length; vi++) {
    const variant = entry.variants[vi];
    for (let skillIndex = 0; skillIndex < variant.skills.length; skillIndex++) {
      const a = makeFighter(entry.id, 0, `${entry.id}-${vi}-${skillIndex}`);
      const b = makeFighter('gemini', 1, `target-${entry.id}-${vi}-${skillIndex}`);
      const room = makeRoom(a,b);
      if (entry.id === 'odette') a.sourceVariant = vi;
      if (entry.id === 'lovers') a.loversLead = vi;
      try {
        if (entry.id !== 'button') {
          const accepted = engine.castSkill(room, a, b, skillIndex);
          assert.equal(accepted, true, `${entry.id}.${variant.skills[skillIndex].handler} is routed`);
          // Advance the authoritative timeline too, catching delayed source handlers
          // that would otherwise look valid at the initial cast but fail in combat.
          for (let tick = 0; tick < 100; tick++) {
            room.sim.elapsed += 0.05;
            engine.stepScheduled(room, 0.05);
            engine.stepEffects(room, 0.05);
            engine.stepSummons(room, 0.05);
          }
          const delayedErrors = room.sim.events.filter(event => event.type === 'ability_error');
          assert.deepEqual(delayedErrors, [], `${entry.id}.${variant.skills[skillIndex].handler} delayed work has no server-helper errors: ${delayedErrors.map(e=>e.message).join('; ')}`);
          castCount++;
          catalogCastableCount++;
        }
      } catch (error) {
        failures.push(`${entry.id}.${variant.skills[skillIndex].handler}: ${String(error.message).split('\n')[0]}`);
      }
    }
  }
}
assert.deepEqual(failures, [], `source skill casts execute without missing server helpers:\n${failures.join('\n')}`);
const expectedCastable = catalog.fighters.reduce((sum, fighter) => sum + fighter.variants.reduce((n, variant) => n + variant.skills.length, 0), 0) - catalog.fighters.find(f => f.id === 'button').variants.reduce((n, variant) => n + variant.skills.length, 0);
assert.equal(castCount, expectedCastable, 'all non-Button catalog skill tuples are actually cast; Button remains on its bespoke pilot');
let basicAttackCount = 0;
const basicFailures = [];
for (const entry of catalog.fighters) {
  const a = makeFighter(entry.id, 0, `basic-${entry.id}`);
  const b = makeFighter('gemini', 1, `basic-target-${entry.id}`);
  const room = makeRoom(a,b);
  a.x = 280; a.y = 360; b.x = 400; b.y = 360;
  try {
    if (entry.id !== 'button') {
      engine.passiveStep(room, a, 0.05);
      assert.equal(engine.basicAttack(room, a, b, 120), true, `${entry.id} has a server basic-attack route`);
      for (let tick = 0; tick < 20; tick++) {
        room.sim.elapsed += 0.05;
        engine.stepScheduled(room, 0.05);
        engine.stepEffects(room, 0.05);
        engine.stepSummons(room, 0.05);
      }
      const delayedErrors = room.sim.events.filter(event => event.type === 'ability_error');
      assert.deepEqual(delayedErrors, [], `${entry.id} basic/passive timeline has no missing server helpers: ${delayedErrors.map(e=>e.message).join('; ')}`);
      basicAttackCount++;
    }
  } catch (error) {
    basicFailures.push(`${entry.id}: ${String(error.message).split('\n')[0]}`);
  }
}
assert.deepEqual(basicFailures, [], `source basic attacks and passive ticks execute without server-helper errors:\n${basicFailures.join('\n')}`);
assert.equal(basicAttackCount, catalog.fighters.length - 1, 'every non-Button roster entry has a basic attack and passive execution route');
console.log(`PASS ${coverage.coveredHandlers}/${coverage.uniqueHandlers} unique source handlers routed`);
console.log(`PASS ${castCount} non-Button catalog skill tuples executed; Button remains covered by its dedicated pilot test`);
console.log(`PASS ${basicAttackCount} non-Button basic attacks/passive ticks simulated`);
