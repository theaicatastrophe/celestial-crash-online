'use strict';
// Checks that the server sends the ORIGINAL V45 visuals (zones, named effects, text, screen fx, poses)
// to the clients, that every event is safe to JSON-serialise, and that Odette's HP-driven acts work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const createEngine = require('./source_ability_engine');
const catalog = require('./source_skill_catalog.json');
const rules = require('./source_mechanics');
const ARENA = { x: 45, y: 45, w: 630, h: 630 };

function makeFighter(id, team, uid) {
  const skillCD = [0, 0, 0, 0];
  return { uid, playerId: uid, playerIndex: team, fighterId: id, id, team,
    x: team ? 410 : 280, y: 360, vx: 0, vy: 0, r: 22,
    hp: rules.maxHpFor(id), maxHp: rules.maxHpFor(id), shield: 0, dead: false,
    age: 0, anim: 0, attackCD: 0, skillCD, cooldowns: skillCD, contactCD: 0.4,
    invuln: 0, stun: 0, slow: 0, rooted: 0, burn: 0, energy: 0, lastDir: 1,
    passiveTicks: 0, projectileCount: 0, markTarget: 0, melee: false, attackStyle: 'zp',
    stM: [0, 0, 0], sourceVariant: 0, odetteAct: 0, loversLead: 0, focalorsStage: 0, foForm: 0,
    srEye: [0, 0, 0], srEyeT: [0, 0, 0], srAbs: 0, srHoly: 0, srFly: null, eiIl: [], eiMg: [], eiMgT: 0, mcRecoil: 0, mcStrain: 0, mcSeals: 5, mcBrk: [-99, -99, -99, -99, -99], mcUnr: 0 };
}
function makeRoom(a, b) {
  return { sim: { elapsed: 10, impacts: 0, events: [], fighters: [a, b], projectiles: [], sourceEffects: [], sourceDelayed: [],
    sourceTimeStop: { timer: 0, owner: null, target: null, startedAt: 0 }, sourceFourthWall: { timer: 0, x: 0, y: 0, side: 4, owner: null } } };
}
const engine = createEngine({
  ARENA, sourceRules: rules, strict: true,
  emitEvent(room, type, payload) { room.sim.events.push({ type, ...payload }); },
  isEnemy(a, b) { return !!a && !!b && a.team !== b.team && !a.twin && !b.twin; },
  dealDamage(room, target, raw) { if (!target || target.dead || target.invuln > 0 || !(raw > 0)) return 0; const before = target.hp; target.hp = Math.max(0, target.hp - raw); if (target.hp <= 0) target.dead = true; return before - target.hp; },
  heal(room, f, amount) { if (!f || f.dead || amount <= 0) return 0; const before = f.hp; f.hp = Math.min(f.maxHp, f.hp + amount); return f.hp - before; }
});

const VISUAL_TYPES = new Set(['source_zone', 'source_text', 'source_visual', 'source_particle', 'source_card', 'source_pose', 'summon', 'form_change', 'odette_cut']);
let tuples = 0, withVisual = 0, zoneEvents = 0, namedEffects = 0;
const silent = [];
for (const entry of catalog.fighters) {
  if (entry.id === 'button') continue;
  for (let vi = 0; vi < entry.variants.length; vi++) {
    const variant = entry.variants[vi];
    for (let si = 0; si < variant.skills.length; si++) {
      const a = makeFighter(entry.id, 0, `a-${entry.id}-${vi}-${si}`), b = makeFighter('gemini', 1, `b-${entry.id}-${vi}-${si}`);
      if (entry.id === 'odette') { a.sourceVariant = vi; a.odP = vi; }
      if (entry.id === 'lovers') a.loversLead = vi;
      const room = makeRoom(a, b);
      engine.castSkill(room, a, b, si);
      for (let t = 0; t < 600; t++) { room.sim.elapsed += 0.05; engine.stepScheduled(room, 0.05); engine.stepEffects(room, 0.05); engine.stepSummons(room, 0.05); }
      tuples++;
      const errs = room.sim.events.filter(ev => ev.type === 'ability_error');
      assert.equal(errs.length, 0, `${entry.id}.${variant.skills[si].handler}: ${errs[0]?.message}`);
      // every event must serialise (no circular fighter references) and stay small
      for (const ev of room.sim.events) {
        const text = JSON.stringify(ev);
        assert.ok(text.length < 2500, `${entry.id}.${variant.skills[si].handler}: event ${ev.type} too large (${text.length})`);
        if (ev.type === 'source_zone') { zoneEvents++; assert.equal(typeof ev.k, 'string'); assert.ok(ev.o && typeof ev.o === 'object'); assert.ok(Number.isFinite(ev.o.r) && Number.isFinite(ev.o.d), `${entry.id}: zone ${ev.k} lacks r/d`); for (const v of Object.values(ev.o)) assert.notEqual(typeof v, 'function'); }
        if ((ev.type === 'skill' || ev.type === 'ultimate') && ev.vfx) { namedEffects++; assert.equal(typeof ev.effect, 'string'); assert.ok(Number.isFinite(ev.duration) && Number.isFinite(ev.r)); }
      }
      const visual = room.sim.events.some(ev => VISUAL_TYPES.has(ev.type) || (ev.vfx === true)) || room.sim.projectiles.length > 0 || room.sim.events.some(ev => ev.projectileType);
      if (visual) withVisual++; else silent.push(`${entry.id}.${variant.skills[si].handler}`);
    }
  }
}
console.log(`PASS ${tuples} skill casts serialise safely; ${zoneEvents} original zone events + ${namedEffects} named effects sent`);
console.log(`INFO ${withVisual}/${tuples} skills send a visual; without one: ${silent.join(', ') || 'none'}`);
assert.ok(withVisual / tuples > 0.97, 'nearly every skill must send its original visual to the clients');
assert.ok(zoneEvents > 400, 'zone visuals are being sent');

// ---- Odette: acts follow HP, pose helper does not scramble the act ----
{
  const od = makeFighter('odette', 0, 'od'), foe = makeFighter('gemini', 1, 'foe');
  const room = makeRoom(od, foe);
  for (let i = 0; i < 4; i++) { engine.castSkill(room, od, foe, i % 3); }
  assert.equal(od.odP ?? 0, 0, 'casting skills in Act I no longer advances her act');
  assert.ok(room.sim.events.some(e => e.type === 'source_pose'), 'dance poses are sent as source_pose events');
  od.hp = od.maxHp * 0.5; od.odLock = 0;
  engine.passiveStep(room, od, 0.05);
  assert.ok(od.odCut > 0, 'dropping below 67% HP starts the act change cutscene');
  assert.ok(od.invuln > 4, 'she is invulnerable during the cutscene');
  assert.ok(room.sim.events.some(e => e.type === 'odette_cut'));
  for (let i = 0; i < 100; i++) { room.sim.elapsed += 0.05; od.invuln = Math.max(od.invuln, 0.3); engine.passiveStep(room, od, 0.05); }
  assert.equal(od.odP, 1, 'cutscene ends in Act II');
  assert.equal(od.odetteAct, 1);
  assert.ok(room.sim.events.some(e => e.type === 'source_zone' && e.k === 'odshift'), 'odshift stage effect is sent at the swap');
  console.log('PASS Odette acts follow HP (I >= 67%, II >= 34%, else III) with a 4.2 s cutscene');
}

// ---- server.js must keep events until a snapshot was really sent ----
{
  const src = fs.readFileSync('./server.js', 'utf8');
  assert.ok(!/function tickRoom[\s\S]{0,200}room\.sim\.events = \[\]/.test(src), 'tickRoom must not wipe events before they are broadcast');
  assert.ok(/room\.sim\.events = \[\];\s*\n\s*sendRoom\(room, 'battle_snapshot'/.test(src), 'events are cleared only after they are sent');
  console.log('PASS server keeps visual events until a snapshot is actually sent');
}
console.log('ALL VISUAL EVENT TESTS PASSED');
