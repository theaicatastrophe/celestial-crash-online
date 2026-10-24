'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
class FakeWSS extends EventEmitter { constructor(){ super(); this.clients = new Set(); } handleUpgrade(){ throw new Error('unexpected upgrade in unit test'); } }
const baseDir = __dirname;
const src = fs.readFileSync(path.join(baseDir, 'server.js'), 'utf8');
const marker = 'let lastTickAt = Date.now();';
if (!src.includes(marker)) throw new Error('test hook insertion marker missing');
let instrumented = src.replace(marker, `globalThis.__hooks = { FIGHTER_IDS, MODES, makeSimFighter, dealDamage, buttonDeal, capTeamShield, publicFighter, stepFighter, tickRoom, SOURCE_RULES };\n${marker}`);
instrumented = instrumented.replace(/server\.listen\(PORT, '0\.0\.0\.0', \(\) => \{\s*console\.log\([^;]+;\s*\}\);/, '/* listener omitted in test harness */');
const ctx = {
  require(id){ if(id==='ws') return { WebSocketServer: FakeWSS, WebSocket: { OPEN: 1 } }; return require(id); },
  process: { env: {}, on(){}, exit(){} }, console, URL, Date, Math, Map, Set, Object, Array, Number, String, JSON, RegExp,
  crypto: require('node:crypto'), setInterval(){ return { unref(){} }; }, clearInterval(){}, setTimeout(){ return { unref(){} }; }, globalThis: null
};
ctx.globalThis = ctx;
vm.runInNewContext(instrumented, ctx, { filename: 'server_source_rules.instrumented.js' });
const H = ctx.__hooks;
const assert = (condition, message) => { if(!condition) throw new Error('FAIL '+message); console.log('PASS', message); };
function roomWith(aId='photon', bId='gemini') {
  const room={mode:'classic_1v1',players:[{},{}],sim:{elapsed:0,impacts:0,eventSeq:0,seq:0,fighters:[],projectiles:[],events:[]}};
  const a=H.makeSimFighter({id:'p1',playerId:'p1',playerIndex:0,team:0,fighterId:aId},room);
  const b=H.makeSimFighter({id:'p2',playerId:'p2',playerIndex:1,team:1,fighterId:bId},room);
  a.uid='a';b.uid='b';a.x=150;a.y=150;b.x=350;b.y=150;a.vx=a.vy=b.vx=b.vy=0;
  room.sim.fighters=[a,b];return {room,a,b};
}
{
 const {room,a,b}=roomWith();
 assert(b.maxHp===360 && b.hp===360, 'the source default fighter HP is 360');
 const hp=b.hp;H.dealDamage(room,b,10,a,'melee');
 const expected=10*.68*.99;
 assert(Math.abs((hp-b.hp)-expected)<1e-8, 'basic damage uses source global .68 factor and Photon outgoing scale');
}
{
 const {room,a,b}=roomWith('solarflare','gemini');
 const hp=b.hp;H.dealDamage(room,b,10,a,'skill');
 const expected=10*.68*.85*.94;
 assert(Math.abs((hp-b.hp)-expected)<1e-8, 'skill damage includes source skill factor and character damage scale');
}
{
 const {room,a,b}=roomWith('earth','gemini');
 const hp=b.hp;H.dealDamage(room,b,10,a,'ultimate');
 const expected=10*.68*.85*.83*.90;
 assert(Math.abs((hp-b.hp)-expected)<1e-8, 'ultimate damage includes the shared ultimate and Earth-specific scale');
}
{
 const {room,a,b}=roomWith('photon','blackhole');
 assert(b.hp===300 && b.maxHp===420, 'Black Hole uses its source-specific starting and maximum HP');
 const hp=b.hp;H.dealDamage(room,b,10,a,'melee');
 const expected=10*.68*.99*.90;
 assert(Math.abs((hp-b.hp)-expected)<1e-8, 'Black Hole damage reduction applies after outgoing damage scaling');
}
{
 const {room,a,b}=roomWith('photon','gemini');
 b.shield=2;const hp=b.hp;const beforeShield=b.shield;H.dealDamage(room,b,10,a,'melee');
 const expectedHealth=10*.68*.99-beforeShield;
 assert(Math.abs((hp-b.hp)-expectedHealth)<1e-8, 'shield absorption is applied after source-scaled damage');
}

{
 const ids = Array.from(H.FIGHTER_IDS);
 assert(ids.every(id => Array.isArray(H.SOURCE_RULES.SKILL_BASE_COOLDOWNS[id]) && H.SOURCE_RULES.SKILL_BASE_COOLDOWNS[id].length === 4), 'every server-allowed fighter has four source-derived skill cooldowns');
 assert(H.SOURCE_RULES.skillBaseCooldownFor('blackhole',0)===4.4 && H.SOURCE_RULES.skillBaseCooldownFor('button',3)===16, 'skill metadata maps original Black Hole and Button cooldowns');
 assert(Math.abs(H.SOURCE_RULES.cooldownAfterCastFor('blackhole',0,()=>0.5)-4.4*1.16)<1e-8, 'normal skill cooldown follows the V45 source multiplier');
 assert(Math.abs(H.SOURCE_RULES.cooldownAfterCastFor('blackhole',3)-8.12)<1e-8, 'ultimate cooldown follows the later V45 rearm wrapper');
 const {a}=roomWith('blackhole','gemini');
 assert(a.skillCD[0]>=1.9 && a.skillCD[0]<2.3 && a.skillCD[1]>=4.2 && a.skillCD[1]<4.6 && a.skillCD[2]>=6.8 && a.skillCD[2]<7.2 && a.skillCD[3]>=14.5 && a.skillCD[3]<15.5, 'fighters start with V45 shared initial cooldown bands');
}
{
 const {room,a,b}=roomWith('blackhole','gemini');
 a.attackCD=20; a.skillCD=[0,100,100,100]; a.x=150;a.y=150;b.x=220;b.y=150;
 H.stepFighter(room,a,0.05);
 assert(a.skillCD[0] >= 4.4*1.16-0.12 && a.skillCD[0] <= 4.4*1.16+0.12, 'generic server skill casts use that character original cooldown metadata');
}
console.log('ALL SOURCE RULE TESTS PASSED');
