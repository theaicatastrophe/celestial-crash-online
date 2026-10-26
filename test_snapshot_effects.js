'use strict';
// Verifies the server serialises the V45 skill zones/effects into snapshot-safe JSON
// that the client's original "z" renderer can draw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const start = src.indexOf('function publicEffectOpts');
const end = src.indexOf('function publicProjectile');
assert.ok(start > 0 && end > start, 'publicEffect serializer exists in server.js');
const { publicEffect } = new Function(src.slice(start, end) + '; return { publicEffect };')();

const zone = { uid: 'e1', type: 'source_zone', z: true, k: 'burst', s: 'aries', ownerId: 'aries', x: 100, y: 120, owner: 'u1', target: null,
  age: 0.2, duration: 1, r: 80, o: { r: 80, d: 1, dmg: 12, fn: () => 1, nested: { a: 1 }, deep: { a: { b: 1 } }, ang: 1.5, list: [1, 2, 3] } };
const pz = publicEffect(zone);
assert.equal(pz.type, 'z'); assert.equal(pz.k, 'burst'); assert.equal(pz.s, 'aries'); assert.equal(pz.z, 1);
assert.equal(pz.o.dmg, 12); assert.equal(pz.o.ang, 1.5); assert.deepEqual(pz.o.list, [1, 2, 3]);
assert.ok(!('fn' in pz.o), 'functions are stripped');
assert.deepEqual(pz.o.nested, { a: 1 }, 'one level of plain nested data (e.g. act cards) is kept');
assert.ok(!('deep' in pz.o), 'deeper nesting is dropped');
const core = publicEffect({ uid: 'e2', type: 'horizon', x: 1, y: 2, owner: 'u1', age: 0, duration: 2.8, r: 300 });
assert.equal(core.type, 'horizon'); assert.ok(!core.z);
JSON.parse(JSON.stringify([pz, core]));
const again = publicEffect(zone);
assert.ok(!('type' in again) && !('k' in again) && !('o' in again), 'follow-up update is compact (no repeated options)');
assert.equal(again.uid, 'e1'); assert.equal(again.age, 0.2);
zone.o.dmg = 99; zone.age = 0.5;
const changed = publicEffect(zone);
assert.equal(changed.o.dmg, 99, 'changed options are re-sent');
console.log('PASS snapshot effect serialisation');
console.log('ALL SNAPSHOT EFFECT TESTS PASSED');
