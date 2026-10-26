'use strict';
// Runs the client's online presentation code (cast visuals, sounds, hit/wall/KO looks,
// effect + fighter-state sync) against a mock of the original game's globals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/CelestialCrash_Button_V48_Full_Roster.html', 'utf8');
function grab(startMarker, endMarker) {
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, 'found ' + startMarker);
  return html.slice(a, b);
}
const code = grab('const CC_NET_SFX=', 'function ccNetApplySnapshot(snapshot){') +
  grab('function ccNetSyncEffects(snapshot){', 'function ccNetInterpolateRemote');
const log = [];
const warns = [];
const mk = (id, extra) => Object.assign({ uid: 'u_' + id, id, x: 100, y: 100, r: 22, twin: false,
  c: { color: '#fff', icon: 'x', skills: [['Skill A', 0, 'hit'], ['Skill B', 0, 'hit'], ['Skill C', 0, 'hit'], ['Big Ult', 0, 'hit']] } }, extra);
const ctx = {
  console: { warn: (...a) => warns.push(a.join(' ')), log() {} },
  performance: { now: () => Date.now() }, Math, Number, Array, Object, String, Set, Map, JSON,
  W: 720, H: 720, soundOn: true, shakeOn: true, screenShake: 0, screenZoom: 1, flash: 0, effects: [], gameTime: 0,
  timeStop: { timer: 0 }, fourthWall: { timer: 0 }, V9U: [], SG: { a: ['bolt', 'ember', '#fff', '#f00', 0, 1, { ch: 1 }] },
  SN9: { bolt: () => log.push('SN9') }, em9: (...a) => log.push('em9'), pFX: (o) => log.push('pFX:' + Object.keys(o).join(',')),
  initAudio: () => ({}), uiScale: () => 1, rand: (a, b) => (a + b) / 2, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  GL: { hit: () => log.push('GL.hit'), onEffect() {} },
  particle: (x, y, o, n, k) => log.push('particle:' + k + ':' + n), spawnBurst: (x, y, o, n) => log.push('burst:' + n),
  floatText: (x, y, t) => log.push('text:' + t), createEffect: (t) => { log.push('effect:' + t); return { type: t }; },
  showUltimateBanner: (f, n) => log.push('banner:' + n), playSkillSfx: (f, i) => log.push('skillsfx:' + i),
  playSfx: (k) => log.push('sfx:' + k), pxSound: (...a) => log.push('pxSound:' + a.join('|')),
  ccNet: { lastEventSeq: 0, mode: 'classic_1v1' }, ccNetButtonVisual: () => log.push('button'),
  fighters: [mk('a'), mk('b', { x: 200 }), mk('tw', { twin: true })],
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(code + ';this.run=ccNetVisualizeEvents;this.sync=ccNetSyncEffects;', ctx);
let seq = 0;
const ev = (o) => Object.assign({ seq: ++seq, ownerUid: 'u_a', targetUid: 'u_b', x: 100, y: 100 }, o);
const play = (...events) => { log.length = 0; ctx.run(events); return log.slice(); };

let out = play(ev({ type: 'skill', source: 'v45', cast: true, skillIndex: 1 }));
assert.ok(out.includes('skillsfx:1') && out.includes('particle:cast:15') && out.includes('text:SKILL B'), 'cast: sound, particles, name');
out = play(ev({ type: 'skill', source: 'v45', skillIndex: 1 }));
assert.deepEqual(out, [], 'non-cast v45 skill events do not add placeholder effects');
ctx.fighters[0].id = 'a';
out = play(ev({ type: 'ultimate', source: 'v45', cast: true, skillIndex: 3 }));
assert.ok(out.includes('banner:Big Ult') && out.includes('effect:ultburst') && out.includes('particle:ultimate:1') && out.includes('em9') && out.includes('SN9') && out.some(l => l.startsWith('pFX')), 'ultimate: banner, burst, theming, screen fx, sound');
assert.ok(ctx.screenShake >= 24 && ctx.flash >= 0.36 && ctx.V9U.length === 1, 'ultimate screen shake/flash/distortion');
out = play(ev({ type: 'sfx', name: 'pxSound', args: [2, true] }));
assert.deepEqual(out, ['pxSound:2|true'], 'handler sounds are played by name');
assert.deepEqual(play(ev({ type: 'sfx', name: 'evilFn', args: [] })), [], 'unknown sound names are ignored');
out = play(ev({ type: 'hit', damage: 18 }));
assert.ok(out.includes('text:18') && out.includes('burst:11') && out.includes('GL.hit'), 'hit: damage number, burst, flash');
assert.deepEqual(play(ev({ type: 'hit', damage: 0 })), [], 'absorbed hits show nothing');
out = play(ev({ type: 'wall', ownerUid: 'u_a', side: 2 }));
assert.ok(out.includes('burst:5') && out.includes('sfx:wall'), 'wall bounce burst + thud');
out = play(ev({ type: 'collision', hitSpeed: 160 }));
assert.ok(out.includes('effect:hit') && out.filter(l => l === 'particle:collision:1').length === 9 && out.includes('sfx:collision'), 'collision effect + sound');
out = play(ev({ type: 'ko', targetUid: 'u_b' }));
assert.ok(out.includes('sfx:ko') && out.includes('effect:ko') && out.includes('text:K.O.!'), 'KO sound + effect + banner text');
out = play(ev({ type: 'ko', targetUid: 'u_tw' }));
assert.ok(!out.includes('sfx:ko') && out.includes('burst:6'), 'summon KO is a poof, not a KO');
out = play(ev({ type: 'attack', projectileType: 'zp' }));
assert.deepEqual(out, ['particle:cast:3'], 'ranged basic attack cast puff');
assert.equal(warns.length, 0, 'no handler errors: ' + warns.join(' / '));

// effect + state sync
ctx.sync({ effects: [{ uid: 'e1', type: 'z', z: 1, k: 'burst', s: 'a', x: 5, y: 6, owner: 'u_a', age: 0.1, duration: 1, r: 50, o: { dmg: 3 } }],
  timeStop: { timer: 1.2, owner: 'u_a', target: 'u_b' }, fourthWall: { timer: 0.5, x: 1, y: 2, side: 3, owner: 'u_a' } });
assert.equal(ctx.effects.length, 1); assert.equal(ctx.effects[0].k, 'burst'); assert.equal(ctx.effects[0].o.dmg, 3);
assert.equal(ctx.timeStop.timer, 1.2); assert.equal(ctx.fourthWall.side, 3);
ctx.sync({ effects: [{ uid: 'e1', x: 9, y: 9, age: 0.6, duration: 1, r: 55, target: null, o: { dmg: 7 } }] });
assert.equal(ctx.effects.length, 1, 'compact update keeps the effect'); assert.equal(ctx.effects[0].x, 9); assert.equal(ctx.effects[0].k, 'burst'); assert.equal(ctx.effects[0].o.dmg, 7);
ctx.sync({ effects: [], timeStop: { timer: 0 }, fourthWall: { timer: 0, side: 4 } });
assert.equal(ctx.effects.length, 0, 'server-removed effects disappear'); assert.equal(ctx.timeStop.timer, 0);
console.log('PASS client presentation events (cast, sounds, hit, wall, collision, KO, effect sync)');
console.log('ALL CLIENT EVENT TESTS PASSED');
