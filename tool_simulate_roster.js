'use strict';
// Fast-forwards the REAL server.js tick loop (no network) for each fighter id given on the command line
// and prints a per-character activity table: npm run simulate -- seraphim odette steve   (SECS=40 by default)
const Module = require('node:module'); const { EventEmitter } = require('node:events'); const path = require('node:path');
let wss = null; class W extends EventEmitter { constructor() { super(); this.clients = new Set(); wss = this; } handleUpgrade() {} }
class S extends EventEmitter { constructor() { super(); this.readyState = 1; this.inbox = []; } send(d) { this.inbox.push(d); } ping() {} terminate() {} close() {} }
S.OPEN = 1; const rl = Module._load; Module._load = function (r, ...a) { return r === 'ws' ? { WebSocketServer: W, WebSocket: S } : rl.call(this, r, ...a); };
let fakeNow = 1_000_000; const realNow = Date.now; Date.now = () => fakeNow;
let simCb = null; const realSI = global.setInterval;
global.setInterval = (fn, ms, ...r) => { if (ms === 50) simCb = fn; return { unref() {}, ref() {} }; };
process.env.PORT = '0'; require(path.join(process.cwd(), 'server.js')); Module._load = rl;
const mk = () => { const w = new S(); wss.clients.add(w); wss.emit('connection', w, {}); return w; };
const say = (w, m) => w.emit('message', Buffer.from(JSON.stringify(m)));
const ids = process.argv.slice(2);
const SECONDS = Number(process.env.SECS || 40);
const rows = [];
for (const id of ids) {
  const a = mk(), b = mk();
  say(a, { type: 'find_match', mode: 'classic_1v1', fighterId: id }); say(b, { type: 'find_match', mode: 'classic_1v1', fighterId: 'gemini' });
  const ready = a.inbox.map(JSON.parse).find(m => m.type === 'battle_ready');
  const myUid = ready.players.find(p => p.fighterId === id).uid;
  let ticks = SECONDS * 20, result = null;
  for (let t = 0; t < ticks && !result; t++) { fakeNow += 50; simCb(); result = a.inbox.slice(-3).map(JSON.parse).find(m => m.type === 'match_result'); }
  const msgs = a.inbox.map(JSON.parse); const snaps = msgs.filter(m => m.type === 'battle_snapshot').map(m => m.snapshot);
  const ev = snaps.flatMap(s => s.events).filter(e => e.ownerUid === myUid);
  const casts = ev.filter(e => e.cast), attacks = ev.filter(e => e.type === 'attack');
  const slots = [0, 1, 2, 3].map(i => casts.filter(c => c.skillIndex === i).length);
  const errs = snaps.flatMap(s => s.events).filter(e => e.type === 'ability_error').map(e => e.handler + ':' + e.message.slice(0, 60));
  const last = snaps[snaps.length - 1]; const me = last.fighters.find(f => f.uid === myUid);
  rows.push({ id, secs: (snaps.length / 20).toFixed(0), attacks: attacks.length, slots: slots.join('/'), hits: ev.filter(e => e.type === 'hit').length, hp: me ? Math.round(me.hp) : 'x', errs: [...new Set(errs)].slice(0, 2).join(' | ') });
  a.emit('close'); b.emit('close');
}
console.table(rows);
process.exit(0);
