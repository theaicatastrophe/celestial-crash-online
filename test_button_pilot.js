'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const EventEmitter = require('node:events');
class FakeWSS extends EventEmitter {
  constructor(){ super(); this.clients = new Set(); }
  handleUpgrade() { throw new Error('unexpected upgrade in unit test'); }
}
const serverPath = require('node:path').join(__dirname, 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');
const marker = "let lastTickAt = Date.now();";
if (!src.includes(marker)) throw new Error('test hook insertion marker missing');
let instrumented = src.replace(marker, `globalThis.__hooks = { FIGHTER_IDS, MODES, ARENA, makeSimFighter, dealDamage, buttonDeal, castButtonSkill, stepButton, stepButtonPost, buttonTriggerDecoy, publicFighter, publicProjectile, tickRoom };\n${marker}`);
instrumented = instrumented.replace(/server\.listen\(PORT, '0\.0\.0\.0', \(\) => \{\s*console\.log\([^;]+;\s*\}\);/, '/* listener omitted in test harness */');
const ctx = {
  require(id){ if(id==='ws') return { WebSocketServer: FakeWSS, WebSocket: { OPEN: 1 } }; return require(id); },
  process: { env: {}, on(){}, exit(){} }, console, URL, Date, Math, Map, Set, Object, Array, Number, String, JSON, RegExp,
  crypto: require('node:crypto'), setInterval(){ return { unref(){} }; }, clearInterval(){}, setTimeout(){ return { unref(){} }; }, globalThis: null
};
ctx.globalThis = ctx;
vm.runInNewContext(instrumented, ctx, { filename: 'server_button_pilot.instrumented.js' });
const H = ctx.__hooks;
const assert = (condition, message) => { if(!condition) throw new Error(message); console.log('PASS', message); };
function setup(){
  const room={mode:'classic_1v1',players:[{},{}],sim:{elapsed:0,impacts:0,eventSeq:0,seq:0,fighters:[],projectiles:[],events:[]}};
  const b=H.makeSimFighter({id:'p1',playerId:'p1',playerIndex:0,team:0,fighterId:'button'},room);
  const e=H.makeSimFighter({id:'p2',playerId:'p2',playerIndex:1,team:1,fighterId:'gemini'},room);
  b.uid='button-uid'; e.uid='enemy-uid'; b.x=150;b.y=150;b.vx=0;b.vy=0;e.x=260;e.y=150;e.vx=0;e.vy=0;
  room.sim.fighters=[b,e];
  return {room,b,e};
}
assert(H.FIGHTER_IDS.has('button'), 'Button is accepted by the server roster allowlist');
{
 const {b}=setup(); assert(b.hp===410 && b.maxHp===410 && b.btLone===0 && b.btUltMax===6.6, 'Button spawns with V45-specific combat state and 410 HP');
 const pub=H.publicFighter(b); assert(pub.btSeed===b.btSeed && pub.btLone===0 && pub.btPinX===b.btPinX, 'Button renderer state is included in authoritative snapshots');
}
{
 const {room,b,e}=setup(); const before=e.hp; H.castButtonSkill(room,b,e,0);
 assert(e.hp < before && e.slow>0 && e.rooted>0, 'Thread Snare applies server-side damage, slow, and root');
 assert(b.skillCD[0] >= 3.4*1.16-0.12 && b.skillCD[0] <= 3.4*1.16+0.12, 'Button uses the original V45 Thread Snare cooldown metadata');
 assert(room.sim.events.some(ev=>ev.type==='button_ability'&&ev.ability==='btS0'), 'Thread Snare emits a sequenced visual event');
}
{
 const {room,b,e}=setup(); b.btLone=50; H.castButtonSkill(room,b,e,1); const st=b.btStitch; e.x=b.x+st.maxDistance+12;
 const before=e.hp; room.sim.elapsed+=.05; H.stepButtonPost(room,b,.05);
 assert(!b.btStitch && e.hp<before && e.stun>=.7, 'Sewn Together snaps authoritatively when the target escapes');
}
{
 const {room,b,e}=setup(); b.btDecoy={x:b.x,y:b.y,radius:20,expiresAt:100,power:1.3,triggered:false}; const before=e.hp;
 H.buttonTriggerDecoy(room,b,'test',e.uid);
 assert(e.hp<before && e.stun>=.4 && e.slow>=1.4 && b.btDecoy===null, 'Decoy explosion applies server-owned damage and status effects');
}
{
 const {room,b,e}=setup(); const before=b.hp; H.dealDamage(room,b,10,e,'melee');
 assert(Math.abs((before-b.hp)-(10*.68*.85*.94))<0.001 && b.btCounter && b.btWatch>0, 'Button passive reduces incoming source-scaled damage and starts its counter-thread watch');
}
{
 const {room,b,e}=setup(); H.castButtonSkill(room,b,e,3); b.btUltAge=5.0; b.btUltPins={}; b.btUltBurstDone=false; b.hp=380; const before=e.hp;
 H.stepButtonPost(room,b,.05);
 assert(b.btUltBurstDone && e.hp < before-80 && b.shield>=10 && b.hp>=383.7 && b.hp<=383.81, 'Ultimate performs the delayed final shockwave, source-capped healing, and shield gain');
 assert(Math.abs(b.skillCD[3]-9.28)<1e-8, 'Button ultimate uses the source V45 rearm cooldown instead of the old generic 20.8-second cooldown');
}
{
 const {b}=setup(); const p=H.publicProjectile({uid:'p',owner:b.uid,target:'enemy-uid',x:0,y:0,vx:1,vy:0,r:5,damage:2,age:0,life:1,type:'button',s:'button',rot:0,skillIndex:null,trail:[]});
 assert(p.s==='button' && p.type==='button', 'Button thread projectiles retain their custom client renderer tag');
}
{
 const room={id:'smoke-room',mode:'classic_ffa4',label:'test',players:[0,1,2,3].map(()=>({ws:{readyState:0}})),createdAt:Date.now(),lastSnapshotAt:0,ended:false,sim:{elapsed:0,impacts:0,seq:0,eventSeq:0,fighters:[],projectiles:[],events:[]}};
 const ids=['button','photon','gemini','solarflare'];
 room.sim.fighters=ids.map((id,i)=>H.makeSimFighter({playerId:'p'+i,playerIndex:i,team:i,fighterId:id},room));
 for(let i=0;i<60;i++)H.tickRoom(room,0.05);
 assert(room.sim.fighters.length===4 && room.sim.fighters.some(f=>f.id==='button') && room.sim.elapsed>2.9, 'Four-fighter server simulation advances with Button and mixed characters');
}
console.log('ALL BUTTON PILOT UNIT CHECKS PASSED');
