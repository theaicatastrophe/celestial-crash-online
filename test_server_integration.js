'use strict';
// Boots the real server.js against a tiny in-memory stand-in for the `ws` package,
// plays full 1v1 matches for several fighter pairs and checks what clients receive.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

let wssInstance = null;
class FakeWSS extends EventEmitter {
  constructor() { super(); this.clients = new Set(); wssInstance = this; }
  handleUpgrade() {}
}
class FakeWebSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.inbox = []; this.isAlive = true; }
  send(data) { this.inbox.push(JSON.parse(data)); }
  ping() {} terminate() { this.readyState = 3; } close() { this.readyState = 3; this.emit('close'); }
}
FakeWebSocket.OPEN = 1;
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'ws') return { WebSocketServer: FakeWSS, WebSocket: FakeWebSocket };
  return realLoad.call(this, request, ...rest);
};
process.env.PORT = '0';
require(path.join(__dirname, 'server.js'));
Module._load = realLoad;

function connect() {
  const ws = new FakeWebSocket();
  wssInstance.clients.add(ws);
  wssInstance.emit('connection', ws, {});
  return ws;
}
const say = (ws, msg) => ws.emit('message', Buffer.from(JSON.stringify(msg)));

async function playMatch(idA, idB, seconds) {
  const a = connect(), b = connect();
  say(a, { type: 'find_match', mode: 'classic_1v1', fighterId: idA });
  say(b, { type: 'find_match', mode: 'classic_1v1', fighterId: idB });
  await new Promise(r => setTimeout(r, seconds * 1000));
  const snaps = a.inbox.filter(m => m.type === 'battle_snapshot').map(m => m.snapshot);
  const events = snaps.flatMap(s => s.events);
  const result = a.inbox.find(m => m.type === 'match_result');
  a.emit('close'); b.emit('close');
  return { snaps, events, result, a };
}

(async () => {
  const pairs = [['aries', 'quasar'], ['perplexity', 'taurus'], ['focalors', 'steve'], ['odette', 'seraphim']];
  for (const [x, y] of pairs) {
    const { snaps, events, result, a } = await playMatch(x, y, 6);
    assert.ok(a.inbox.some(m => m.type === 'battle_ready'), `${x} v ${y}: battle started`);
    assert.ok(snaps.length > 40, `${x} v ${y}: snapshots flowing (${snaps.length})`);
    const types = new Set(events.map(e => e.type));
    // every event reaches the client exactly once and in order
    const seqs = events.map(e => e.seq);
    assert.equal(new Set(seqs).size, seqs.length, 'no duplicate event seq');
    assert.deepEqual(seqs, [...seqs].sort((p, q) => p - q), 'events in order');
    assert.ok(types.has('hit') || types.has('collision') || types.has('wall'), `${x} v ${y}: combat events present`);
    assert.ok(snaps.every(s => Array.isArray(s.effects)), 'every snapshot carries effects');
    assert.ok(snaps[0].fighters.every(f => f.fx && typeof f.fx === 'object'), 'first snapshot carries full fighter state');
    assert.ok(snaps.length < 3 || JSON.stringify(snaps[2].fighters).length < JSON.stringify(snaps[0].fighters).length, 'later snapshots only carry changes');
    const sizes = snaps.map(s => JSON.stringify(s).length); const bytes = Math.max(...sizes); const avg = Math.round(sizes.reduce((p, q) => p + q, 0) / sizes.length);
    assert.ok(avg < 4000 && bytes < 16000, `${x} v ${y}: snapshot size ok (max ${bytes} bytes)`);
    const walls = events.filter(e => e.type === 'wall');
    console.log(`PASS ${x} v ${y}: ${snaps.length} snapshots, ${events.length} events [${[...types].join(',')}], avg ${avg} B / max ${bytes} B, ${walls.length} wall events` + (result ? ', match finished' : ''));
  }
  // longer fight to see casts, effects and sounds come through the real network path
  const { snaps, events } = await playMatch('perplexity', 'aries', 14);
  const casts = events.filter(e => e.cast);
  const effectsSeen = new Set(snaps.flatMap(s => s.effects.map(e => e.type + (e.k ? ':' + e.k : ''))));
  console.log('casts:', casts.length, '| ultimates:', casts.filter(e => e.skillIndex === 3).length, '| sfx events:', events.filter(e => e.type === 'sfx').length, '| distinct effects:', effectsSeen.size);
  assert.ok(casts.length >= 2, 'skills are cast during the match');
  assert.ok(effectsSeen.size >= 1, 'skill effects reach the client');
  console.log('ALL SERVER INTEGRATION TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
