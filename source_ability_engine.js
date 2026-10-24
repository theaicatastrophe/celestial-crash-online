'use strict';

/*
 * Server-side translation layer for the V45 skill handlers.
 * Handler bodies and skill metadata below are extracted from the supplied V45
 * source. Browser-only presentation work is intentionally replaced with small
 * server-safe helpers; hit/damage/status state remains authoritative here.
 */
const CATALOG = require('./source_skill_catalog.json');
const crypto = require('node:crypto');

function createSourceAbilityEngine(api) {
  const ARENA = api.ARENA;
  const W = ARENA.x + ARENA.w + ARENA.x;
  const H = ARENA.y + ARENA.h + ARENA.y;
  const V10_SHIELD_CAP = api.sourceRules.SHIELD_CAP || {};
  const V10_SHIELD_CAP_DEFAULT = 26;
  const CL_C={clay:'#e58760',coral:'#ffa986',cream:'#fff3e2',paper:'#fbe5c8',deep:'#b9532f',ink:'#1d0c06'};
  const CG_PALETTE={mint:'#91ffe4',cyan:'#77eaff',ice:'#effffc',blue:'#6d9dff',deep:'#07191d',ink:'#041013'};
  const GK_PAL={void:'#05070c',bone:'#f4f0e8',cyan:'#5ce1ff',ice:'#c8f7ff',ember:'#ff9a5c',ink:'#0a0c12'};
  const MT_PAL={void:'#070A18',deep:'#0A0F24',blue:'#4A8CFF',indigo:'#7C5CFF',violet:'#A86BFF',magenta:'#FF5CA1',cyan:'#7EF5FF',white:'#F4F6FF',paper:'#EAF0FF'};
  const DOLA_PAL={violet:'#8B5CF6',deep:'#6D28D9',lavender:'#C4B5FD',mint:'#5EEAD4',gold:'#FCD34D',ink:'#150A24',paper:'#F3E8FF',rose:'#A78BFA'};
  const PX={teal:'#52E0D0',ice:'#E6FFF8',ink:'#061B1B',gold:'#EBCB8B',dim:'#247D79'};
  const LL={K:'#ffd27a',Q:'#ff2e4d',W:'#fff4e2',ink:'#150d24',ruby:'#7a0820',vio:'#a98bff'};
  const LLP={pawn:'♟',knight:'♞',bishop:'♝',rook:'♜',queen:'♛',king:'♚'};
  const MC={steel:'#9aa4b8',hi:'#e9eef9',dark:'#4b5468',vio:'#3b2a4a',vio2:'#7c5aa6',red:'#ff4d6d',hot:'#ffc2cf',ink:'#0f0814'};
  const SR={ivory:'#f6efe2',cloud:'#e8edf4',iris:'#5ec0e8',ember:'#c8452d',gold:'#ffb020',hot:'#fff2c4',ink:'#2a1410',coal:'#ff7a1a',deep:'#7b2a1c'};
  const SR_RING=116;
  const NL={ink:'#040406',bone:'#f4f0e6',ash:'#8f8d88',pg:'#f7f4ea',ck:'#d3d0c8'};
  const EI={vio:'#8a4dff',deep:'#14082e',cy:'#46f0ff',pk:'#ff7be9',gd:'#ffd98a'};
  const BT={lav:'#b9a6e6',lavD:'#8a77bd',lavL:'#e3d8fb',pink:'#d9a3b8',pinkD:'#b57f95',pinkL:'#f0cfdb',gold:'#c9a24b',goldL:'#f3dc8e',goldD:'#8a6a22',ink:'#2a2140'};
  const Q=2;
  let gameTime = 0;
  let timeStop = { timer: 0, owner: null, target: null, startedAt: 0 };
  let fourthWall = { timer: 0, x: 0, y: 0, side: 4, owner: null };
  let screenShake = 0, screenZoom = 1, flash = 0;
  let roomRef = null, fighters = [], projectiles = [], effects = [];
  let currentReason = 'skill', currentIndex = 0, currentOwner = null;
  const ZMELEE = new Set([
    'solarflare','photon','comet','lunar','magnetar','aries','taurus','leo','scorpio','capricorn',
    'mars','mercury','pluto','saturn','cinder','pebble','zapmoth'
  ]);
  const ZRNG = Object.freeze({
    blackhole:['voidbolt',5],nebula:['spore',6],chrono:['chrono',5],quasar:['lance',6],pulsar:['pulsarorb',6],
    voidbloom:['seed',6],fourthwall:['cursor',6],tidal:['bubble',6],siren:['echo',5.5],mimic:['crystalshard',6],
    archivist:['starfolio',6],gemini:['zp',6],cancer:['zp',6],virgo:['zp',6],libra:['zp',6],sagittarius:['zp',6.5],
    aquarius:['zp',6],pisces:['zp',6],venus:['zp',6],earth:['zp',6],jupiter:['zp',6],uranus:['zp',6],neptune:['zp',6],
    ceres:['zp',6],stardust:['zp',6],moonbeam:['zp',6],frostwisp:['zp',6]
  });
  const RADIAL_EFFECTS = new Set([
    'horizon','well','cloud','flareorbit','prominence','supernova','dreamcollapse','meteorimpact','crater','cometstorm',
    'dilation','timefracture','eclipsekiss','totaleclipse','radiantpulse','redgiant','binary','pulsetrain','millinova',
    'roots','petalorbit','endgarden','lightspeed','afterloop','framebreak','maelstrom','infiniteChorus','magnetarFlare',
    'shatteredReflection','finalFootnote','wavefront','undertow','abyssal','reverbBloom','hushfield','ironHalo','mirrorTrap','constellationMap','realityCrash'
  ]);
  const ARENA_WIDE_EFFECTS = new Set(['horizon','endgarden','framebreak','realityCrash','maelstrom','infiniteChorus','magnetarFlare','shatteredReflection','finalFootnote','hushfield','supernova','totaleclipse','redgiant','lightspeed','timefracture']);
  const EXPANDING_EFFECTS = new Set(['prominence','crater','radiantpulse','pulsetrain','millinova']);
  const EFFECT_PULL = new Set(['maelstrom','undertow','well','horizon','abyssal']);
  const EFFECT_SLOW = new Set(['dilation','abyssal','hushfield','mirrorTrap','roots','timefracture']);
  const EFFECT_ROOT = new Set(['roots']);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const G = (f) => f ? (f.grp || f.uid) : null;
  const own = (f) => f && f.twin ? fighters.find(x => x.uid === f.mast) || f : f;
  const currentRoom = () => roomRef;
  function syncRoom(room) {
    roomRef = room;
    if (!room.sim.sourceEffects) room.sim.sourceEffects = [];
    if (!room.sim.sourceDelayed) room.sim.sourceDelayed = [];
    if (!room.sim.sourceTimeStop) room.sim.sourceTimeStop = { timer: 0, owner: null, target: null, startedAt: 0 };
    fighters = room.sim.fighters;
    projectiles = room.sim.projectiles;
    effects = room.sim.sourceEffects;
  }
  function emit(type, payload = {}) {
    if (!roomRef) return;
    api.emitEvent(roomRef, type, payload);
  }
  function withReason(reason, index, owner, fn) {
    const old = [currentReason, currentIndex, currentOwner];
    currentReason = reason || 'impact'; currentIndex = Number.isInteger(index) ? index : 0; currentOwner = owner || null;
    try { return fn(); } finally { [currentReason, currentIndex, currentOwner] = old; }
  }
  function reasonForIndex(index) { return index === 3 ? 'ultimate' : 'skill'; }
  function findTarget(f) {
    let best = null, bestD = Infinity;
    for (const other of fighters) {
      if (!other || other === f || other.dead || other.hp <= 0 || !api.isEnemy(f, other, roomRef)) continue;
      const d = Math.hypot(other.x - f.x, other.y - f.y);
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }
  function distanceTo(a, b) { return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0)); }
  function heal(f, amount) { return api.heal(roomRef, f, amount); }
  function hurt(target, raw, source, kind = 'impact') {
    let reason = currentReason || 'impact';
    if (['burn','passive','button_passive','button_counter','collision'].includes(kind)) reason = kind;
    else if (kind === 'weapon') reason = currentReason === 'skill' || currentReason === 'ultimate' ? currentReason : 'melee';
    else if (kind === 'projectile' && currentReason !== 'skill' && currentReason !== 'ultimate') reason = 'projectile';
    else if (kind === 'balance' || kind === 'verdict' || kind === 'sting' || kind === 'execute' || kind === 'beam' || kind === 'electric' || kind === 'resonance' || kind === 'magnetic' || kind === 'index' || kind === 'debug') reason = currentReason;
    return api.dealDamage(roomRef, target, raw, source, reason);
  }
  function spawnBurst(x, y, owner, n = 6) {
    emit('impact', { ownerUid: owner?.uid || null, x, y, burst: Math.max(1, Math.min(24, n || 1)), source: 'v45' });
  }
  function particle(x, y, owner, n = 1, kind = 'ambient') {
    if (!owner) return;
    emit('source_particle', { ownerUid: owner.uid, x, y, count: Math.min(8, n || 1), kind });
  }
  function floatText(x, y, text, color = '#fff', size = 12) {
    emit('source_text', { ownerUid: currentOwner?.uid || null, x, y, text: String(text).slice(0, 60), color, size });
  }
  function createEffect(type, x, y, owner, opts = {}) {
    if (!roomRef) return null;
    const effect = {
      uid: crypto.randomUUID(), type, x, y, owner: owner?.uid || null, ownerId: owner?.id || null,
      age: 0, duration: Number.isFinite(opts.duration) ? Math.max(0.05, opts.duration) : 1.15,
      r: Number.isFinite(opts.r) ? opts.r : 40, damage: Number.isFinite(opts.damage) ? opts.damage : 0,
      interval: Number.isFinite(opts.interval) ? Math.max(0.05, opts.interval) : 0.45,
      tick: 0, target: opts.target || null, reason: currentReason, sourceIndex: currentIndex,
      source: 'core', options: { ...opts }, once: false
    };
    effects.push(effect);
    emit(opts.ultimate ? 'ultimate' : 'skill', { ownerUid: effect.owner, targetUid: effect.target, x, y, effect: type, ability: type, skillIndex: currentIndex, source: 'v45' });
    return effect;
  }
  function shoot(owner, target, type, damage, speed = 300, opts = {}) {
    if (!roomRef || !owner || !target || target.dead) return null;
    const dx = target.x - owner.x, dy = target.y - owner.y, d = Math.hypot(dx, dy) || 1, angle = Math.atan2(dy, dx);
    const p = {
      uid: crypto.randomUUID(), owner: owner.uid, target: target.uid,
      x: owner.x + dx / d * ((owner.r || 22) + 5), y: owner.y + dy / d * ((owner.r || 22) + 5),
      vx: dx / d * speed, vy: dy / d * speed, r: opts.r || 6,
      damage, rawDamage: damage, age: 0, life: opts.life || 2, type: type || 'zp', s: owner.id,
      rot: angle, pierce: opts.pierce || 0, homing: opts.homing || 0, trail: [], team: owner.team,
      skillIndex: currentReason === 'ultimate' ? 3 : currentReason === 'skill' ? currentIndex : null,
      reason: currentReason, sourceAbility: currentOwner?.uid === owner.uid ? currentIndex : null,
      special: !!opts.special, hit: opts.hit || null
    };
    projectiles.push(p);
    emit(currentReason === 'ultimate' ? 'ultimate' : currentReason === 'skill' ? 'skill' : 'attack', {
      ownerUid: owner.uid, targetUid: target.uid, x: owner.x, y: owner.y, targetX: target.x, targetY: target.y,
      skillIndex: p.skillIndex, projectileType: p.type, ability: p.type, source: 'v45'
    });
    return p;
  }
  function later(delay, fn) {
    if (!roomRef || typeof fn !== 'function') return;
    roomRef.sim.sourceDelayed.push({ in: clamp(Number(delay) || 0, 0, 30), fn, reason: currentReason, index: currentIndex, ownerUid: currentOwner?.uid || null });
    if (roomRef.sim.sourceDelayed.length > 500) roomRef.sim.sourceDelayed.splice(0, roomRef.sim.sourceDelayed.length - 500);
  }
  const tw = (f) => fighters.find(x => x.twin && x.mast === f.uid && !x.dead);
  function warp(f, x, y) {
    f.x = clamp(x, ARENA.x + (f.r || 22), ARENA.x + ARENA.w - (f.r || 22));
    f.y = clamp(y, ARENA.y + (f.r || 22), ARENA.y + ARENA.h - (f.r || 22));
  }
  function zD(f, angle, speed, duration) { f.vx = Math.cos(angle) * speed; f.vy = Math.sin(angle) * speed; f.dash = Math.max(f.dash || 0, duration || 0.3); }
  function zE(kind, owner, x, y, opts = {}) {
    const effect = createEffect('source_zone', x, y, owner, { r: opts.r || 60, duration: opts.d || 1, damage: opts.dmg || 0, interval: opts.iv || 0.4 });
    if (!effect) return null;
    effect.z = true; effect.s = owner?.id; effect.k = kind; effect.o = { ...opts, reason: currentReason, sourceIndex: currentIndex };
    effect.reason = currentReason; effect.sourceIndex = currentIndex; effect.tick = 0;
    effect.target = opts.tg || opts.ft || null;
    return effect;
  }
  function zP(owner, target, damage, speed, opts = {}) { return shoot(owner, target, 'zp', damage, speed, opts); }
  function fan(owner, target, n, speed, damage, spread, opts = {}) {
    if (!owner || !target) return [];
    const angle = Math.atan2(target.y - owner.y, target.x - owner.x), out = [];
    for (let i = 0; i < n; i++) {
      const p = zP(owner, target, damage, speed, opts); if (!p) continue;
      const a = angle + (i - (n - 1) / 2) * spread;
      p.vx = Math.cos(a) * speed; p.vy = Math.sin(a) * speed; p.rot = a; out.push(p);
    }
    return out;
  }
  const beam = (f, angle) => ({ x2: f.x + Math.cos(angle) * 750, y2: f.y + Math.sin(angle) * 750 });
  function spawnSummon(owner, name, life, angle, opts = {}) {
    if (!roomRef || !owner) return null;
    for (const q of fighters) if (q.twin && q.mast === owner.uid && !q.dead) { q.dead = true; }
    const id = owner.id;
    const hp = Math.max(20, Math.min(opts.hp || 90, 140));
    const f = {
      uid: crypto.randomUUID(), playerId: owner.playerId, playerIndex: owner.playerIndex, fighterId: id, id,
      team: owner.team, x: owner.x + Math.cos(angle) * 48, y: owner.y + Math.sin(angle) * 48,
      vx: Math.cos(angle) * 200, vy: Math.sin(angle) * 200, r: opts.r || 15, hp, maxHp: hp,
      shield: 0, age: 0, anim: 0, dead: false, koTime: 0, attackCD: 0.8, skillCD: [1.1,99,99,99],
      contactCD: 0.3, hitFlash: 0, invuln: 0, stun: 0, slow: 0, rooted: 0, burn: 0, energy: 0,
      lastDir: owner.lastDir || 1, melee: true, attackStyle: owner.attackStyle || 'starbolt', passiveTicks: 0,
      projectileCount: 0, markTarget: 0, twin: true, mast: owner.uid, grp: owner.uid, life: Math.min(life || 5, 10),
      pow: Math.min(opts.pow || 0.6, 1), name: name || 'Summon', sourceSummon: true, summonCooldown: 0
    };
    fighters.push(f);
    emit('summon', { ownerUid: owner.uid, targetUid: f.uid, x: f.x, y: f.y, name: f.name, life: f.life });
    return f;
  }
  function zSummon(owner, life, pow) { const a = Math.atan2(owner.vy, owner.vx) + Math.PI / 2; return spawnSummon(owner, 'Twin', life, a, { hp: 140, pow, r: 19 }); }
  function pSum(owner, name, life, angle, opts = {}) { return spawnSummon(owner, name, life, angle, opts); }
  function zPoof(f) { emit('summon_end', { ownerUid: f.mast || f.uid, targetUid: f.uid, x: f.x, y: f.y }); const master = fighters.find(x => x.uid === f.mast); if (master && master.id === 'gemini') master.shield = Math.min(api.sourceRules.shieldCapFor('gemini'), (master.shield || 0) + 8); }
  function zTwin(f, dt) { f.life -= dt; const master = fighters.find(x => x.uid === f.mast); if (f.life <= 0 || !master || master.dead) { f.dead = true; f.koTime = 0; zPoof(f); return true; } return false; }
  function pBL(f, x, y, damage) { zE('burst', f, f.x, f.y, { r: 45, d: 0.4 }); warp(f, x, y); zE('burst', f, f.x, f.y, { r: 80, d: 0.5, gr: 1, dmg: damage || 0, once: 1, dl: 0.05, kb: 120 }); }
  function pRP() { return { x: rand(ARENA.x + 60, ARENA.x + ARENA.w - 60), y: rand(ARENA.y + 60, ARENA.y + ARENA.h - 60) }; }
  function pStrike(f, x, y, damage) { later(0.35, () => zE('burst', f, x, y, { r: 95, d: 0.5, gr: 1, dmg: damage, once: 1, stun: 0.35, kb: 150 })); }
  function pFX(options = {}) { emit('source_visual', { ownerUid: currentOwner?.uid || null, fx: 'screen', ...options }); }
  function ultGate(f) { const next = f.sourceUltNext || 0; if (roomRef.sim.elapsed < next) return false; f.sourceUltNext = roomRef.sim.elapsed + rand(3.6, 6.2); return true; }
  function power(f) { return Math.max(0.6, Math.min(2, (f?.hp || 1) / (f?.maxHp || 1) + 0.8)); }
  function choice(list) { return list[Math.floor(Math.random() * list.length)]; }
  function ext(x) { return x; }
  function card(f, title) { emit('source_card', { ownerUid: f?.uid || null, title: String(title || '').slice(0, 50) }); }
  function playSfx() {}
  const PF = { kick: pFX };
  const GL = { hit() {}, kick() {} };
  const $ = () => ({ style: { setProperty() {} }, textContent: '', setAttribute() {} });
  function v13_3GainUlt(f, amount = 10) { if (f) f.energy = clamp((f.energy || 0) + amount, 0, 100); }
  function btE(kind, f, x, y, o = {}) { return zE(kind || 'ring', f, x ?? f.x, y ?? f.y, { ...o, dmg: o.dmg ?? o.damage ?? 0 }); }
  function btLive(f) { return !!(f && !f.dead && (f.hp > 0)); }
  function btPred(f) { return findTarget(f); }
  function btSpend(f) { const n = f?.btLone || 0; if (f) f.btLone = 0; return 1 + n / 100 * 0.6; }
  function cgChime() {} function clAnswerSfx() {} function clPing() {} function dolaChime() {} function gkChime() {} function mtAnswerSfx() {} function mtChime() {} function nl2Sound() {} function pxSound() {} function srEyesSfx() {} function srLanceSfx() {} function srTing() {} function svSnd() {} function mcSnapSfx() {} function eiSound() {} function foSound() {} function llSound() {} function btSound() {} function nlSound() {} function odSound() {}
  function llSX() { return ARENA.w/8; } function llSY() { return ARENA.h/8; }
  function llSqAt(i,j) { return {x:ARENA.x+(i+.5)*llSX(),y:ARENA.y+(j+.5)*llSY(),i,j}; }
  function llTile(f,x,y) { return zE('lltile',f,x,y,{r:40,d:1.6,dmg:6,iv:.35,s:26,q:0,slow:.35}); }
  function llBurst(f,c,dm,q,dl,r=60,ult=false,opts={}) { const e=zE('llburst',f,c.x,c.y,Object.assign({r,d:dl+.55,dmg:dm,once:1,iv:.05,dl,kb:120,q},opts));e.v10Skill=true;e.v10Ult=!!ult;return e; }
  function llBeam(f,a,b,dm,q,dl,w=14,ult=false,opts={}) { const e=zE('llbeam',f,a.x,a.y,Object.assign({r:20,d:dl+.5,x2:b.x,y2:b.y,w,dmg:dm,once:1,iv:.05,dl,kb:40,q},opts));e.v10Skill=true;e.v10Ult=!!ult;return e; }
  function llDiag(s,dx,dy) { let a=s.i,b=s.j,c=s.i,d=s.j;while(a-dx>=0&&a-dx<8&&b-dy>=0&&b-dy<8){a-=dx;b-=dy;}while(c+dx>=0&&c+dx<8&&d+dy>=0&&d+dy<8){c+=dx;d+=dy;}return [llSqAt(a,b),llSqAt(c,d)]; }
  function llSnap(p) { return llSqAt(clamp(Math.floor((p.x-ARENA.x)/llSX()),0,7),clamp(Math.floor((p.y-ARENA.y)/llSY()),0,7)); }
  function llPred(t,seconds=0) { return {x:clamp(t.x+t.vx*seconds,ARENA.x+36,ARENA.x+ARENA.w-36),y:clamp(t.y+t.vy*seconds,ARENA.y+36,ARENA.y+ARENA.h-36)}; }
  function llSqAt2(f, x, y, r, damage) { return llSqAt(f, x, y, r, damage); }
  function nlB(f,x,y,r,opts={}) { return zE('nlburst',f,x,y,Object.assign({r:r||70,d:.75},opts)); }
  function nlCR(i) { const size=ARENA.w/7; return {x:ARENA.x+(i%7)*size,y:ARENA.y+Math.floor(i/7)*size,s:size}; }
  function nlCell(x,y) { const size=ARENA.w/7;return clamp(Math.floor((y-ARENA.y)/size),0,6)*7+clamp(Math.floor((x-ARENA.x)/size),0,6); }
  function nlClear(f) { if (f) { f.invuln = Math.max(f.invuln || 0, 0.2); f.stun = 0; } }
  function nlErase(f,t,n=1) { if(!f||!t||f.dead||t.dead||t.twin)return;t.nlEr=(t.nlEr||0)+n;t.nlErLast=gameTime;hurt(t,Math.min(5,2*n),f,'skill'); }
  function nlFoes(f) { return fighters.filter(q=>q!==f&&!q.dead&&api.isEnemy(f,q,roomRef)); }
  function nlIn(x,y,m=30) { return {x:clamp(x,ARENA.x+m,ARENA.x+ARENA.w-m),y:clamp(y,ARENA.y+m,ARENA.y+ARENA.h-m)}; }
  function nlTear(f, t, damage = 9) { if (t) hurt(t, damage, f, 'skill'); }
  function nlHit(p,t,owner) { if(owner&&owner.id==='nullity')nlErase(owner,t,1); }
  function nlU(f) { return effects.find(e=>e.type==='nlult'&&e.owner===f?.uid&&e.age<e.duration)||null; }
  function nlVoidOn(f) { if(f)f.invuln=Math.max(f.invuln||0,.4); }
  function foAct(f, stage) { if (f) { f.focalorsStage = stage ?? ((f.focalorsStage || 0) + 1) % 3; emit('form_change', { ownerUid: f.uid, form: f.focalorsStage }); } }
  function foApplause(f, t) { if (t) hurt(t, 5, f, 'skill'); }
  function foBurst(f, c, damage=9.5, radius=62, delay=0.5, ult=false, opts={}) { const p = c && Number.isFinite(c.x) ? c : {x:f?.x||ARENA.x+ARENA.w/2,y:f?.y||ARENA.y+ARENA.h/2}; const e = zE('foburst', f, p.x, p.y, Object.assign({r:radius||62,d:(delay||0)+0.65,dmg:damage,once:1,iv:0.05,dl:delay||0,kb:130},opts)); if(e){e.v10Skill=true;e.v10Ult=!!ult;} return e; }
  function foFoes(f) { return nlFoes(f); }
  function foLine(f,a,b,damage=8,delay=.3,width=12,ult=false,opts={}){const e=zE('foline',f,a.x,a.y,Object.assign({r:20,d:delay+.5,x2:b.x,y2:b.y,w:width,dmg:damage,once:1,iv:.05,dl:delay,kb:60},opts));e.v10Skill=true;e.v10Ult=!!ult;return e;}
  function foM(f) { return f && f.foForm ? 1.08 : 1.4; }
  function foPred(t, seconds=0) { if (!t) return {x:ARENA.x+ARENA.w/2,y:ARENA.y+ARENA.h/2}; return {x:clamp(t.x+(t.vx||0)*seconds,ARENA.x+44,ARENA.x+ARENA.w-44),y:clamp(t.y+(t.vy||0)*seconds,ARENA.y+44,ARENA.y+ARENA.h-44)}; }
  function foStage(f) { return f?.focalorsStage || 0; }
  function eiB(f, x, y, r, d) { return zE('burst', f, x, y, { r: r || 70, d: 0.5, dmg: d || 0, once: 1 }); }
  function eiFoes(f) { return fighters.filter(q=>q!==f&&!q.dead&&api.isEnemy(f,q,roomRef)); }
  function eiIl(f,x,y,opts={}) { if(!f)return null;if(!f.eiIl)f.eiIl=[];const il=Object.assign({x,y,vx:0,vy:0,r:21,age:0,life:4,k:'decoy',pose:0,flash:0,seed:Math.random()*99,tc:.3},opts);f.eiIl.push(il);if(f.eiIl.length>48)f.eiIl.shift();return il; }
  function eiIn(x,y,m=30) { return {x:clamp(x,ARENA.x+m,ARENA.x+ARENA.w-m),y:clamp(y,ARENA.y+m,ARENA.y+ARENA.h-m)}; }
  function eiL(f,a,b,dm,dl,w=12,opts={}) { const e=zE('eiline',f,a.x,a.y,Object.assign({r:20,d:(dl||0)+.5,x2:b.x,y2:b.y,w,dl,kb:60},dm?{dmg:dm,once:1,iv:.05}:{fake:1},opts));e.v10Skill=true;e.v10Ult=!!opts.ult;return e; }
  function eiSwarm(f, t) { if (t) fan(f, t, 4, 260, 4.5, 0.3, { r: 5, homing: 0.2 }); }
  function eiU(f) { return effects.find(e=>e.type==='eiult'&&e.owner===f?.uid&&e.age<e.duration)||null; }
  function foE(f, x, y, o = {}) { return zE(o.k || 'ring', f, x, y, o); }
  function odE(f, x, y, o = {}) { return zE(o.k || 'burst', f, x, y, o); }
  function odAct(f, stage) { if (f) { f.sourceVariant = (Number.isInteger(stage) ? stage : ((f.sourceVariant || 0) + 1) % 3); f.odetteAct = f.sourceVariant; emit('form_change', { ownerUid: f.uid, form: f.sourceVariant }); } }
  function odHeal(f, n) { return heal(f, n || 5); }
  function odPred(f) { return findTarget(f); }
  function odSpark(f, x, y, n = 4) { spawnBurst(x, y, f, n); }
  function odFan(f, t, n = 3, speed = 300, damage = 5, spread = 0.2) { return fan(f, t || findTarget(f), n, speed, damage, spread); }
  function svE(f, x, y, o = {}) { return zE(o.k || 'burst', f, x, y, o); }
  function svMine(f, x, y, damage = 7) { return zE('burst', f, x, y, { r: 55, d: 0.8, dmg: damage, once: 1, dl: 0.4, kb: 90 }); }
  function svPred(f) { return findTarget(f); }
  function srFoe(f) { return findTarget(f); }
  function srFoes(f) { return nlFoes(f); }
  function srLive(f) { return !!(f && !f.dead && f.hp > 0); }
  function srClearField(f) { if (f) { f.rooted = 0; f.slow = 0; f.stun = 0; } }
  function srPosture(f, value) { if (f) f.seraphimPosture = value ?? ((f.seraphimPosture || 0) + 1) % 3; }
  function srEyesSfx() {} function srLanceSfx() {} function srTing() {}
  function foPredSfx() {} function clPing() {} function clAnswerSfx() {} function clAnswerSfx() {}
  function pxBurst(f,c,dm,ult=false,r=72){return zE('pxverdict',f,c.x,c.y,{r:r||72,d:.9,dmg:dm||0,once:1,dl:.03,iv:.05,kb:125,ult});}
  function pxLine(f,a,b,dm,ult=false,w=12){return zE('pxbeam',f,a.x,a.y,{r:20,d:.48,x2:b.x,y2:b.y,w,dmg:dm||0,once:1,iv:.05,dl:.02,kb:36,ult});}
  function pxNodes(c,r,angle){return Array.from({length:3},(_,i)=>({x:clamp(c.x+Math.cos(angle+i*Math.PI*2/3)*r,ARENA.x+14,ARENA.x+ARENA.w-14),y:clamp(c.y+Math.sin(angle+i*Math.PI*2/3)*r,ARENA.y+14,ARENA.y+ARENA.h-14)}));}
  function pxPredict(t,seconds=0){return {x:clamp(t.x+t.vx*seconds,ARENA.x+42,ARENA.x+ARENA.w-42),y:clamp(t.y+t.vy*seconds,ARENA.y+42,ARENA.y+ARENA.h-42)};}
  function foAct2(f, t) { return foAct(f, t); }
  function mcLive(f) { return srLive(f); }
  function mcClank() {}
  function mcEase(u){u=clamp(u,0,1);return u*u*(3-2*u);}
  function mcUnleash(f,dur=4,ult=false){if(!f||f.dead)return;f.mcSeals=0;f.mcUnr=dur;f.mcUnrMax=dur;f.mcRecoil=0;f.mcStrain=0;if(ult)f.mcBrk=[gameTime,gameTime,gameTime,gameTime,gameTime];zE('mcunleash',f,f.x,f.y,{r:190,d:1.1,fol:1});floatText(f.x,f.y-f.r-52,'UNRESTRAINED',MC.red,15);}
  function srEyesSfx2() {}
  function nl2Sound2() {}
  function clPing2() {}
  function pSumSafe(f, name, life, a, opts) { return pSum(f, name, life, a, opts); }

  // Source V45 helpers adapted to authoritative server state. The source's
  // original aliases called browser-only rendering/audio state, so these keep
  // their combat/status behavior without requiring DOM, canvas, or WebAudio.
  function FO_B_CHOIR(f, t, a=0) {
    if (!f || !t) return;
    const count = f.foForm ? 7 : 5;
    const multiplier = foM(f);
    fan(f, t, count, f.foForm ? 300 : 275, (f.foForm ? 3.1 : 4.3) * multiplier, 0.24, { r: 7, homing: 0.32, life: 2.5 });
    emit('focalors_choir', { ownerUid: f.uid, targetUid: t.uid, count, form: f.foForm || 0 });
  }
  function FO_B_SCALE(f, t, a=0) {
    if (!f || !t) return;
    const c = foPred(t, 0.75);
    foBurst(f, c, 9.5 * foM(f), 62, 0.5, false, { kb: 150, bub: 1, slow: 0.45, root: 0.28 });
    t.foScaleMark = { ownerUid: f.uid, x: c.x, y: c.y, expiresAt: gameTime + 1.6 };
    emit('focalors_scale', { ownerUid: f.uid, targetUid: t.uid, x: c.x, y: c.y });
  }
  function foAudioPlay() { /* audio is client-only; combat timeline runs on the server */ }
  function SR_Z_FACE(f, t) {
    if (!f) return;
    srPosture(f, 0); f.srFace = f.srFaceMax = 1.5; f.srAbs = 0; f.srReflect = 1;
    f.vx *= 0.4; f.vy *= 0.4;
    zE('srface', f, f.x, f.y, { r: 96, d: 1.7, fol: 1 });
    floatText(f.x, f.y-(f.r||22)-28, 'COVER THE FACE', SR.hot, 10);
  }
  function SR_Z_FLY(f, t) {
    if (!f || f.srUlt) return;
    srPosture(f, 2);
    const cx=ARENA.x+ARENA.w/2, cy=ARENA.y+ARENA.h/2;
    f.srFly = {t:0,dur:1.8,sx:f.x,sy:f.y,th0:Math.atan2(f.y-cy,f.x-cx),dir:Math.random()<0.5?1:-1,hit:[],tk:0};
    f.stun = 0;
    floatText(f.x, f.y-(f.r||22)-28, 'TAKE FLIGHT', SR.iris, 10);
  }

  function btPred2(f) { return findTarget(f); }
  function btLive2(f) { return srLive(f); }
  function clPing(f, t, damage = 6) { if (t) hurt(t, damage, f, 'skill'); }
  function clAnswerSfx2() {} function cgAnswerSfx() {} function mtPing() {} function dolaFX() {} function eiFx() {} function foFX() {} function llFX() {} function mcFX() {} function nlFX() {} function pxFX() {} function srFX() {} function svFX() {}

  function stepScheduled(room, dt) {
    syncRoom(room); gameTime = room.sim.elapsed;
    const pending = room.sim.sourceDelayed;
    for (const job of pending) job.in -= dt;
    for (let i = 0; i < pending.length; i++) {
      const job = pending[i]; if (job.in > 0) continue;
      pending.splice(i--, 1);
      const actor = fighters.find(f => f.uid === job.ownerUid) || null;
      withReason(job.reason, job.index, actor, () => {
        try { job.fn(); }
        catch (error) { api.emitEvent(room, 'ability_error', { handler: 'delayed', message: String(error?.message || error).slice(0, 120) }); }
      });
    }
    timeStop = room.sim.sourceTimeStop;
    fourthWall = room.sim.sourceFourthWall || (room.sim.sourceFourthWall = { timer: 0, x: 0, y: 0, side: 4, owner: null });
    if (timeStop.timer > 0) {
      timeStop.timer = Math.max(0, timeStop.timer - dt);
      const target = fighters.find(f => f.uid === timeStop.target && !f.dead);
      if (target) { target.vx *= 0.08; target.vy *= 0.08; target.stun = Math.max(target.stun || 0, 0.12); }
    }
    if (fourthWall.timer > 0) fourthWall.timer = Math.max(0, fourthWall.timer - dt);
  }
  function effectHits(owner, target) { return !!target && !target.dead && (!owner || api.isEnemy(owner, target, roomRef)); }
  function stepZoneEffect(e, dt) {
    const o = e.o || {}, owner = fighters.find(f => f.uid === e.owner) || null;
    if (o.fol && owner) { e.x = owner.x; e.y = owner.y; }
    if (o.ft) { const follow = fighters.find(f => f.uid === o.ft); if (follow) { e.x = follow.x; e.y = follow.y; } }
    if (e.age < (o.dl || 0)) return;
    e.zt = (e.zt || 0) - dt; if (e.zt > 0) return; e.zt = o.iv || 0.4;
    const ratio = e.age / Math.max(0.05, e.duration), radius = o.gr ? e.r * (0.25 + 0.9 * ratio) : e.r;
    for (const target of fighters) {
      if (!effectHits(owner, target) || G(target) === (owner ? G(owner) : null) || (o.only && target.uid !== o.only)) continue;
      const dx = e.x - target.x, dy = e.y - target.y;
      let hit = !!o.arena || Math.hypot(dx, dy) < radius + (target.r || 22);
      if (o.x2 !== undefined) {
        const sx = o.x2 - e.x, sy = o.y2 - e.y;
        const u = clamp(((target.x-e.x)*sx + (target.y-e.y)*sy)/(sx*sx + sy*sy || 1), 0, 1);
        hit = Math.hypot(target.x-e.x-sx*u, target.y-e.y-sy*u) < (o.w || 28) + (target.r || 22);
      } else if (e.k === 'cross') {
        hit = false; const n = o.n || 2;
        for (let j = 0; j < n; j++) { const a = e.age * 1.2 + j * Math.PI / n; if (Math.abs(-Math.sin(a)*(target.x-e.x)+Math.cos(a)*(target.y-e.y)) < (o.w || 30) + (target.r || 22)) hit = true; }
      } else if (o.ang !== undefined && hit) {
        const q = Math.atan2(-dy,-dx) - o.ang;
        if (Math.abs(Math.atan2(Math.sin(q), Math.cos(q))) > 0.85) hit = false;
      }
      if (!hit) continue;
      if (o.once) { e.hitSet = e.hitSet || new Set(); if (e.hitSet.has(target.uid)) continue; e.hitSet.add(target.uid); }
      withReason(o.reason || e.reason, o.sourceIndex ?? e.sourceIndex, owner, () => {
        if (o.dmg) hurt(target, o.dmg, owner, 'zodiac');
      });
      if (o.pull) { const a = Math.atan2(dy, dx); target.vx += Math.cos(a)*o.pull; target.vy += Math.sin(a)*o.pull; }
      if (o.kb) { const a = Math.atan2(-dy, -dx); target.vx += Math.cos(a)*o.kb; target.vy += Math.sin(a)*o.kb; }
      if (o.slow) target.slow = Math.max(target.slow || 0, o.slow);
      if (o.root) target.rooted = Math.max(target.rooted || 0, o.root);
      if (o.stun) target.stun = Math.max(target.stun || 0, o.stun);
      if (o.heal && owner) heal(owner, o.heal);
    }
  }
  function stepCoreEffect(e, dt) {
    const owner = fighters.find(f => f.uid === e.owner) || null;
    e.tick = (e.tick || 0) - dt;
    if (e.tick > 0) return;
    e.tick = e.interval || 0.45;
    const ratio = e.age / Math.max(0.05, e.duration);
    for (const target of fighters) {
      if (!effectHits(owner, target)) continue;
      let radius = e.r;
      if (ARENA_WIDE_EFFECTS.has(e.type)) radius = e.r + ratio * 35;
      if (e.type === 'cometstorm') radius = 45 + Math.abs(Math.sin(e.age * 9)) * e.r;
      if (EXPANDING_EFFECTS.has(e.type)) radius = ratio * e.r;
      if (e.target && e.target !== target.uid && !ARENA_WIDE_EFFECTS.has(e.type)) continue;
      const d = distanceTo(e, target);
      if (d >= radius + (target.r || 22)) continue;
      withReason(e.reason, e.sourceIndex, owner, () => { if (e.damage > 0) hurt(target, e.damage, owner, 'impact'); });
      if (EFFECT_PULL.has(e.type)) { const a = Math.atan2(e.y-target.y, e.x-target.x); target.vx += Math.cos(a) * (e.type === 'horizon' ? 112 : 18); target.vy += Math.sin(a) * (e.type === 'horizon' ? 112 : 18); }
      if (EFFECT_SLOW.has(e.type)) target.slow = Math.max(target.slow || 0, 0.5);
      if (EFFECT_ROOT.has(e.type)) target.rooted = Math.max(target.rooted || 0, 0.3);
      if (['eclipsekiss','totaleclipse'].includes(e.type) && owner?.id === 'lunar') heal(owner, 1.8);
      if (e.type === 'framebreak' && Math.random() < 0.22) { target.vx += (e.x-target.x)*0.015; target.vy += (e.y-target.y)*0.015; }
    }
  }
  function stepEffects(room, dt) {
    syncRoom(room); gameTime = room.sim.elapsed;
    for (const e of effects) {
      e.age += dt;
      if (e.z) stepZoneEffect(e, dt);
      else if (RADIAL_EFFECTS.has(e.type)) stepCoreEffect(e, dt);
      else {
        // Non-damaging named effects can still carry a one-shot source hit and status.
        if (!e.once && e.damage > 0 && e.age >= Math.min(0.12, e.duration * 0.25)) {
          e.once = true; const owner = fighters.find(f => f.uid === e.owner) || null;
          const target = (e.target && fighters.find(f => f.uid === e.target)) || owner && findTarget(owner);
          if (target && effectHits(owner, target)) withReason(e.reason, e.sourceIndex, owner, () => hurt(target, e.damage, owner, 'skill'));
        }
      }
    }
    room.sim.sourceEffects = effects.filter(e => e.age < e.duration);
    effects = room.sim.sourceEffects;
  }
  function buildVariant(f) {
    const entry = CATALOG.fighters.find(x => x.id === f.id);
    if (!entry) return null;
    let ix = Number.isInteger(f.sourceVariant) ? f.sourceVariant : 0;
    if (f.id === 'odette') ix = clamp(Number.isInteger(f.odetteAct) ? f.odetteAct : ix, 0, 2);
    if (f.id === 'lovers') ix = clamp(Number.isInteger(f.loversLead) ? f.loversLead : ix, 0, 1);
    return entry.variants[ix] || entry.variants[0] || null;
  }
  function handlerFor(f, index) { const v = buildVariant(f); return v?.skills?.[index]?.handler || null; }
  // The original V45 handler bodies are kept in source initialization order.
const SOURCE_ZS = {
// ARIES
ramRush:(f,t,a)=>{zD(f,a,540,.42);zE('trail',f,f.x,f.y,{r:46,d:.55,dmg:9,once:1,iv:.08,fol:1,kb:110});},
hornShatter:(f,t,a)=>zE('burst',f,f.x+Math.cos(a)*28,f.y+Math.sin(a)*28,{r:115,d:.55,gr:1,dmg:13,once:1,dl:.16,iv:.05,kb:190}),
battleCry:f=>{f.shield=Math.min(36,f.shield+14);zE('ring',f,f.x,f.y,{r:150,d:.9,gr:1,dmg:5,once:1,dl:.2,iv:.05,slow:1.1,kb:70,fol:1});},
stampede:f=>{for(let n=0;n<3;n++)later(n*.55,()=>{const tg=findTarget(f);if(!tg||f.dead)return;zD(f,Math.atan2(tg.y-f.y,tg.x-f.x),570,.45);zE('trail',f,f.x,f.y,{r:48,d:.6,dmg:10,once:1,iv:.08,fol:1,kb:120});later(.4,()=>zE('ring',f,f.x,f.y,{r:120,d:.6,gr:1,dmg:6,once:1,dl:.1,kb:90}));});},
// TAURUS
goreCharge:(f,t,a)=>{zD(f,a,430,.5);zE('trail',f,f.x,f.y,{r:52,d:.6,dmg:13,once:1,iv:.08,fol:1,kb:170});},
faultLine:(f,t,a)=>zE('line',f,f.x,f.y,{d:1.4,r:10,dmg:5.5,iv:.3,slow:.8,w:30,...beam(f,a)}),
boulder:(f,t)=>{zP(f,t,15,235,{r:11,life:2.6,homing:.28,hit:(p,tg,ow)=>zE('burst',ow,p.x,p.y,{r:75,d:.6,gr:1,dmg:5,once:1,dl:.1,kb:130})});},
tectonic:f=>zE('rain',f,W/2,H/2,{r:300,d:3.2,arena:1,dmg:6.2,iv:.5,stun:.3}),
// GEMINI
mirrorDart:(f,t)=>{fan(f,t,2,330,7.5,.2,{r:6,homing:.3});const x=tw(f);if(x)fan(x,t,2,330,6,.2,{r:6,homing:.3});},
summonTwin:f=>{zSummon(f,9,.65);zE('ring',f,f.x,f.y,{r:70,d:.7,gr:1});},
binarySwap:(f,t,a)=>{const x=tw(f);let nx,ny;zE('burst',f,f.x,f.y,{r:50,d:.5});if(x){nx=x.x;ny=x.y;x.x=f.x;x.y=f.y;}else{nx=t.x-Math.cos(a)*58;ny=t.y-Math.sin(a)*58;}warp(f,nx,ny);zE('burst',f,f.x,f.y,{r:90,d:.6,gr:1,dmg:12,once:1,dl:.1,kb:100});},
twinParadox:f=>{zSummon(f,10.5,.72);zE('cross',f,W/2,H/2,{r:300,d:3.2,dmg:9,iv:.35,n:2,w:30});},
// CANCER
pincerSnap:(f,t)=>zE('burst',f,t.x,t.y,{r:80,d:.6,gr:1,dmg:12,once:1,dl:.2,kb:-70}),
tidalShell:f=>{f.shield=Math.min(22,f.shield+4);zE('orbit',f,f.x,f.y,{r:62,d:2.4,dmg:3.6,iv:.5,fol:1,kb:35});},
moonBubbles:(f,t)=>fan(f,t,3,175,6,.5,{r:9,homing:.5,life:3,hit:(p,tg)=>{tg.slow=Math.max(tg.slow,1.5);}}),
lunarTide:f=>{f.shield=Math.min(22,f.shield+4);zE('ring',f,W/2,H/2,{r:330,d:3.2,arena:1,dmg:6,iv:.5,slow:.9,heal:1.0,gr:1});},
// LEO
maneFlare:f=>zE('burst',f,f.x,f.y,{r:108,d:.7,gr:1,dmg:12,once:1,dl:.15,kb:105}),
royalClaw:(f,t,a)=>{for(let n=0;n<3;n++)later(n*.14,()=>{if(f.dead)return;const tg=findTarget(f),b=tg?Math.atan2(tg.y-f.y,tg.x-f.x):a;zE('cone',f,f.x,f.y,{r:125,d:.35,dmg:5.5,once:1,dl:.05,kb:30,ang:b+(n-1)*.5});});},
solarRoar:(f,t,a)=>zE('cone',f,f.x,f.y,{r:210,d:.7,gr:1,dmg:9,once:1,dl:.2,kb:200,stun:.4,ang:a}),
solarCourt:f=>zE('cross',f,W/2,H/2,{r:320,d:3.4,dmg:8,iv:.38,n:3,w:30}),
// VIRGO
wheatVolley:(f,t)=>fan(f,t,3,265,6.5,.22,{r:6,homing:.25,life:2.2}),
purityVeil:f=>{heal(f,14);f.shield=Math.min(30,f.shield+10);zE('ring',f,f.x,f.y,{r:78,d:.9,gr:1,fol:1,dmg:4,once:1,dl:.2,kb:40});},
reapingGrain:(f,t)=>zE('field',f,t.x,t.y,{r:88,d:2.2,dmg:3.8,iv:.42,heal:.75}),
grandHarvest:f=>zE('rain',f,W/2,H/2,{r:300,d:3.2,arena:1,dmg:5.5,iv:.45,heal:.8}),
// LIBRA
balanceStrike:(f,t)=>{hurt(t,11+Math.min(14,Math.max(0,t.hp-f.hp)*.12),f,'balance');zE('line',f,f.x,f.y,{d:.5,r:10,x2:t.x,y2:t.y});},
scaleSwing:f=>zE('orbit',f,f.x,f.y,{r:88,d:1.4,dmg:5,iv:.35,fol:1,kb:50}),
verdict:(f,t)=>{const x=clamp((t.hp-f.hp)*.12+6,5,16);hurt(t,x*1.1,f,'verdict');heal(f,x*.8);zE('ring',f,t.x,t.y,{r:70,d:.7,gr:1});},
scalesJudgement:f=>{zE('cross',f,W/2,H/2,{r:320,d:3.3,dmg:9,iv:.4,n:1,w:38});later(2.9,()=>{const tg=findTarget(f);if(!tg||f.dead)return;const d=clamp((tg.hp-f.hp)/2,0,28);if(d>0){f.hp=Math.min(f.maxHp,f.hp+d);tg.hp=Math.max(1,tg.hp-d);floatText(f.x,f.y-34,'BALANCED','#ffb3df',13);}});},
// SCORPIO
tailLash:(f,t,a,d)=>{if(d<250){zE('line',f,f.x,f.y,{d:.45,r:10,x2:t.x,y2:t.y});hurt(t,15,f,'sting');}else zP(f,t,12,380,{r:7,life:1.4});},
burrow:(f,t,a)=>{f.invuln=.5;zE('burst',f,f.x,f.y,{r:55,d:.5});later(.45,()=>{if(f.dead)return;const tg=findTarget(f);if(!tg)return;warp(f,tg.x-Math.cos(a)*50,tg.y-Math.sin(a)*50);zE('burst',f,f.x,f.y,{r:95,d:.55,gr:1,dmg:11,once:1,dl:.1,kb:120});});},
stingerBarrage:(f,t)=>fan(f,t,3,335,6,.14,{r:5,life:1.8}),
antares:(f,t)=>{t.markTarget=1.6;zE('ring',f,t.x,t.y,{r:80,d:1.5,ft:t.uid});later(1.5,()=>{const tg=findTarget(f);if(!tg||f.dead)return;hurt(tg,26*(tg.burn>0?1.5:1),f,'execute');zE('burst',f,tg.x,tg.y,{r:135,d:.8,gr:1,dmg:8,once:1,dl:.1,kb:140});});},
// SAGITTARIUS
starshot:(f,t)=>zP(f,t,13,440,{r:6,pierce:1,life:1.6}),
ricochet:(f,t)=>{const p=zP(f,t,10,370,{r:6,life:3.4});if(p)p.bn=2;},
galloping:f=>{for(let n=0;n<5;n++)later(n*.1,()=>{const tg=findTarget(f);if(tg&&!f.dead)zP(f,tg,6,410,{r:5,life:1.5,homing:.05});});},
meridian:(f,t)=>{zE('rain',f,W/2,H/2,{r:300,d:3,arena:1,dmg:5.5,iv:.3});zP(f,t,28,600,{r:12,pierce:2,life:2});},
// CAPRICORN
glacialHorn:(f,t,a)=>{zD(f,a,410,.4);zE('trail',f,f.x,f.y,{r:48,d:.55,dmg:11,once:1,iv:.08,fol:1,slow:1,kb:110});},
frostSpiral:f=>zE('spiral',f,f.x,f.y,{r:125,d:1.8,gr:1,dmg:4.5,iv:.4,slow:.8,fol:1}),
brinefreeze:(f,t)=>zP(f,t,9,300,{r:9,homing:.3,life:2.4,hit:(p,tg,ow)=>{tg.rooted=Math.max(tg.rooted,.9);zE('field',ow,tg.x,tg.y,{r:55,d:.9});}}),
absoluteZero:f=>zE('spiral',f,W/2,H/2,{r:330,d:3.3,arena:1,dmg:6,iv:.45,slow:1.1,gr:1}),
// AQUARIUS
jugPour:(f,t,a)=>zE('line',f,f.x,f.y,{d:.9,r:10,dmg:4,iv:.15,slow:.7,w:26,...beam(f,a)}),
dropletOrbit:f=>{zE('orbit',f,f.x,f.y,{r:55,d:1,fol:1});later(1,()=>{const tg=findTarget(f);if(tg&&!f.dead)fan(f,tg,4,300,5.5,.28,{r:6,homing:.3});});},
cosmicCurrent:(f,t,a)=>zE('cone',f,f.x,f.y,{r:260,d:.9,gr:1,dmg:7,once:1,dl:.2,kb:300,slow:.8,ang:a}),
ageAquarius:f=>zE('rain',f,W/2,H/2,{r:300,d:3.4,arena:1,dmg:5.5,iv:.4,slow:.9,kb:-25}),
// PISCES
twinCurrent:(f,t)=>fan(f,t,2,250,6.5,.9,{r:7,homing:.7,life:2.4}),
tideRibbon:(f,t)=>zE('tether',f,f.x,f.y,{d:2.1,r:10,fol:1,only:t.uid,tg:t.uid,arena:1,dmg:3.5,iv:.4,pull:15}),
dreamward:(f,t,a)=>{f.invuln=.14;heal(f,2.8);f.vx=-Math.cos(a)*210;f.vy=-Math.sin(a)*210;zE('ring',f,f.x,f.y,{r:80,d:.8,gr:1,fol:1});zE('orbit',f,f.x,f.y,{r:46,d:.8,fol:1});},
oceanDreams:f=>zE('spiral',f,W/2,H/2,{r:330,d:3.4,arena:1,dmg:5.8,iv:.42,pull:10,heal:.35,slow:.7})
};

Object.assign(SOURCE_ZS,{pMin:(f,t)=>zP(f,t,6,300,{r:5,life:1.8,homing:.25}),
/* MERCURY */
wingDash:(f,t,a)=>{zD(f,a,620,.34);zE('trail',f,f.x,f.y,{r:44,d:.5,dmg:9,once:1,iv:.07,fol:1,kb:90});pFX({ch:.9});},
quickBlink:(f,t,a)=>{f.invuln=.08;pBL(f,t.x-Math.cos(a)*55,t.y-Math.sin(a)*55,11);zE('cone',f,f.x,f.y,{r:120,d:.3,dmg:7,once:1,dl:.1,ang:a,kb:140});pFX({ch:1.4});},
caduceus:(f,t)=>{fan(f,t,5,420,5.5,.2,{r:5,homing:.4,life:2});later(.35,()=>{const g=findTarget(f);if(g&&!f.dead)fan(f,g,5,420,5.5,.2,{r:5,homing:.4,life:2});});},
godSpeed:f=>{pFX({inv:1,ch:3,hue:40,ht:1.2});for(let n=0;n<6;n++)later(n*.2,()=>{const g=findTarget(f);if(!g||f.dead)return;const a=rand(0,6.28);f.invuln=.06;pBL(f,g.x+Math.cos(a)*50,g.y+Math.sin(a)*50,13);zE('ring',f,g.x,g.y,{r:90,d:.4,gr:1,dmg:5,once:1,kb:90});pFX({ch:2.5});heal(f,2);});later(1.35,()=>{pFX({solid:.15,ch:4});zE('cross',f,W/2,H/2,{r:300,d:1.2,dmg:8,iv:.2,n:4,w:26});});},
/* VENUS */
rosePetals:(f,t)=>fan(f,t,3,300,6,.35,{r:7,homing:.45,life:2.2,hit:(p,g,o)=>heal(own(o),3.5)}),
charm:(f,t)=>zE('tether',f,f.x,f.y,{d:2.4,r:10,fol:1,only:t.uid,tg:t.uid,arena:1,dmg:3.2,iv:.3,pull:16,heal:2.4}),
veilBlink:(f,t,a)=>{zE('spiral',f,f.x,f.y,{r:95,d:2,gr:1,dmg:4,iv:.4,slow:.9});pBL(f,f.x-Math.cos(a)*150,f.y-Math.sin(a)*150,0);zE('field',f,f.x,f.y,{r:70,d:1.4,dmg:3,iv:.35,slow:.6});heal(f,6);},
heartStar:(f,t,a)=>{pFX({solid:.25,inv:1.2,hue:300,ht:2,ch:2});zE('spiral',f,W/2,H/2,{r:340,d:3.4,arena:1,dmg:5.4,iv:.4,pull:12,heal:2.8,slow:.6,gr:1});pSum(f,'Cupid',9,a+1.2,{col:'#ff9ad0',tp:['#fff0f8','#ff8fc9','#7a2a5e']});pSum(f,'Cupid',9,a-1.2,{col:'#ff9ad0',tp:['#fff0f8','#ff8fc9','#7a2a5e']});},
/* EARTH */
quake:f=>{zE('ring',f,f.x,f.y,{r:150,d:.7,gr:1,dmg:8,once:1,dl:.1,stun:.35,kb:145,fol:1});zE('ring',f,f.x,f.y,{r:210,d:1,gr:1,dmg:3.5,once:1,dl:.3,kb:90,fol:1});pFX({ch:1.2});},
moonSummon:(f,t,a)=>{pSum(f,'Luna',10,a+1.57,{r:17,hp:130,pow:.8,tp:['#ffffff','#d8d8e8','#5a5a70'],col:'#e0e0f0'});zE('ring',f,f.x,f.y,{r:70,d:.6,gr:1});},
magnetosphere:f=>{f.shield=Math.min(26,f.shield+16);zE('orbit',f,f.x,f.y,{r:68,d:3,dmg:4,iv:.4,fol:1,kb:80});zE('ring',f,f.x,f.y,{r:120,d:1,gr:1,dmg:3,once:1,kb:140,fol:1});},
extinction:f=>{pFX({ch:3,hue:-30,ht:1.8,rot:.1,rt:2});zE('rain',f,W/2,H/2,{r:300,d:3.2,arena:1,dmg:4.0,iv:.45,stun:.25});for(let n=0;n<5;n++)later(.3+n*.5,()=>{const p=pRP();zE('burst',f,p.x,p.y,{r:100,d:.6,gr:1,dmg:6,once:1,kb:160});pFX({ch:2});});},
/* MARS */
marsSpear:(f,t,a)=>{zD(f,a,520,.3);zP(f,t,16,500,{r:8,pierce:2,life:1.5,hit:(p,g)=>{g.rooted=Math.max(g.rooted,.6);}});zE('trail',f,f.x,f.y,{r:46,d:.45,dmg:8,once:1,iv:.07,fol:1,kb:100});},
warDrums:f=>{for(let n=0;n<3;n++)later(n*.3,()=>{zE('ring',f,f.x,f.y,{r:135,d:.7,gr:1,dmg:6,once:1,dl:.05,kb:110,fol:1});f.shield=Math.min(50,f.shield+6);pFX({ch:1.4});});},
twinMoons:(f,t,a)=>{pSum(f,'Phobos',8,a+1.9,{r:12,hp:70,pow:.55,col:'#ff9a5a',tp:['#ffe0c0','#ff7a3a','#5a1608']});pSum(f,'Deimos',8,a-1.9,{r:11,hp:60,pow:.55,col:'#ff6a4a',tp:['#ffd0c0','#e0452a','#4a1008']});},
warWorlds:f=>{pFX({solid:.18,inv:1.4,hue:-20,ht:2.2,ch:3});for(let n=0;n<4;n++)later(n*.5,()=>{const g=findTarget(f);if(!g||f.dead)return;zD(f,Math.atan2(g.y-f.y,g.x-f.x),640,.4);zE('trail',f,f.x,f.y,{r:48,d:.5,dmg:11,once:1,iv:.07,fol:1,kb:140});later(.38,()=>zE('ring',f,f.x,f.y,{r:130,d:.6,gr:1,dmg:7,once:1,kb:130}));pFX({ch:2.2});});zE('cross',f,W/2,H/2,{r:320,d:3,dmg:6,iv:.4,n:2,w:24});},
/* JUPITER */
bolt:(f,t)=>pStrike(f,t.x,t.y,17),
redSpot:(f,t)=>zE('spiral',f,t.x,t.y,{r:105,d:2.6,dmg:4.6,iv:.35,slow:.9,ft:t.uid}),
galileans:f=>{zE('orbit',f,f.x,f.y,{r:70,d:1.6,dmg:5,iv:.3,fol:1,kb:60});later(1.6,()=>{const g=findTarget(f);if(g&&!f.dead)fan(f,g,4,360,7,.25,{r:7,homing:.3,life:2});});},
jovesWrath:(f,t)=>{pFX({inv:1.6,ch:4,hue:50,ht:.9});for(let n=0;n<7;n++)later(.2+n*.32,()=>{const g=findTarget(f),p=n%2&&g?{x:g.x,y:g.y}:pRP();pStrike(f,p.x,p.y,11);});},
/* SATURN */
ringSlice:(f,t)=>fan(f,t,2,380,10,.5,{r:8,pierce:2,life:2.2}),
devour:f=>{zE('ring',f,f.x,f.y,{r:105,d:2,dmg:4.2,iv:.3,fol:1,slow:.8,heal:3.4});pFX({hue:-60,ht:.6});},
ringPrison:(f,t)=>{zE('orbit',f,t.x,t.y,{r:60,d:2.2,dmg:4,iv:.35,ft:t.uid,root:.5});zE('ring',f,t.x,t.y,{r:42,d:2.2,ft:t.uid});},
cronusRings:f=>{pFX({solid:.9,ch:2,hue:200,ht:2.4});for(const e of fighters)if(!e.dead&&G(e)!==G(f))e.stun=Math.max(e.stun,.9);for(const r of[110,190,270])zE('ring',f,W/2,H/2,{r,d:2.8,gr:1,dmg:5,iv:.4,slow:.9});},
/* URANUS */
sideRoll:(f,t,a)=>{zD(f,a+1.57,500,.28);zE('trail',f,f.x,f.y,{r:42,d:.4,dmg:6,once:1,iv:.07,fol:1,slow:.6});later(.3,()=>{const g=findTarget(f);if(g&&!f.dead){zD(f,Math.atan2(g.y-f.y,g.x-f.x),560,.3);zE('trail',f,f.x,f.y,{r:46,d:.4,dmg:10,once:1,iv:.07,fol:1,slow:.8,kb:100});}});},
gale:(f,t,a)=>{zE('cone',f,f.x,f.y,{r:250,d:.9,gr:1,dmg:6,once:1,dl:.15,kb:330,slow:1,ang:a});pFX({ch:1.6});},
axisTilt:(f,t)=>{t.vx=-t.vx*1.4;t.vy=-t.vy*1.4;t.stun=Math.max(t.stun,.5);zE('ring',f,t.x,t.y,{r:80,d:.6,gr:1,dmg:8,once:1});pFX({rot:.3,rt:1,ch:2,hue:90,ht:.8});},
tiltWorld:f=>{pFX({rot:1.5,rt:2.6,ch:2.5,hue:150,ht:2.6});zE('rain',f,W/2,H/2,{r:300,d:3,arena:1,dmg:5.5,iv:.4,slow:1,kb:20});for(let n=0;n<3;n++)later(n*.7,()=>{const y=rand(ARENA.y+100,ARENA.y+ARENA.h-100);zE('line',f,ARENA.x,y,{d:.9,r:10,dmg:8,iv:.2,w:34,x2:ARENA.x+ARENA.w,y2:y});});},
/* NEPTUNE */
trident:(f,t)=>fan(f,t,3,400,8,.24,{r:7,pierce:1,life:1.8}),
riptide:(f,t,a)=>{zD(f,a,420,.35);zE('spiral',f,t.x,t.y,{r:100,d:1.8,dmg:4.4,iv:.35,pull:20,ft:t.uid});},
krakenSummon:(f,t,a)=>{pSum(f,'Triton',10,a+1.5,{r:18,hp:130,pow:.8,col:'#6aa8ff',tp:['#e0f0ff','#4a8aff','#103a8a']});zE('ring',f,f.x,f.y,{r:80,d:.7,gr:1,slow:.8,dmg:3,once:1});},
tempestDeep:f=>{pFX({hue:200,ht:2.8,ch:3,rot:.2,rt:2.8});zE('spiral',f,W/2,H/2,{r:340,d:3.4,arena:1,dmg:5.8,iv:.4,pull:14,slow:.8,gr:1});for(let n=0;n<3;n++)later(n*.9,()=>{const y=pRP().y;zE('line',f,ARENA.x,y,{d:.8,r:10,dmg:10,iv:.15,w:40,x2:ARENA.x+ARENA.w,y2:y,kb:200});});},
/* PLUTO */
soulDrain:(f,t)=>zE('tether',f,f.x,f.y,{d:2.2,r:10,fol:1,only:t.uid,tg:t.uid,arena:1,dmg:3.6,iv:.3,pull:10,heal:3}),
charonFerry:(f,t)=>{const x=f.x,y=f.y;zE('burst',f,x,y,{r:60,d:.5});warp(f,t.x,t.y);warp(t,x,y);t.stun=Math.max(t.stun,.5);zE('burst',f,f.x,f.y,{r:90,d:.6,gr:1,dmg:11,once:1,kb:140});pFX({solid:.18,ch:2.5});},
cerberus:(f,t,a)=>{for(let k=0;k<3;k++)pSum(f,'Hellhound',7,a+k*2.1,{r:11,hp:55,pow:.5,col:'#ff6a3a',tp:['#ffd0b0','#ff6a3a','#4a1008']});},
underworld:f=>{pFX({solid:2,ch:3.5});zE('spiral',f,W/2,H/2,{r:340,d:3.4,arena:1,dmg:5.8,iv:.4,pull:12,heal:2.6,slow:.7,gr:1});later(1,()=>{pFX({inv:.9,ch:4});zE('cross',f,W/2,H/2,{r:300,d:1.8,dmg:7,iv:.3,n:3,w:28});});},
/* CERES */
sickle:f=>{zE('orbit',f,f.x,f.y,{r:58,d:1.2,dmg:3.5,iv:.3,fol:1});later(1.2,()=>{const g=findTarget(f);if(g&&!f.dead)fan(f,g,5,380,6,.22,{r:6,life:1.8,hit:(p,g2,o)=>heal(own(o),1.5)});});},
harvest:f=>{heal(f,14);zE('ring',f,f.x,f.y,{r:120,d:1.8,gr:1,dmg:4,iv:.35,fol:1,heal:2.5});},
beltSurge:(f,t,a)=>{zD(f,a,480,.3);for(let k=-1;k<=1;k++)zE('line',f,f.x,f.y,{d:1,r:10,dmg:5,iv:.15,w:22,...beam(f,a+k*.35)});},
beltHarvest:f=>{pFX({hue:50,ht:2.4,ch:3,inv:.5});zE('cross',f,W/2,H/2,{r:320,d:3.4,dmg:7,iv:.38,n:3,w:30,heal:1.6});zE('rain',f,W/2,H/2,{r:300,d:3.2,arena:1,dmg:4,iv:.5,heal:1.2});}});

Object.assign(SOURCE_ZS,{
sdStar:(f,t)=>zP(f,t,5,260,{r:7,homing:.35,life:2,hit:(p,g,o)=>{const ow=own(o);later(.05,()=>{if(g&&!g.dead)zE('burst',ow,g.x,g.y,{r:62,d:.9,dmg:7,once:1,dl:.55,iv:.1,kb:60,vis:'sdmine'});});}}),
sdSweep:(f,t,a)=>{zD(f,a,540,.3);for(let k=0;k<3;k++)later(.06+k*.09,()=>zE('burst',f,f.x,f.y,{r:48,d:1.1,dmg:6,once:1,dl:.6,iv:.1,kb:50,vis:'sdmine'}));},
sdSnare:(f,t)=>{f.shield=Math.min(14,f.shield+4);zE('ring',f,t.x,t.y,{r:100,d:1.9,dmg:7,once:1,dl:.85,iv:.1,slow:1.1,vis:'sdcon'});},
sdDipper:f=>{pFX({hue:45,ht:1.6,ch:2});const P=[[.12,.62],[.26,.55],[.40,.58],[.52,.48],[.55,.30],[.78,.24],[.80,.42]];P.forEach((q,i)=>later(i*.22,()=>zE('burst',f,ARENA.x+q[0]*ARENA.w,ARENA.y+q[1]*ARENA.h,{r:75,d:1,dmg:5,once:1,dl:.4,stun:.15,kb:100,vis:'sdfall'})));later(1.9,()=>{const g=findTarget(f);if(g&&!f.dead)zE('burst',f,g.x,g.y,{r:170,d:1,dmg:12,once:1,dl:.35,kb:160,stun:.35,vis:'flare',col:'#ffe28a'});});},
cnMatch:(f,t,a)=>{zD(f,a,500,.3);zE('trail',f,f.x,f.y,{r:40,d:.5,dmg:6,once:1,iv:.08,fol:1,kb:80});for(let k=0;k<3;k++)later(.05+k*.1,()=>zE('ring',f,f.x,f.y,{r:36,d:2.4,dmg:2.2,iv:.4,vis:'cnember'}));},
cnSmoke:(f,t,a)=>{zE('field',f,f.x,f.y,{r:95,d:2.4,dmg:0,iv:.35,slow:.7,vis:'cnsmoke'});f.invuln=.12;f.shield=Math.min(14,f.shield+4);warp(f,f.x-Math.cos(a)*160,f.y-Math.sin(a)*160);zE('field',f,f.x,f.y,{r:55,d:1.2,dmg:0,iv:.5,vis:'cnsmoke'});},
cnPop:f=>{for(let k=0;k<5;k++)later(k*.12,()=>{const g=findTarget(f);if(!g||f.dead)return;zE('burst',f,g.x+rand(-85,85),g.y+rand(-85,85),{r:55,d:.9,dmg:6,once:1,dl:.5,iv:.05,kb:100,vis:'cnpop'});});},
cnErupt:f=>{pFX({hue:-15,ht:1.4,ch:2.5});zE('ring',f,W/2,H/2,{r:340,d:2.6,iv:9,arena:1,vis:'cncrack'});for(let i=0;i<8;i++)later(.9+i*.2,()=>{const g=findTarget(f);if(f.dead)return;const px=(i<3&&g)?g.x+rand(-30,30):pRP().x,py=(i<3&&g)?g.y+rand(-30,30):pRP().y;zE('burst',f,px,py,{r:70,d:.8,dmg:7,once:1,dl:.35,kb:140,vis:'cngeyser'});});},
mbBeam:(f,t,a)=>{heal(f,1.5);zE('line',f,f.x,f.y,{d:.55,r:10,dmg:7,iv:.1,w:20,vis:'mbbeam',...beam(f,a)});},
mbEclipse:(f,t)=>zE('ring',f,t.x,t.y,{r:72,d:1.6,dmg:4,once:1,dl:.45,root:.55,iv:.1,vis:'mbeclipse'}),
mbTide:f=>{heal(f,5);zE('ring',f,f.x,f.y,{r:150,d:1.5,dmg:2.8,iv:.25,pull:14,fol:1,vis:'mbtide'});later(1.4,()=>zE('ring',f,f.x,f.y,{r:120,d:.5,gr:1,dmg:7,once:1,kb:220,vis:'mbtide'}));},
mbEcl:f=>{pFX({inv:.5,hue:20,ht:1.6,ch:1.5});zE('field',f,W/2,H/2,{r:320,d:3.2,arena:1,dmg:3.3,iv:.45,slow:.5,heal:1.2,vis:'mbecl'});later(2.6,()=>zE('burst',f,W/2,H/2,{r:260,d:.7,gr:1,dmg:9,once:1,kb:160,vis:'flare',col:'#e8f0ff'}));},
pbSpit:(f,t,a)=>{fan(f,t,6,380,3.5,.16,{r:4,life:.55});f.vx-=Math.cos(a)*70;f.vy-=Math.sin(a)*70;},
pbRoll:(f,t,a)=>{zD(f,a,470,.8);f.shield=Math.min(26,f.shield+5);zE('trail',f,f.x,f.y,{r:46,d:.9,dmg:5,iv:.1,fol:1,kb:100,vis:'pbroll'});},
pbFall:f=>{for(let k=0;k<3;k++)later(k*.2,()=>{const g=findTarget(f);if(!g||f.dead)return;zE('burst',f,g.x+rand(-70,70),g.y+rand(-70,70),{r:60,d:1.2,dmg:8,once:1,dl:.7,stun:.22,kb:110,vis:'pbfall'});});},
pbTower:(f,t)=>{pFX({ch:2,rot:.02,rt:1.2});const x=t.x,y=t.y;zE('ring',f,x,y,{r:135,d:2.8,dmg:3,iv:.45,slow:.9,pull:9,vis:'pbtower'});later(2.5,()=>zE('burst',f,x,y,{r:145,d:.7,dmg:14,once:1,stun:.5,kb:170,vis:'pbcrush'}));},
fwRime:(f,t,a)=>{zD(f,a+Math.PI,430,.45);for(let k=0;k<4;k++)later(.06+k*.1,()=>zE('ring',f,f.x,f.y,{r:42,d:3.2,dmg:1.6,iv:.4,slow:1,vis:'fwpatch'}));},
fwGlobe:f=>{f.shield=Math.min(14,f.shield+8);zE('ring',f,f.x,f.y,{r:115,d:2.4,dmg:2,iv:.4,slow:1.2,fol:1,vis:'fwglobe'});},
fwLance:(f,t,a)=>zE('line',f,f.x,f.y,{d:.55,r:10,dmg:9,iv:.1,w:16,root:.4,once:1,vis:'fwspear',...beam(f,a)}),
fwWinter:f=>{pFX({hue:15,ht:2,ch:2,inv:.15});zE('field',f,W/2,H/2,{r:330,d:3.4,arena:1,dmg:2.8,iv:.45,slow:.9,vis:'fwwinter'});for(let k=0;k<5;k++)later(.6+k*.4,()=>{const g=findTarget(f);if(!g||f.dead)return;zE('burst',f,g.x+rand(-30,30),g.y+rand(-30,30),{r:62,d:.8,dmg:8,once:1,dl:.45,kb:110,stun:.2,vis:'fwspike'});});},
zmLamp:(f,t)=>zE('field',f,(f.x+t.x)/2,(f.y+t.y)/2,{r:105,d:2.2,dmg:2.5,iv:.3,pull:14,vis:'zmlamp'}),
zmBlink:(f,t,a)=>{const ox=f.x,oy=f.y;zE('burst',f,ox,oy,{r:50,d:.7,dmg:0,vis:'zmdust'});f.invuln=.1;warp(f,t.x+Math.cos(a)*62,t.y+Math.sin(a)*62);zE('burst',f,f.x,f.y,{r:85,d:.9,gr:1,dmg:6,once:1,stun:.22,kb:100,dl:.05,vis:'zmdust'});},
zmArc:f=>{for(let k=0;k<3;k++)later(k*.16,()=>{const g=findTarget(f);if(!g||f.dead)return;zE('line',f,f.x,f.y,{d:.22,r:10,dmg:4,iv:.05,w:14,once:1,x2:g.x,y2:g.y,vis:'zmarc'});});},
zmStorm:f=>{pFX({solid:.1,ch:3.5,hue:50,ht:1});zE('orbit',f,f.x,f.y,{r:90,d:2.6,dmg:3.2,iv:.3,fol:1,kb:70,vis:'zmswarm'});for(let n=0;n<4;n++)later(.9+n*.45,()=>{const g=findTarget(f);if(!g||f.dead)return;zE('burst',f,g.x+rand(-30,30),g.y+rand(-30,30),{r:80,d:.7,dmg:9,once:1,dl:.3,stun:.3,kb:140,vis:'zmbolt'});});}
});

Object.assign(SOURCE_ZS,{
 repulsionWell:(f,t,a)=>{f.whCharge=(f.whCharge||0)+1;zE('whitewell',f,t.x,t.y,{r:148,d:1.55,dmg:5.6,iv:.34,kb:168,slow:.35});for(const p of projectiles){const dx=p.x-t.x,dy=p.y-t.y,d=Math.hypot(dx,dy)||1;if(d<190){p.vx+=dx/d*190;p.vy+=dy/d*190;p.rot=Math.atan2(p.vy,p.vx);}}floatText(t.x,t.y-36,'GENESIS WELL','#ffffff',12);},
 causalityReversal:(f,t,a)=>{const vx=t.vx,vy=t.vy;t.vx=-vx*1.22+Math.cos(a)*105;t.vy=-vy*1.22+Math.sin(a)*105;hurt(t,17.5,f,'skill');zE('whitecross',f,t.x,t.y,{r:118,d:1.08,dmg:5.2,iv:.22,kb:120,w:28});floatText(t.x,t.y-34,'CAUSE / EFFECT REVERSED','#ffffff',10);},
 whiteoutBlink:(f,t,a)=>{const old={x:f.x,y:f.y};const na=Math.atan2(t.y-f.y,t.x-f.x);zE('whiteblink',f,(old.x+t.x)*.5,(old.y+t.y)*.5,{r:125,d:.58,w:9});f.x=clamp(t.x+Math.cos(na+Math.PI)*Math.max(78,f.r*3.2),ARENA.x+f.r,ARENA.x+ARENA.w-f.r);f.y=clamp(t.y+Math.sin(na+Math.PI)*Math.max(78,f.r*3.2),ARENA.y+f.r,ARENA.y+ARENA.h-f.r);f.vx=-Math.cos(na)*220;f.vy=-Math.sin(na)*220;zE('whiteblink',f,old.x,old.y,{r:62,d:.55,w:12});zE('whiteblink',f,f.x,f.y,{r:94,d:.82,dmg:14.5,once:1,kb:160});floatText(f.x,f.y-30,'FOLDSPACE REJECTED','#ffffff',10);},
 bigBangReversal:(f,t,a)=>{f.whCharge=0;zE('whiteult',f,W/2,H/2,{r:Math.max(W,H)*.82,d:3.15,dmg:13.2,iv:.35,kb:248,arena:1,dl:.32});for(const foe of fighters){if(foe.dead||G(foe)===G(f))continue;foe.vx+=Math.cos(Math.atan2(foe.y-H/2,foe.x-W/2))*220;foe.vy+=Math.sin(Math.atan2(foe.y-H/2,foe.x-W/2))*220;foe.slow=Math.max(foe.slow,.62);}for(let i=0;i<24;i++){const an=i*Math.PI*2/24;zE('whitebeam',f,W/2,H/2,{r:Math.max(W,H)*.68,d:1.8,dmg:7.8,iv:.35,ang:an,w:30,dl:.38});}screenShake=Math.max(screenShake,19);screenZoom=Math.max(screenZoom,1.075);floatText(W/2,H*.24,'BIG BANG: FIRST LIGHT','#ffffff',19);}
});

SOURCE_ZS.endgarden=(f,target,ang)=>{
 const garden=createEffect('voidgarden',W/2,H/2,f,{r:480,duration:5,interval:5});garden.label='VOID GARDEN';
 const plants=[
  {u:.50,v:.50,variant:2,label:'GRAVEMAW',r:89,damage:4.2,interval:.72},
  {u:.245,v:.255,variant:0,label:'VOIDTHORN',r:74,damage:4.7,interval:.72},
  {u:.755,v:.255,variant:1,label:'MOONVEIL',r:76,damage:2.9,interval:.68},
  {u:.245,v:.745,variant:3,label:'MIRROR BLOOM',r:79,damage:2.5,interval:.72},
  {u:.755,v:.745,variant:4,label:'STARFALL LILY',r:78,damage:4.1,interval:.76},
  {u:.50,v:.205,variant:5,label:'LIFEBLOOM',r:66,damage:3.0,interval:.78},
  {u:.50,v:.795,variant:2,label:'GRAVEMAW',r:69,damage:3.3,interval:.78}
 ];
 for(const pl of plants){
  const e=createEffect('voidflower',ARENA.x+ARENA.w*pl.u,ARENA.y+ARENA.h*pl.v,f,{r:pl.r,duration:5,damage:pl.damage,interval:pl.interval});
  e.variant=pl.variant;e.label=pl.label;e.seed=plants.indexOf(pl)*1.7;e.tick=.12+pl.variant*.08;
 }
 // Blooming silhouettes grow out from the caster, while the arena garden itself handles the 5s transformation.
 for(let n=0;n<44;n++)particle(f.x+rand(-f.r,f.r),f.y+rand(-f.r,f.r),f,1,'ultimate');
 for(let n=0;n<24;n++)particle(W*.5+rand(-ARENA.w*.42,ARENA.w*.42),H*.5+rand(-ARENA.h*.42,ARENA.h*.42),f,1,'ambient');
 floatText(W/2,H/2-18,'VOID GARDEN: BLOOM OF THE END','#e8c5ff',16);
};

Object.assign(SOURCE_ZS,{
 claudeThink:(f,t,a)=>{
  t.slow=Math.max(t.slow,.34);
  zE('claudethink',f,t.x,t.y,{r:106,d:1.5,dl:1.0,once:1,iv:.05,dmg:20,slow:.4,ft:t.uid});
  later(1.0,()=>{if(f.dead||t.dead)return;const aa=Math.atan2(t.y-f.y,t.x-f.x);t.vx+=Math.cos(aa)*120;t.vy+=Math.sin(aa)*120;});
  floatText(t.x,t.y-t.r-30,'hmm…',CL_C.paper,11);
 },
 claudeAsk:(f,t,a)=>{
  const p=zP(f,t,10,262,{r:10,life:2.6,homing:.55,hit:(pp,tg,ow)=>{if(!tg||tg.dead)return;tg.stun=Math.max(tg.stun,.65);zE('claudeq',ow||f,tg.x,tg.y,{r:62,d:1.15,ft:tg.uid});floatText(tg.x,tg.y-tg.r-34,'wait… what?',CL_C.paper,10);}});
  if(p)p.s='claudeq';
 },
 claudeDecline:(f,t,a)=>{
  f.shield=Math.min(26,(f.shield||0)+17);
  zE('claudedecline',f,f.x,f.y,{r:88,d:1.9,fol:1,dmg:4.5,once:1,dl:.08,iv:.1,kb:150});
  floatText(f.x+16,f.y-f.r-34,'I’d prefer not to.',CL_C.paper,10);
  const R=106,bounce=()=>{
   if(f.dead)return;
   for(const p of projectiles){
    if(p.owner===f.uid||p.cl)continue;
    const so=fighters.find(q=>q.uid===p.owner);if(so&&G(so)===G(f))continue;
    if(Math.hypot(p.x-f.x,p.y-f.y)>R)continue;
    const back=so&&!so.dead?so:findTarget(f),sp=(Math.hypot(p.vx,p.vy)||260)*1.08,aa=Math.atan2((back?back.y:p.y)-p.y,(back?back.x:p.x)-p.x);
    p.vx=Math.cos(aa)*sp;p.vy=Math.sin(aa)*sp;p.rot=aa;p.owner=f.uid;p.team=f.team;p.target=back?back.uid:null;p.age=Math.min(p.age,(p.life||2)*.4);p.cl=1;p.homing=Math.max(p.homing||0,.35);
    zE('claudebounce',f,p.x,p.y,{r:30,d:.4,ang:aa});floatText(p.x,p.y-14,'NOT TODAY',CL_C.cream,9);
   }
  };
  for(let k=0;k<15;k++)later(k*.12,bounce);
 },
 claudeCoT:(f,t,a)=>{
  const tu=t.uid,nodes=[{x:f.x,y:f.y}],a0=Math.atan2(f.y-t.y,f.x-t.x);
  for(let i=1;i<=5;i++){const ang=a0+i*2.28+rand(-.2,.2),rad=Math.max(34,196-i*31+rand(-14,14));nodes.push({x:clamp(t.x+Math.cos(ang)*rad,ARENA.x+36,ARENA.x+ARENA.w-36),y:clamp(t.y+Math.sin(ang)*rad,ARENA.y+36,ARENA.y+ARENA.h-36)});}
  nodes.push({x:t.x,y:t.y});
  const T0=.4,DT=.34;f.shield=Math.min(26,(f.shield||0)+14);
  zE('claudecot',f,W/2,H/2,{r:300,d:3.7,arena:1,dmg:4.4,iv:.45,dl:.35,nodes,tu,T0,DT});
  nodes.forEach((n,i)=>later(T0+i*DT,()=>{if(f.dead)return;if(i<nodes.length-1)zE('claudenode',f,n.x,n.y,{r:60,d:.62,gr:1,dmg:4.8,once:1,dl:.04,iv:.05,kb:70});clPing(i);}));
  later(T0+nodes.length*DT+.28,()=>{
   if(f.dead)return;const tg=fighters.find(q=>q.uid===tu&&!q.dead)||findTarget(f);if(!tg)return;
   zE('claudeanswer',f,tg.x,tg.y,{r:158,d:.95,gr:1,dmg:30,once:1,dl:.1,iv:.05,kb:215});clAnswerSfx();
   screenShake=Math.max(screenShake,16);screenZoom=Math.max(screenZoom,1.06);flash=Math.max(flash,.22);floatText(tg.x,tg.y-52,'∴ ANSWER',CL_C.cream,16);
  });
 }
});

Object.assign(SOURCE_ZS,{
 chatgptPrompt:(f,t,a)=>{
  const p=zP(f,t,12.5,314,{r:8,life:2.25,homing:.36,hit:(pp,tg,ow)=>{
   if(!tg||tg.dead)return;
   tg.markTarget=Math.max(tg.markTarget||0,1.55);tg.slow=Math.max(tg.slow||0,.34);
   zE('chatgptquestion',ow||f,tg.x,tg.y,{r:44,d:.72,ft:tg.uid,dmg:1.7,iv:.29,slow:.18});
   floatText(tg.x,tg.y-tg.r-30,'PATTERN TAGGED',CG_PALETTE.mint,9);
  }});
  if(p)p.s='chatgpt';
  zE('chatgptquestion',f,f.x,f.y,{r:28,d:.3});
 },
 chatgptSwitch:(f,t,a)=>{
  const ox=f.x,oy=f.y;
  zE('chatgptfold',f,ox,oy,{r:42,d:.46});
  f.invuln=Math.max(f.invuln||0,.22);
  warp(f,t.x+Math.cos(a)*58,t.y+Math.sin(a)*58);
  f.vx=Math.cos(a)*222;f.vy=Math.sin(a)*222;f.dash=Math.max(f.dash||0,.22);
  zE('chatgptfold',f,f.x,f.y,{r:78,d:.68,gr:1,dmg:11.5,once:1,dl:.05,iv:.05,kb:112});
  floatText(f.x,f.y-f.r-28,'CONTEXT SWITCH',CG_PALETTE.cyan,9);
 },
 chatgptTokens:(f,t,a)=>{
  f.shield=Math.min(V10_SHIELD_CAP.chatgpt||26,(f.shield||0)+10);
  zE('chatgpttokens',f,f.x,f.y,{r:86,d:2.1,fol:1,dmg:4.0,iv:.39,kb:38});
  zE('chatgptresolve',f,f.x,f.y,{r:61,d:.55,fol:1});
  floatText(f.x,f.y-f.r-28,'TOKEN STREAM +10',CG_PALETTE.ice,9);
 },
 chatgptSynthesis:(f,t,a)=>{
  const targetUid=t.uid;
  f.shield=Math.min(V10_SHIELD_CAP.chatgpt||26,(f.shield||0)+12);
  zE('chatgptult',f,W/2,H/2,{r:450,d:3.45,arena:1,dmg:4.1,iv:.46,dl:.12,slow:.58,tu:targetUid});
  screenShake=Math.max(screenShake,17);screenZoom=Math.max(screenZoom,1.085);flash=Math.max(flash,.13);
  floatText(W/2,ARENA.y+42,'CONTEXT WEAVE: SYNTHESIS ACTIVE',CG_PALETTE.ice,12);
  // The final synthesis follows the original target for a fair, readable tell rather than a blind arena nuke.
  later(2.22,()=>{
   if(f.dead)return;const tg=fighters.find(q=>q.uid===targetUid&&!q.dead)||findTarget(f);if(!tg)return;
   zE('chatgptanswer',f,tg.x,tg.y,{r:186,d:1.03,gr:1,dmg:25,once:1,dl:.18,iv:.05,kb:225,ft:tg.uid});
   floatText(tg.x,tg.y-tg.r-38,'∴ ANSWER FOUND',CG_PALETTE.ice,13);cgChime(true);
   screenShake=Math.max(screenShake,12);screenZoom=Math.max(screenZoom,1.045);
  });
 }
});

Object.assign(SOURCE_ZS,{
 grokProbe:(f,t,a)=>{
  const p=zP(f,t,13,328,{r:9,life:2.4,homing:.42,hit:(pp,tg,ow)=>{
   if(!tg||tg.dead)return;
   tg.markTarget=Math.max(tg.markTarget||0,1.7);tg.slow=Math.max(tg.slow||0,.32);
   zE('grokquestion',ow||f,tg.x,tg.y,{r:48,d:.8,ft:tg.uid,dmg:2.0,iv:.3,slow:.2});
   floatText(tg.x,tg.y-tg.r-30,'?',GK_PAL.cyan,12);
  }});
  if(p)p.s='grok';
  zE('grokquestion',f,f.x,f.y,{r:26,d:.28});
 },
 grokRebound:(f,t,a)=>{
  f.shield=Math.min(28,(f.shield||0)+12);
  f.invuln=Math.max(f.invuln||0,.28);
  zE('grokrebound',f,f.x,f.y,{r:92,d:1.6,fol:1,dmg:5.5,once:1,dl:.06,iv:.1,kb:165});
  // Reflect nearby projectiles with a witty shove
  const R=110;
  for(const p of projectiles){
   if(p.owner===f.uid||p.gk)continue;
   const so=fighters.find(q=>q.uid===p.owner);if(so&&G(so)===G(f))continue;
   if(Math.hypot(p.x-f.x,p.y-f.y)>R)continue;
   const back=so&&!so.dead?so:findTarget(f),sp=(Math.hypot(p.vx,p.vy)||240)*1.15,aa=Math.atan2((back?back.y:p.y)-p.y,(back?back.x:p.x)-p.x);
   p.vx=Math.cos(aa)*sp;p.vy=Math.sin(aa)*sp;p.rot=aa;p.owner=f.uid;p.team=f.team;p.target=back?back.uid:null;p.age=Math.min(p.age,(p.life||2)*.35);p.gk=1;p.homing=Math.max(p.homing||0,.3);
   zE('grokbounce',f,p.x,p.y,{r:28,d:.35,ang:aa});floatText(p.x,p.y-12,'NICE TRY',GK_PAL.bone,9);
  }
  floatText(f.x,f.y-f.r-30,'SARCASM ACTIVE',GK_PAL.cyan,10);
 },
 grokRoast:(f,t,a)=>{
  const p=zP(f,t,11,290,{r:7,life:2.1,homing:.2,hit:(pp,tg,ow)=>{
   if(!tg||tg.dead)return;
   tg.stun=Math.max(tg.stun,.55);tg.markTarget=Math.max(tg.markTarget||0,2.0);
   zE('grokroast',ow||f,tg.x,tg.y,{r:70,d:1.0,ft:tg.uid});
   floatText(tg.x,tg.y-tg.r-34,'ROASTED',GK_PAL.ember,11);
  }});
  if(p)p.s='grok';
  zE('grokroast',f,f.x,f.y,{r:36,d:.4});
 },
 grokUniverse:(f,t,a)=>{
  const targetUid=t.uid;
  f.shield=Math.min(28,(f.shield||0)+14);
  zE('grokult',f,W/2,H/2,{r:460,d:3.6,arena:1,dmg:4.3,iv:.44,dl:.1,slow:.55,tu:targetUid});
  screenShake=Math.max(screenShake,18);screenZoom=Math.max(screenZoom,1.09);flash=Math.max(flash,.15);
  floatText(W/2,ARENA.y+40,'CURIOSITY LATTICE ONLINE',GK_PAL.bone,13);
  later(2.35,()=>{
   if(f.dead)return;const tg=fighters.find(q=>q.uid===targetUid&&!q.dead)||findTarget(f);if(!tg)return;
   zE('grokanswer',f,tg.x,tg.y,{r:195,d:1.1,gr:1,dmg:28,once:1,dl:.16,iv:.05,kb:240,ft:tg.uid});
   floatText(tg.x,tg.y-tg.r-40,'∴ UNDERSTOOD',GK_PAL.bone,14);gkChime(true);
   screenShake=Math.max(screenShake,14);screenZoom=Math.max(screenZoom,1.05);
  });
 }
});

Object.assign(SOURCE_ZS,{
 metaPrompt:(f,t,a)=>{
  const p=zP(f,t,13,322,{r:9,life:2.5,homing:0.48,hit:(pp,tg,ow)=>{
   if(!tg||tg.dead) return;
   tg.markTarget=Math.max(tg.markTarget||0,1.8); tg.slow=Math.max(tg.slow||0,0.36);
   zE('metafield',ow||f,tg.x,tg.y,{r:56,d:0.9,ft:tg.uid,dmg:2.2,iv:0.32,slow:0.24});
   floatText(tg.x,tg.y-tg.r-30,'?',MT_PAL.cyan,12);
  }});
  if(p) p.s='metaai';
  zE('metafield',f,f.x,f.y,{r:26,d:0.30});
 },
 metaOrbit:(f,t,a)=>{
  f.shield=Math.min(30,(f.shield||0)+14);
  f.invuln=Math.max(f.invuln||0,0.18);
  zE('metaorbit',f,f.x,f.y,{r:92,d:2.1,fol:1,dmg:4.8,once:1,dl:0.06,iv:0.12,kb:90});
  // reflect nearby projectiles — friendly help
  const R=112;
  for(const p of projectiles){
   if(p.owner===f.uid||p.mt) continue;
   const so=fighters.find(q=>q.uid===p.owner); if(so&&G(so)===G(f)) continue;
   if(Math.hypot(p.x-f.x,p.y-f.y)>R) continue;
   const back=so&&!so.dead?so:findTarget(f), sp=(Math.hypot(p.vx,p.vy)||270)*1.06, aa=Math.atan2((back?back.y:p.y)-p.y,(back?back.x:p.x)-p.x);
   p.vx=Math.cos(aa)*sp; p.vy=Math.sin(aa)*sp; p.rot=aa; p.owner=f.uid; p.team=f.team; p.target=back?back.uid:null; p.age=Math.min(p.age,(p.life||2)*0.45); p.mt=1; p.homing=Math.max(p.homing||0,0.38);
   zE('metabounce',f,p.x,p.y,{r:26,d:0.38,ang:aa}); floatText(p.x,p.y-14,'REMIX',MT_PAL.paper,9);
  }
  // spawn 3 tiny presence orbs that orbit and bump
  for(let k=0;k<3;k++){
   const ang=a+k*Math.PI*2/3;
   const orb=zP(f,t,6,220,{r:6,life:2.2,homing:0.12,hit:(pp,tg)=>{ if(tg&&!tg.dead) tg.vx+=Math.cos(ang)*60; }});
   if(orb){ orb.s='metaai'; orb.life=2.1; }
  }
 },
 metaRemix:(f,t,a)=>{
  f.shield=Math.min(30,(f.shield||0)+12);
  f.invuln=Math.max(f.invuln||0,0.34);
  zE('metaremix',f,f.x,f.y,{r:88,d:1.15,fol:1,dmg:3.8,once:1,dl:0.05,iv:0.11,kb:145});
  const R=128;
  for(const p of projectiles){
   if(p.owner===f.uid) continue;
   const so=fighters.find(q=>q.uid===p.owner); if(so&&G(so)===G(f)) continue;
   if(Math.hypot(p.x-f.x,p.y-f.y)>R) continue;
   const back=so&&!so.dead?so:t, sp=(Math.hypot(p.vx,p.vy)||300)*1.12, aa=Math.atan2((back?back.y:p.y)-p.y,(back?back.x:p.x)-p.x)+rand(-0.18,0.18);
   p.vx=Math.cos(aa)*sp; p.vy=Math.sin(aa)*sp; p.rot=aa; p.owner=f.uid; p.team=f.team; p.target=back?back.uid:null; p.age=0; p.mt=1;
   zE('metabounce',f,p.x,p.y,{r:28,d:0.42,ang:aa});
  }
  // scramble rival footing
  for(const foe of fighters){
   if(foe===f||foe.dead||G(foe)===G(f)) continue;
   if(Math.hypot(foe.x-f.x,foe.y-f.y)<110){ foe.slow=Math.max(foe.slow||0,0.55); foe.vx+=rand(-90,90); foe.vy+=rand(-90,90); }
  }
  floatText(t.x,t.y-t.r-28,'let me help with that',MT_PAL.paper,10);
 },
 metaCanvas:(f,t,a)=>{
  const tu=t.uid;
  const nodes=[{x:f.x,y:f.y}];
  // build an infinity-shaped lattice across arena
  for(let i=1;i<=6;i++){
   const u=i/6;
   // figure eight path around target
   const ang = u*Math.PI*2*1.8 - Math.PI*0.6 + rand(-0.18,0.18);
   const rad = 52 + i*22 + Math.sin(u*6.28)*18;
   // infinity offset: alternate lobes
   const lobe = i%2===0?1:-1;
   const x = clamp(t.x + Math.cos(ang)*rad*lobe, ARENA.x+36, ARENA.x+ARENA.w-36);
   const y = clamp(t.y + Math.sin(ang)*rad*0.62, ARENA.y+36, ARENA.y+ARENA.h-36);
   nodes.push({x,y});
  }
  nodes.push({x:t.x,y:t.y});
  const T0=0.48, DT=0.34;
  zE('metacanvas',f,W/2,H/2,{r:360,d:4.2,arena:1,dmg:4.4,iv:0.44,dl:0.42,nodes,tu,T0,DT});
  f.shield=Math.min(30,(f.shield||0)+16);
  nodes.forEach((n,i)=> later(T0+i*DT, ()=>{ if(f.dead) return; if(i<nodes.length-1) zE('metanode',f,n.x,n.y,{r:62,d:0.68,gr:1,dmg:5.2,once:1,dl:0.05,iv:0.06,kb:65}); mtChime(i); }));
  later(T0+nodes.length*DT+0.38, ()=>{
   if(f.dead) return; const tg=fighters.find(q=>q.uid===tu&&!q.dead)||findTarget(f); if(!tg) return;
   zE('metaburst',f,tg.x,tg.y,{r:172,d:1.12,gr:1,dmg:33,once:1,dl:0.12,iv:0.06,kb:230});
   mtAnswerSfx();
   screenShake=Math.max(screenShake,18); screenZoom=Math.max(screenZoom,1.09); flash=Math.max(flash,0.26);
   floatText(tg.x,tg.y-56,'∴ INFINITE CANVAS',MT_PAL.white,17);
   // gentle heal for allies in burst
   for(const ally of fighters){ if(!ally.dead&&G(ally)===G(f)&&Math.hypot(ally.x-tg.x,ally.y-tg.y)<190) heal(ally,6); }
  });
 }
});

Object.assign(SOURCE_ZS,{
 dolaQuery:(f,t,a)=>{
  const p=zP(f,t,10,340,{r:8,life:2.3,homing:.5,hit:(pp,tg,ow)=>{
   if(!tg||tg.dead)return;
   tg.markTarget=Math.max(tg.markTarget||0,1.9);tg.slow=Math.max(tg.slow||0,.36);
   zE('dolaquery',ow||f,tg.x,tg.y,{r:56,d:1.0,ft:tg.uid,dmg:2.4,iv:.32,slow:.24});
   floatText(tg.x,tg.y-tg.r-34,'searching…',DOLA_PAL.mint,10);
  }});
  if(p){p.s='dola';p.dolaKind='query';}
  zE('dolachat',f,f.x,f.y-f.r-22,{r:30,d:.7,text:'Query?'});
 },
 dolaSurge:(f,t,a)=>{
  f.shield=Math.min(30,(f.shield||0)+13);
  f.invuln=Math.max(f.invuln||0,.16);
  const tu=t.uid;
  zE('dolasurge',f,f.x,f.y,{r:96,d:2.4,fol:1,dmg:5.2,iv:.34,dl:.18,kb:70,tu});
  floatText(f.x,f.y-f.r-30,'TOOL DRONES DEPLOYED',DOLA_PAL.gold,10);
  for(let k=0;k<4;k++){
   later(.3+k*.45,()=>{
    if(f.dead)return;const tg=fighters.find(q=>q.uid===tu&&!q.dead)||findTarget(f);if(!tg)return;
    const dp=zP(f,tg,7,320,{r:6,life:1.9,homing:.45,hit:(pp,tg2,ow)=>{if(tg2&&!tg2.dead){hurt(tg2,7,ow||f,'skill');zE('dolahit',ow||f,tg2.x,tg2.y,{r:24,d:.35,tool:k});}}});
    if(dp){dp.s='dola';dp.dolaTool=k;}
   });
  }
 },
 dolaArtifact:(f,t,a)=>{
  f.shield=Math.min(30,(f.shield||0)+14);
  f.invuln=Math.max(f.invuln||0,.38);
  zE('dolaartifact',f,f.x,f.y,{r:96,d:1.6,fol:1,dmg:4.4,iv:.28,dl:.12,kb:150});
  const R=132;
  for(const p of projectiles){
   if(p.owner===f.uid||p.dolaRef)continue;
   const so=fighters.find(q=>q.uid===p.owner);if(so&&G(so)===G(f))continue;
   if(Math.hypot(p.x-f.x,p.y-f.y)>R)continue;
   const back=so&&!so.dead?so:t,sp=(Math.hypot(p.vx,p.vy)||300)*1.12,aa=Math.atan2((back?back.y:p.y)-p.y,(back?back.x:p.x)-p.x)+rand(-.15,.15);
   p.vx=Math.cos(aa)*sp;p.vy=Math.sin(aa)*sp;p.rot=aa;p.owner=f.uid;p.team=f.team;p.target=back?back.uid:null;p.age=0;p.dolaRef=1;
   zE('dolastamp',f,p.x,p.y,{r:22,d:.5,ang:aa});
  }
  for(const foe of fighters){
   if(foe===f||foe.dead||G(foe)===G(f))continue;
   if(Math.hypot(foe.x-f.x,foe.y-f.y)<118){foe.slow=Math.max(foe.slow||0,.52);foe.vx+=rand(-80,80);foe.vy+=rand(-80,80);}
  }
  floatText(f.x,f.y-f.r-30,'ARTIFACTS DEPLOYED',DOLA_PAL.lavender,10);
 },
 dolaFullStack:(f,t,a)=>{
  const tu=t.uid;
  const nodes=[{x:f.x,y:f.y}];
  for(let i=1;i<=6;i++){
   const u=i/6,ang=u*Math.PI*2*1.6-Math.PI*.5+rand(-.2,.2),rad=56+i*24+Math.sin(u*6.28)*16,lobe=i%2===0?1:-1;
   const x=clamp(t.x+Math.cos(ang)*rad*lobe,ARENA.x+36,ARENA.x+ARENA.w-36);
   const y=clamp(t.y+Math.sin(ang)*rad*.6,ARENA.y+36,ARENA.y+ARENA.h-36);
   nodes.push({x,y});
  }
  nodes.push({x:t.x,y:t.y});
  const T0=.46,DT=.34;
  zE('dolafullstack',f,W/2,H/2,{r:380,d:4.2,arena:1,dmg:4.4,iv:.44,dl:.42,nodes,tu,T0,DT});
  f.shield=Math.min(30,(f.shield||0)+16);
  nodes.forEach((n,i)=>later(T0+i*DT,()=>{
   if(f.dead)return;
   if(i<nodes.length-1)zE('dolanode',f,n.x,n.y,{r:60,d:.7,gr:1,dmg:5.4,once:1,dl:.06,iv:.06,kb:60,kind:i%4});
   dolaChime(i%2===0);
  }));
  later(T0+nodes.length*DT+.42,()=>{
   if(f.dead)return;const tg=fighters.find(q=>q.uid===tu&&!q.dead)||findTarget(f);if(!tg)return;
   zE('dolaburst',f,tg.x,tg.y,{r:185,d:1.25,gr:1,dmg:34,once:1,dl:.14,iv:.06,kb:240});
   dolaChime(true);
   screenShake=Math.max(screenShake,18);screenZoom=Math.max(screenZoom,1.09);flash=Math.max(flash,.28);
   for(const ally of fighters){if(!ally.dead&&G(ally)===G(f)&&Math.hypot(ally.x-tg.x,ally.y-tg.y)<190)heal(ally,7);}
  });
 }
});

Object.assign(SOURCE_ZS,{
 pxSeek:(f,t)=>{
 const num=++f.pxSerial;
 const p=zP(f,t,12,365,{r:7,life:2.1,homing:.35});
 if(p){p.s='perplexity';p.pxNum=num;}
 zE('pxcite',f,f.x,f.y,{r:28,d:.4,num:((num-1)%3)+1});
 },
 pxTriangle:(f,t,a)=>{
 const c=pxPredict(t,.65),nodes=pxNodes(c,100,a+Math.PI/6);
 zE('pxmap',f,c.x,c.y,{r:100,d:1.3,nodes,lock:.72});
 later(.72,()=>{if(f.dead)return;for(let i=0;i<3;i++)pxLine(f,nodes[i],nodes[(i+1)%3],13,false,13);});
 },
 pxReview:(f,t)=>{
 f.shield=Math.min(26,(f.shield||0)+15);f.pxReview=1.15;
 zE('pxreview',f,f.x,f.y,{r:85,d:1.15,fol:1});
 floatText(f.x,f.y-f.r-42,'PEER REVIEW',PX.ice,9);
 },
 pxAnswer:(f,t,a)=>{
 const c=pxPredict(t,.8),nodes=pxNodes(c,155,a-Math.PI/2);
 f.pxUlt=2.55;f.pxThesis=null;
 zE('pxengine',f,c.x,c.y,{r:155,d:2.65,nodes,lock:1.35});
 nodes.forEach((n,i)=>later(.22+i*.25,()=>{if(!f.dead){zE('pxcite',f,n.x,n.y,{r:34,d:1.3,num:i+1});pxSound(i,false);}}));
 later(1.35,()=>{if(f.dead)return;for(const n of nodes)pxLine(f,n,c,17,true,18);pxSound(3,true);});
 later(1.65,()=>{if(f.dead)return;pxBurst(f,c,36,true,94);screenShake=Math.max(screenShake,10);screenZoom=Math.max(screenZoom,1.055);
 floatText(c.x,c.y-107,'ANSWER // VERIFIED',PX.ice,13);});
 }
});

Object.assign(SOURCE_ZS,{
 llStep:(f,t,a)=>{const aa=Math.round(a/.7854)*.7854;llTile(f,f.x,f.y);f.dash=.2;f.vx=Math.cos(aa)*430;f.vy=Math.sin(aa)*430;later(.22,()=>{if(f.dead)return;llTile(f,f.x,f.y);llBurst(f,llSnap(f),12,0,.3,llSX()*.6,false,{sq:1,piece:'king'});});},
 llCastle:(f,t)=>{const C=f.llC||f,p2={x:2*C.x-f.x,y:2*C.y-f.y};
  for(const p of [{x:f.x,y:f.y},p2]){const e=zE('llring',f,p.x,p.y,{r:72,d:.85,dmg:14,once:1,iv:.05,kb:95,q:0,piece:'rook'});e.v10Skill=true;}
  if(!f.llSwapDone){f.llSwapDone=true;f.llAng+=Math.PI;f.llSw=.5;f.shield=Math.min(30,(f.shield||0)+14);floatText(f.x,f.y-f.r-40,'CASTLING',LL.K,10);}},
 llFork:(f,t)=>{const s=llSnap(llPred(t,.6));llBurst(f,s,26,0,.95,llSX()*.6,false,{sq:1,piece:'knight',ox:f.x,oy:f.y,sky:1,kb:150});
  for(const k of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]){const i=s.i+k[0],j=s.j+k[1];if(i<0||j<0||i>7||j>7)continue;llBurst(f,llSqAt(i,j),12,0,1.5,llSX()*.55,false,{sq:1,kb:80});}},
 llCheck:(f,t)=>{const c=llSnap(llPred(t,.7));
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)if((i+j)%2===0){const ii=c.i+i,jj=c.j+j;if(ii<0||jj<0||ii>7||jj>7)continue;llBurst(f,llSqAt(ii,jj),20,0,1.05,llSX()*.6,true,{sq:1,sky:1});}
  llBurst(f,c,22,0,2.0,llSX()*.9,true,{sq:1,sky:1,piece:'king',kb:200,big:1});},
 llRook:(f,t)=>{const c=llSnap(llPred(t,.5)),hz=Math.abs(t.x-f.x)>Math.abs(t.y-f.y);
  llBeam(f,hz?{x:ARENA.x,y:c.y}:{x:c.x,y:ARENA.y},hz?{x:ARENA.x+ARENA.w,y:c.y}:{x:c.x,y:ARENA.y+ARENA.h},13,1,.6,18,false,{piece:'rook'});},
 llBishop:(f,t)=>{const c=llSnap(llPred(t,.55));for(const d of [[1,1],[1,-1]]){const [a,b]=llDiag(c,d[0],d[1]);llBeam(f,a,b,12,1,.65,16,false,{piece:'bishop'});}},
 llPawns:(f,t,a)=>{const px=-Math.sin(a),py=Math.cos(a),sp=230;for(let k=-2;k<=2;k++){const p=zP(f,t,7,sp,{r:9,life:2.8,homing:0});if(!p)continue;const aa=a-k*.09;p.x+=px*k*llSX()*.75;p.y+=py*k*llSY()*.75;p.vx=Math.cos(aa)*sp;p.vy=Math.sin(aa)*sp;p.s='lovers';p.piece='pawn';p.lq=1;}},
 llGambit:(f,t)=>{const c=llSnap(llPred(t,.8));for(let i=0;i<8;i++){const a=i*Math.PI/4;llBeam(f,c,{x:c.x+Math.cos(a)*235,y:c.y+Math.sin(a)*235},15,1,i%2?1.35:1.0,16,true,{piece:i%2?null:'queen'});}
  llBurst(f,c,22,1,1.9,llSX()*.9,true,{sq:1,sky:1,piece:'queen',kb:200,big:1});
  later(1.7,()=>{if(!f.dead){heal(f,16);floatText(f.x,f.y-f.r-44,'THE KING MENDS THE CROWN',LL.K,9);}});}
});

Object.assign(SOURCE_ZS,{
 foSalon:(f,t,a)=>{
  const m=foM(f),p=foPred(t,.55),ux=f.x+Math.cos(a+.9)*40,uy=f.y+Math.sin(a+.9)*40,cx=f.x+Math.cos(a-.9)*40,cy=f.y+Math.sin(a-.9)*40;
  // 1 · Gentilhomme Usher: a rapier line along the rival's predicted bearing
  zE('fosalon',f,ux,uy,{r:20,d:1.05,who:0,ang:undefined,face:Math.atan2(p.y-uy,p.x-ux)});
  const ba=Math.atan2(p.y-uy,p.x-ux);foLine(f,{x:ux,y:uy},{x:ux+Math.cos(ba)*430,y:uy+Math.sin(ba)*430},8*m,.3,11,false,{kb:75});
  // 2 · Surintendante Chevalmarin: a pearl cannonball
  later(.28,()=>{if(f.dead)return;zE('fosalon',f,cx,cy,{r:20,d:.95,who:1,face:Math.atan2(t.y-cy,t.x-cx)});
   later(.22,()=>{if(f.dead||t.dead)return;const sx=f.x,sy=f.y;f.x=cx;f.y=cy;const pr=zP(f,t,9.5*m,335,{r:7.5,life:2.3,homing:.3});f.x=sx;f.y=sy;if(pr){pr.s='focalors';pr.fk='pearl';}});});
  // 3 · Mademoiselle Crabaletta: a bubble snap at the predicted spot
  later(.62,()=>{if(f.dead)return;const q=foPred(t,.5);zE('fosalon',f,q.x,q.y-34,{r:20,d:1.0,who:2,face:0});foBurst(f,q,9.5*m,62,.5,false,{kb:150,bub:1});});
  if(!f.foForm)f.shield=Math.min(24,(f.shield||0)+2);
 },
 foChoir:(f,t,a)=>{
  const m=foM(f),n=f.foForm?7:5,dm=(f.foForm?4.2:5.6)*m;
  zE('fochoir',f,f.x,f.y,{r:70,d:.85,fol:1,n:n});
  fan(f,t,n,f.foForm?285:250,dm,f.foForm?.2:.3,{r:f.foForm?6:8,homing:.3,life:2.6});
  for(let i=1;i<=n;i++){const p=projectiles[projectiles.length-i];if(p){p.s='focalors';p.fk='fish';p.fs=rand(0,6.28);}}
  if(f.foForm)f.shield=Math.min(24,(f.shield||0)+4);
 },
 foScale:(f,t,a)=>{
  const m=foM(f),c=foPred(t,.75);
  const e=zE('foscale',f,c.x,c.y,{r:84,d:1.8,dl:1.05,dmg:19*m,once:1,iv:.05,kb:100,root:.4,lock:1.05});e.v10Skill=true;
  later(1.08,()=>{if(f.dead)return;for(const q of foFoes(f)){if(Math.hypot(q.x-c.x,q.y-c.y)<84+q.r){f.foCond={uid:q.uid,exp:gameTime+5};floatText(q.x,q.y-q.r-26,'CONDEMNED',FO.gold,10);v13_3GainUlt(f,8,'verdict');}}screenShake=Math.max(screenShake,7);});
 },
 foFinale:(f,t,a)=>{
  if(foStage())return;
  const foes=foFoes(f);
  f.foUlt=8.4;f.foHead=9;f.foTear=6.5;f.vx=f.vy=0;f.invuln=Math.max(f.invuln,.4);f.shield=Math.min(24,(f.shield||0)+8);
  const st=zE('fostage',f,W/2,H/2,{r:10,d:8.7});st.o.cost=0;
  // ACT I · ARRAIGNMENT: the stage appears and every rival is marked a sinner
  for(const q of foes)zE('fomark',f,q.x,q.y,{r:36,d:4.4,ft:q.uid});
  later(.9,()=>foAct(f,'I','ARRAIGNMENT','Every soul in Fontaine was born with a sin.'));
  // ACT II · THE PRIMORDIAL SEA: the tide rises and dissolves
  later(1.4,()=>{foAct(f,'II','THE PRIMORDIAL SEA','The prophecy comes due. The waters rise.');foSound(2,0,true);});
  const sea=zE('fosea',f,W/2,H/2,{r:10,d:4.5,arena:1,dmg:6,iv:.5,dl:1.5,slow:1.1});sea.v10Skill=true;sea.v10Ult=true;
  // ACT III · VERDICT: the Oratrice locks on, then passes sentence
  later(4.4,()=>{if(f.dead)return;foAct(f,'III','VERDICT','The Oratrice has weighed your sin.');
   for(const q of foFoes(f)){const c=foPred(q,.95);const e=zE('foverdict',f,c.x,c.y,{r:74,d:1.95,dl:1.05,dmg:34,once:1,iv:.05,kb:180,stun:.35,lock:.7});e.v10Skill=true;e.v10Ult=true;}});
  later(5.45,()=>{if(f.dead)return;for(const q of foFoes(f)){const c=foPred(q,.6);const e=zE('foverdict',f,c.x,c.y,{r:52,d:1.2,dl:.55,dmg:12,once:1,iv:.05,kb:110,lock:.4,small:1});e.v10Skill=true;e.v10Ult=true;}});
  // ACT IV · THE LAST EXECUTION: she sentences herself; the throne shatters; Absolution
  later(6.0,()=>{if(f.dead)return;foAct(f,'IV','THE LAST EXECUTION','The Archon passes sentence on herself.');
   const cost=Math.max(0,Math.min(f.hp-1,f.maxHp*.11));f.hp-=cost;st.o.cost=cost;
   floatText(f.x,f.y-f.r-46,'−'+Math.round(cost)+' · SELF-EXECUTION',FO.gold,12);zE('foexec',f,f.x,f.y,{r:30,d:1.1,fol:1});foSound(3,0,true);screenShake=Math.max(screenShake,10);});
  later(6.9,()=>{if(f.dead)return;const D=40+st.o.cost*.6;
   const e=zE('foabsolve',f,f.x,f.y,{r:430,d:2.2,arena:1,dmg:D,once:1,iv:.05,dl:.12,stun:.5,kb:250});e.v10Skill=true;e.v10Ult=true;
   flash=Math.max(flash,.95);screenShake=Math.max(screenShake,28);screenZoom=Math.max(screenZoom,1.13);floatText(f.x,f.y-f.r-52,'ABSOLUTION',FO.ice,17);foSound(4,0,true);});
  // Curtain call: the audience cheers. Faith becomes power (Fanfare).
  later(7.6,()=>{if(f.dead)return;f.foFan=7;f.shield=Math.min(24,(f.shield||0)+10);for(let i=0;i<3;i++)f.cooldowns[i]*=.55;
   floatText(f.x,f.y-f.r-46,'CURTAIN CALL · LET THE PEOPLE REJOICE',FO.gold,11);foApplause();});
 }
});

SOURCE_ZS.foSalon=(f,t,a)=>{const m=foM(f);zE('fosplash',f,f.x,f.y,{r:80,d:.7});screenShake=Math.max(screenShake,5);
 for(let i=-1;i<=1;i++){const b=a+i*.2,s={x:f.x+Math.cos(b)*30,y:f.y+Math.sin(b)*30};{const e2={x:s.x+Math.cos(b)*440,y:s.y+Math.sin(b)*440};foLine(f,s,e2,9*m,.28+Math.abs(i)*.1,16,false,{kb:90,slow:.6});later(.3+Math.abs(i)*.1,()=>zE('fosplash',f,s.x+Math.cos(b)*140,s.y+Math.sin(b)*140,{r:60,d:.6}));}}
 later(.55,()=>{if(f.dead||t.dead)return;const q=foPred(t,.35);foBurst(f,q,13*m,85,.45,false,{kb:170,bub:1,slow:.8});zE('fosplash',f,q.x,q.y,{r:120,d:.9});later(.45,()=>{screenShake=Math.max(screenShake,8);});});
 if(!f.foForm)f.shield=Math.min(24,(f.shield||0)+2);};

SOURCE_ZS.foFinale=(f,t,a)=>{
 if(foStage())return;const foes=foFoes(f);
 f.foUlt=22.6;f.foHead=30;f.foTear=0;f.vx=f.vy=0;f.invuln=Math.max(f.invuln,.4);f.shield=Math.min(24,(f.shield||0)+10);
 const st=zE('fostage',f,W/2,H/2,{r:10,d:27});st.o.cost=0;foAudioPlay();
 for(const q of foes)zE('fomark',f,q.x,q.y,{r:36,d:6,ft:q.uid});
 later(2.6,()=>foAct(f,'I','THE LAST PERFORMANCE','Every soul in Fontaine was born with a sin.'));
 later(7.4,()=>{foAct(f,'II','THE PRIMORDIAL SEA','The prophecy comes due. The waters rise.');});
 later(7.6,()=>{if(f.dead)return;const sea=zE('fosea',f,W/2,H/2,{r:10,d:5.6,arena:1,dmg:3,iv:.6,dl:.2,slow:1.1});sea.v10Skill=true;sea.v10Ult=true;});
 later(12.0,()=>{if(f.dead)return;foAct(f,'III','THE ORATRICE’S VERDICT','The machine of justice weighs every sin.');
  for(const q of foFoes(f)){const c=foPred(q,.95);const e=zE('foverdict',f,c.x,c.y,{r:74,d:1.95,dl:1.05,dmg:34,once:1,iv:.05,kb:180,stun:.35,lock:.7});e.v10Skill=true;e.v10Ult=true;}});
 for(const T of[15.2,17.4])later(T,()=>{if(f.dead)return;for(const q of foFoes(f)){const c=foPred(q,.6);const e=zE('foverdict',f,c.x,c.y,{r:52,d:1.2,dl:.55,dmg:12,once:1,iv:.05,kb:110,lock:.4,small:1});e.v10Skill=true;e.v10Ult=true;}});
 const BL=[];later(14.4,()=>{if(f.dead)return;for(const q of foFoes(f))BL.push(zE('foblade',f,q.x,q.y,{r:60,d:6.2,ft:q.uid,dl:5.2}));});
 later(18.4,()=>{if(f.dead)return;foAct(f,'IV','THE FINAL VERDICT','The Oratrice sentences the sinners.');});
 later(19.6,()=>{if(f.dead)return;for(const e of BL){const x=e.o.lx!==undefined?e.o.lx:e.x,y=e.o.ly!==undefined?e.o.ly:e.y;foBurst(f,{x,y},62,125,.05,true,{stun:.5,kb:220});floatText(x,y-40,'SENTENCED',FO.gold,13);}screenShake=Math.max(screenShake,20);for(const e of BL)zE('fosplash',f,e.o.lx!==undefined?e.o.lx:e.x,e.o.ly!==undefined?e.o.ly:e.y,{r:170,d:1,col:1,big:1});});
 later(20.0,()=>{if(f.dead)return;const e=zE('foabsolve',f,f.x,f.y,{r:430,d:2.4,arena:1,dmg:44,once:1,iv:.05,dl:.12,stun:.5,kb:250});e.v10Skill=true;e.v10Ult=true;
  flash=Math.max(flash,1);screenShake=Math.max(screenShake,30);screenZoom=Math.max(screenZoom,1.14);floatText(f.x,f.y-f.r-52,'ABSOLUTION',FO.ice,17);zE('fosplash',f,f.x,f.y,{r:420,d:1.6,big:1});zE('fosplash',f,f.x,f.y,{r:260,d:1.2,col:1});});
 later(22.6,()=>{if(f.dead)return;foAct(f,'V','FONTAINE ENDURES','The waters rose. Her people lived.');});
 later(24.4,()=>{if(f.dead)return;f.foFan=7;f.shield=Math.min(24,(f.shield||0)+10);for(let i=0;i<3;i++)f.cooldowns[i]*=.55;floatText(f.x,f.y-f.r-46,'THE PEOPLE LIVE',FO.gold,12);foApplause();});
};

SOURCE_ZS.foChoir=(f,t,a)=>{FO_B_CHOIR(f,t,a);const m=foM(f);zE('fosplash',f,f.x,f.y,{r:110,d:.9});screenShake=Math.max(screenShake,5);
 fan(f,t,4,320,3.4*m,.55,{r:6,homing:.35,life:2.6});for(let i=1;i<=4;i++){const q=projectiles[projectiles.length-i];if(q){q.s='focalors';q.fk='fish';q.fs=rand(0,6.28);}}
 later(.5,()=>{if(!f.dead)zE('fosplash',f,f.x,f.y,{r:150,d:.8,col:1});});};

SOURCE_ZS.foScale=(f,t,a)=>{const c=foPred(t,.75);FO_B_SCALE(f,t,a);
 later(1.08,()=>{if(f.dead)return;zE('fosplash',f,c.x,c.y,{r:170,d:1.1,col:1,big:1});zE('fosplash',f,c.x,c.y,{r:100,d:.8});screenShake=Math.max(screenShake,14);flash=Math.max(flash,.18);});};

Object.assign(SOURCE_ZS,{
 eiCard:(f,t)=>{const ace=Math.floor(Math.random()*5);eiB(f,f,0,60,0,{});fan(f,t,5,260,.1,.3,{r:8,life:2.6,homing:0});const ps=[];for(let i=1;i<=5;i++){const p=projectiles[projectiles.length-i];if(p){p.s='eidolon';p.fk=10;p.cs=0;ps.push(p);}}ps.reverse();
  later(.55,()=>{ps.forEach((p,i)=>{if(p.age>=p.life)return;if(i===ace){p.cs=1;p.damage=11;p.homing=.5;const v=Math.hypot(p.vx,p.vy)*1.4,a=Math.atan2(t.y-p.y,t.x-p.x);p.vx=Math.cos(a)*v;p.vy=Math.sin(a)*v;p.life+=.8;floatText(p.x,p.y-20,'REAL',EI.gd,11);}
   else{const q={x:p.x,y:p.y};p.age=p.life+.01;eiB(f,q,0,42,0,{});later(.9,()=>{if(!f.dead)eiB(f,q,5,50,.7,{});});}});});},
 eiCups:(f,t)=>{const c=foPred(t,.6),k=Math.floor(Math.random()*3),sl=[0,1,2].map(i=>eiIn(c.x+Math.cos(i*2.094-1.57)*88,c.y+Math.sin(i*2.094-1.57)*88,40)),sw=[],occ=[0,1,2];
  for(let j=0;j<5;j++){const a=Math.floor(Math.random()*3),b=(a+1+Math.floor(Math.random()*2))%3;sw.push([.5+j*.26,a,b]);[occ[a],occ[b]]=[occ[b],occ[a]];}
  const fin=occ.indexOf(k);zE('eicups',f,c.x,c.y,{r:120,d:3.4,sl,sw,k,fin,lift:2.2});
  later(2.2,()=>{if(f.dead)return;for(let s=0;s<3;s++){if(s===fin)eiB(f,sl[s],20,74,.12,{kb:170});else eiB(f,sl[s],0,36,0,{});}screenShake=Math.max(screenShake,6);});},
 eiVanish:(f,t)=>{f.eiVan=1.25;f.invuln=Math.max(f.invuln,1.35);eiB(f,f,0,90,0,{big:1});zE('eismoke',f,f.x,f.y,{r:80,d:1.2});
  for(let i=0;i<3;i++){const a=rand(0,6.28)+i*2.09;eiIl(f,f.x,f.y,{k:'clone',life:1.6,vx:Math.cos(a)*190,vy:Math.sin(a)*190,tc:.2});}
  later(1.15,()=>{if(f.dead||t.dead)return;const ta=Math.atan2(t.vy,t.vx),b=eiIn(t.x-Math.cos(ta)*80,t.y-Math.sin(ta)*80,40);f.x=b.x;f.y=b.y;f.vx=f.vy=0;zE('eismoke',f,b.x,b.y,{r:70,d:.9});eiB(f,b,14,78,.25,{kb:190});floatText(b.x,b.y-50,'TA-DA!',EI.gd,13);flash=Math.max(flash,.35);f.eiShT=3;});},
 eiWorld:(f,t)=>{if(eiU(f))return;const st=zE('eiult',f,W/2,H/2,{r:10,d:12.6});f.eiUlt=10.8;f.vx=f.vy=0;f.invuln=Math.max(f.invuln,.5);eiSound(3);
  later(1.9,()=>{if(f.dead)return;flash=Math.max(flash,.8);f.invuln=Math.max(f.invuln,2.7);eiSwarm(f);eiSound(0);st.o.card=['I','THE FALSE WORLD','Some copies never connect. Some wear your face.',st.age];});
  for(let k=0;k<14;k++)later(4.6+k*.22,()=>{if(f.dead)return;if(k===0){st.o.card=['II','CONTRADICTION','Real attacks cast their shadows the wrong way.',st.age];screenShake=Math.max(screenShake,8);}
   const sc=1+f.eiCv*.05;for(const q of eiFoes(f)){const src=choice(f.eiIl)||f,c=foPred(q,.4);
    if(k%3===2)eiB(f,c,5.5*sc,58,.6,{ult:1,hand:1,kb:100});
    else{eiL(f,src,ext(src,c,600),(k%2?3.8:4.4)*sc,.4,11,{ult:1});if(k%2){const m={x:(src.x+c.x)/2,y:(src.y+c.y)/2},ba=Math.atan2(c.y-src.y,c.x-src.x);for(const s of[-.45,.45])eiL(f,m,{x:m.x+Math.cos(ba+s)*340,y:m.y+Math.sin(ba+s)*340},2.4*sc,.4,8,{ult:1});}}
    const fs=choice(f.eiIl)||f,fc=foPred(q,.4+Math.random()*.4);eiL(f,fs,ext(fs,{x:fc.x+rand(-120,120),y:fc.y+rand(-120,120)},600),0,.4,11);}});
  later(7.6,()=>{if(f.dead)return;st.o.card=['III','THE ONLY TRUTH','Every illusion turns toward the real one.',st.age];st.o.p3=1;f.eiLit=gameTime;for(const q of eiFoes(f))q.rooted=Math.max(q.rooted,1.5);for(const i of f.eiIl)i.frz=1;});
  later(9.1,()=>{if(f.dead)return;const sc=1+f.eiCv*.06;for(const q of eiFoes(f)){eiB(f,q,32*sc,125,.05,{ult:1,stun:.6,kb:220,big:1});const n=[14,10,7,5][Q];for(let i=0;i<n;i++){const s=f.eiIl[i%f.eiIl.length]||f;eiL(f,s,{x:q.x,y:q.y},2.2*sc,.06+i*.035,16,{ult:1});}}
   f.eiCv=0;st.o.shat=st.age;flash=1;screenShake=Math.max(screenShake,28);screenZoom=Math.max(screenZoom,1.13);eiSound(2);});
  later(10.2,()=>{if(f.dead)return;flash=Math.max(flash,.9);st.o.line=st.age;f.eiIl.length=0;});
  later(11.2,()=>{if(f.dead)return;const q=choice(eiFoes(f));if(!q)return;eiIl(f,f.x+rand(-60,60),f.y+rand(-60,60),{k:'decoy',life:3,tc:9});later(2.4,()=>{if(f.dead)return;eiB(f,foPred(q,.4),15,70,.8,{kb:170});});});}
});

Object.assign(SOURCE_ZS,{
 nlPins:(f,t)=>{nlSound(0);zE('nlcast',f,f.x,f.y,{r:48,d:.5});fan(f,t,3,305,5.4,.2,{r:6,life:2.1,homing:.14,hit:nlHit});for(let i=1;i<=3;i++){const p=projectiles[projectiles.length-i];if(p){p.s='nullity';p.fk=1;}}},
 nlPaste:(f,t)=>{const c0=nlIn(f.x,f.y,56),p0=foPred(t,.5),tp=nlIn(p0.x,p0.y,56);
  const e=zE('nlpaste',f,tp.x,tp.y,{r:60,d:3.1,cx:c0.x,cy:c0.y,sz:104});nlSound(2);
  for(let i=1;i<=9;i++)later(i*.1,()=>{if(f.dead||t.dead)return;const p=foPred(t,.5),q=nlIn(p.x,p.y,56);e.x=q.x;e.y=q.y;});
  later(1.45,()=>{if(f.dead)return;nlSound(1);screenShake=Math.max(screenShake,13);flash=Math.max(flash,.25);
   for(const q of nlFoes(f)){if(Math.abs(q.x-e.x)<52+q.r*.6&&Math.abs(q.y-e.y)<52+q.r*.6){hurt(q,15,f,'skill');q.rooted=Math.max(q.rooted,.55);const a=Math.atan2(q.y-e.y,q.x-e.x);q.vx+=Math.cos(a)*170;q.vy+=Math.sin(a)*170;nlErase(f,q,2);}}});},
 nlRedact:(f,t)=>{nlSound(2);zE('nlredact',f,t.x,t.y,{r:60,d:1.15,dl:.4,ft:t.uid});
  later(.4,()=>{if(f.dead||t.dead)return;nlSound(1);hurt(t,8,f,'skill');t.nlRed=Math.max(t.nlRed||0,1.1);t.nlRedT0=gameTime;t.nlUlt2=0;nlErase(f,t,2);screenShake=Math.max(screenShake,9);floatText(t.x,t.y-t.r-38,'[REDACTED]',NL.bone,12);});
  later(1.5,()=>{if(f.dead||t.dead)return;t.nlRed=0;t.nlCor=5.2;t.nlCorSrc=f.uid;nl2Sound(0);zE('nlcor',f,t.x,t.y,{r:t.r*3,d:.8});screenShake=Math.max(screenShake,8);flash=Math.max(flash,.15);floatText(t.x,t.y-t.r-40,'CORRUPTED',NL.bone,13);});},
 nlEOF:(f,t)=>{if(nlU(f))return;const foes=nlFoes(f),td=Array(49).fill(1e9),N=40;
  const sorted=[...Array(49).keys()].map(i=>{const r=nlCR(i),cx=r.x+r.s/2,cy=r.y+r.s/2;let m=1e9;for(const q of foes)m=Math.min(m,Math.hypot(q.x-cx,q.y-cy));return[m+Math.random()*190,i];}).sort((a,b)=>a[0]-b[0]).map(v=>v[1]);
  sorted.slice(0,N).forEach((ci,k)=>{td[ci]=1.7+3.5*Math.pow(k/(N-1),.75);});td[nlCell(f.x,f.y)]=1e9;   // Null stands on the last island
  const st=zE('nlult',f,W/2,H/2,{r:10,d:12.8,td,tt:0});f.nlUlt=12.6;f.vx=f.vy=0;f.invuln=Math.max(f.invuln,.6);nlSound(5);
  const card=(a,b,s,tm)=>later(tm,()=>{if(f.dead)return;st.o.card=[a,b,s,st.age];});
  card('ACT I','DELETE','Anything standing on nothing falls. The floor will not return.',1.7);card('ACT II','CORRUPT','Everything you throw comes back at you.',5.45);card('ACT III','END OF FILE','Everything below this line is nothing.',8.85);
  sorted.slice(0,N).forEach((ci,k)=>{later(td[ci]-.02,()=>{if(f.dead)return;nlSound(6);if(k%5===4)nlSound(1);});});
  later(1.2,()=>{if(!f.dead)nlSound(7);});
  later(5.4,()=>{if(f.dead)return;flash=Math.max(flash,.55);screenShake=Math.max(screenShake,12);nlSound(1);});
  for(const tm of[5.5,6.8,8.1])later(tm,()=>{if(f.dead)return;const q=choice(nlFoes(f));if(!q)return;const a=Math.random()*6.283,p=nlIn(q.x+Math.cos(a)*240,q.y+Math.sin(a)*240,40);nlB(f,f.x,f.y,f.r*3.4);f.x=p.x;f.y=p.y;nlB(f,p.x,p.y,f.r*3.4);nlSound(1);});
  for(let k=0;k<11;k++)later(5.75+k*.27,()=>{if(f.dead)return;for(const q of nlFoes(f)){const pr=foPred(q,.5),dirs=k%3===2?[0,1.5708]:[Math.random()*3.1416];for(const ang of dirs){const ux=Math.cos(ang),uy=Math.sin(ang);nlTear(f,{x:pr.x-ux*620,y:pr.y-uy*620},{x:pr.x+ux*620,y:pr.y+uy*620},5,.5,15);}}nlSound(4);});
  later(8.8,()=>{if(f.dead)return;for(const q of nlFoes(f))q.nlUlt2=0;nlSound(7);});
  for(let i=0;i<12;i++)later(10.85+i*.045,()=>{if(!f.dead)nlSound(6);});
  later(11.7,()=>{if(f.dead)return;nlVoidOn(f);nlSound(3);flash=1;screenShake=Math.max(screenShake,30);screenZoom=Math.max(screenZoom,1.13);
   for(const q of nlFoes(f)){const n=q.nlEr|0;q.nlEr=0;hurt(q,30+8*n,f,'ultimate');q.stun=Math.max(q.stun,.8);const a=Math.atan2(q.y-f.y,q.x-f.x);q.vx+=Math.cos(a)*260;q.vy+=Math.sin(a)*260;q.nlDelAt=0;nlB(f,q.x,q.y,q.r*3,{d:.9});if(q.cooldowns)for(let i=0;i<4;i++)q.cooldowns[i]=Math.max(q.cooldowns[i],2.2);}f.invuln=Math.max(f.invuln,.5);});
  later(12.7,()=>nlClear());}
});

Object.assign(SOURCE_ZS,{
 mcTether:(f,t)=>{
  zE('mctether',f,f.x,f.y,{r:460,d:1.0,fol:1,tu:t.uid});
  later(.26,()=>{
   if(!mcLive(f)||!mcLive(t))return;
   hurt(t,9,f,'skill');t.stun=Math.max(t.stun,.25);
   floatText(t.x,t.y-t.r-26,'HOOKED',MC.red,11);mcClank(3);
   const sx=t.x,sy=t.y,N=8;
   for(let i=1;i<=N;i++)later(i*.026,()=>{
    if(!mcLive(f)||!mcLive(t))return;
    const dx=sx-f.x,dy=sy-f.y,d=Math.hypot(dx,dy)||1,gap=f.r+t.r+13,ex=f.x+dx/d*gap,ey=f.y+dy/d*gap,u=mcEase(i/N);
    warp(t,sx+(ex-sx)*u,sy+(ey-sy)*u);
    if(i%2)particle(t.x,t.y,f,2,'cast');
    if(i===N){t.vx*=.25;t.vy*=.25;hurt(t,6,f,'skill');t.stun=Math.max(t.stun,.4);spawnBurst(t.x,t.y,f,10);floatText(f.x,f.y-f.r-24,'SNAP',MC.hot,12);screenShake=Math.max(screenShake,7);mcClank(4);}
   });
  });
 },
 mcCage:(f,t)=>{
  const R0=104,dur=3.4,e=zE('mccage',f,t.x,t.y,{r:R0,d:dur,dl:.3,iv:.35,dmg:2.3,slow:.6,root:.35,pull:12,tu:t.uid,from:{x:f.x,y:f.y}});
  const T=34;for(let i=1;i<=T;i++)later(i*dur/T,()=>{e.r=R0-34*(i/T);});
  floatText(t.x,t.y-R0-12,'LINK CAGE',MC.hot,11);
  for(let k=0;k<6;k++)later(k*.05,()=>mcClank(k));
 },
 mcFlail:(f,t)=>{
  if(f.mcSpin)return;
  const d=Math.hypot(t.x-f.x,t.y-f.y),sd=Math.random()<.5?1:-1;
  f.mcSpin={u:t.uid,t:0,dur:1.05,th:Math.atan2(t.y-f.y,t.x-f.x),R0:clamp(d,64,110),R:80,sd,tk:.2};
  f.mcSpinFx=zE('mcspin',f,f.x,f.y,{r:150,d:1.7,fol:1,tu:t.uid,sd});
  hurt(t,4,f,'skill');floatText(t.x,t.y-t.r-26,'COUNTERWEIGHT',MC.hot,10);mcClank(2);
 },
 mcLeash:(f,t)=>{
  const tu=t.uid,D=4.0,A0=.5;
  mcUnleash(f,D+.25,true);f.shield=Math.min(26,(f.shield||0)+10);
  const e=zE('mcult',f,W/2,H/2,{r:300,d:D+.6,arena:1,tu,D,A0});
  zE('mcblades',f,f.x,f.y,{fol:1,r:68,d:D,iv:.28,dmg:3.2,kb:75,dl:.3});
  floatText(t.x,t.y-t.r-30,'LEASHED',MC.red,12);
  const N=Math.round((D-A0)/.35);
  for(let i=0;i<N;i++)later(A0+i*.35,()=>{
   if(!mcLive(f))return;const tg=fighters.find(q=>q.uid===tu&&!q.dead);if(!tg)return;
   const ten=(i+1)/N;
   hurt(tg,1.2+5.6*ten*ten,f,'ultimate');
   tg.slow=Math.max(tg.slow,.4+.4*ten);if(ten>.55)tg.rooted=Math.max(tg.rooted,.4);
   const a=Math.atan2(ARENA.y+ARENA.h/2-tg.y,ARENA.x+ARENA.w/2-tg.x);tg.vx=tg.vx*.82+Math.cos(a)*10*ten;tg.vy=tg.vy*.82+Math.sin(a)*10*ten;
   screenShake=Math.max(screenShake,2+7*ten);if(i%2===0)mcClank(1+Math.round(ten*4));
  });
  later(D,()=>{
   if(!mcLive(f))return;const tg=fighters.find(q=>q.uid===tu&&!q.dead);if(!tg)return;
   hurt(tg,18,f,'ultimate');tg.stun=Math.max(tg.stun,.55);
   const a=Math.atan2(tg.y-f.y,tg.x-f.x);tg.vx+=Math.cos(a)*180;tg.vy+=Math.sin(a)*180;
   screenShake=Math.max(screenShake,18);flash=Math.max(flash,.2);screenZoom=Math.max(screenZoom,1.06);
   floatText(tg.x,tg.y-tg.r-34,'LEASH SNAPS',MC.hot,15);mcSnapSfx();
  });
 }
});

Object.assign(SOURCE_ZS,{
 srFace:(f,t)=>{
  srPosture(f,0);
  f.srFace=f.srFaceMax=1.5;f.srAbs=0;f.srReflect=1;f.vx*=.4;f.vy*=.4;
  zE('srface',f,f.x,f.y,{r:96,d:1.7,fol:1});
  floatText(f.x,f.y-f.r-28,'COVER THE FACE',SR.hot,10);
 },
 srFeet:(f,t)=>{
  srPosture(f,1);
  f.srFeet=3.0;f.rooted=Math.max(f.rooted||0,1.3);f.vx=0;f.vy=0;
  zE('srring',f,f.x,f.y,{r:SR_RING,d:3.0,fol:1,iv:.3,dmg:2.5,kb:64,dl:.28});
  floatText(f.x,f.y-f.r-28,'COVER THE FEET',SR.gold,10);
  screenShake=Math.max(screenShake,5);
 },
 srFlight:(f,t)=>{
  if(f.srUlt)return;
  srPosture(f,2);
  const A=ARENA,cx=A.x+A.w/2,cy=A.y+A.h/2;
  f.srFly={t:0,dur:1.8,sx:f.x,sy:f.y,th0:Math.atan2(f.y-cy,f.x-cx),dir:Math.random()<.5?1:-1,hit:new Set(),tk:0};
  f.stun=0;
  floatText(f.x,f.y-f.r-28,'TAKE FLIGHT',SR.iris,10);
 },
 srHoly:(f,t)=>{
  const tu=t.uid,holy=f.srHoly>0,D=6.6,T1=3.7,gap=.55;
  f.srUlt={t:0,D:T1+(holy?2:0)*gap+1.6};f.srFly=null;f.srFace=0;
  f.invuln=Math.max(f.invuln||0,T1+(holy?2:0)*gap+.5);f.stun=0;f.rooted=0;
  const cleared=srClearField(f);
  if(cleared)floatText(W/2,H/2-60,'FIELD CLEARED',SR.hot,13);
  zE('srult',f,W/2,H/2,{r:340,d:D,arena:1,tu,T1,gap,holy,D});
  floatText(f.x,f.y-f.r-34,'\u266A \u266B \u266C',SR.gold,16);
  /* the gaze: every eye is on every rival */
  for(let i=0;i<9;i++)later(1.0+i*.27,()=>{
   if(!srLive(f))return;
   for(const q of srFoes(f)){hurt(q,q.uid===tu?1.4:1.0,f,'ultimate');q.slow=Math.max(q.slow||0,.5);}
   if(i%3===0)srTing(i);
  });
  later(.9,()=>srEyesSfx());
  const strikes=holy?3:1;
  for(let s=0;s<strikes;s++)later(T1+s*gap,()=>{
   if(!srLive(f))return;
   const tg=fighters.find(q=>q.uid===tu&&!q.dead)||srFoe(f);if(!tg)return;
   const last=holy&&s===2,dmg=holy?(last?78:38):52;
   hurt(tg,dmg,f,'ultimate');
   tg.stun=Math.max(tg.stun||0,last?.9:.5);
   const a=Math.atan2(tg.y-f.y,tg.x-f.x);tg.vx+=Math.cos(a)*(last?220:110);tg.vy+=Math.sin(a)*(last?220:110);
   floatText(tg.x,tg.y-tg.r-30-s*12,last?'\u266C \u266B \u266C':'\u266A \u266B',last?SR.hot:SR.gold,last?20:16);
   screenShake=Math.max(screenShake,last?24:15);flash=Math.max(flash,last?.05:.03);screenZoom=Math.max(screenZoom,last?1.1:1.06);
   for(let k=0;k<(last?24:12);k++)particle(tg.x+rand(-10,10),tg.y+rand(-10,10),f,1,'ultimate');
   srLanceSfx(last||!holy);
   if(s===0){
    f.burn=0;f.slow=0;f.stun=0;f.rooted=0;f.srWit=0;
    zE('srcleanse',f,f.x,f.y,{r:150,d:1.1,fol:1});
    floatText(f.x,f.y-f.r-40,'GUILT TAKEN AWAY',SR.iris,12);
   }
   if(s===strikes-1)f.srHoly=0;
  });
 }
});

SOURCE_ZS.srFace=function(f,t){SR_Z_FACE(f,t);zE('srcloak',f,f.x,f.y,{r:100,d:.7,fol:1});};

SOURCE_ZS.srFlight=function(f,t){const had=f.srFly;SR_Z_FLY(f,t);if(f.srFly&&!had)zE('srslam',f,f.x,f.y,{r:80,d:.6,fol:1});};

Object.assign(SOURCE_ZS,{
 odW0:(f,t,a)=>{odAct(f,'dash',.55);const x2=f.x+Math.cos(a)*86,y2=f.y+Math.sin(a)*86;odE('odring',f,f.x,f.y,{r:56,d:.8,dmg:9,once:1,iv:.05,kb:110,c:0,v:'dance'});zE('odstreak',f,f.x,f.y,{r:10,d:.8,ex:x2,ey:y2,c:0});zD(f,a,380,.22);later(.24,()=>{if(!f.dead)odE('odring',f,f.x,f.y,{r:62,d:.8,dmg:9,once:1,iv:.05,kb:120,c:0,v:'dance'});});},
 odW1:(f,t)=>{odAct(f,'cast',.6);odFan(f,t,5,250,4,.2,.25,0);},
 odW2:(f,t)=>{odAct(f,'cast',.9);f.shield=Math.min(26,(f.shield||0)+14);odHeal(f,8);odE('odring',f,f.x,f.y,{r:100,d:1.6,dmg:4,iv:.4,slow:.7,fol:1,gr:1,c:0,v:'lake'});},
 odW3:(f,t)=>{odAct(f,'ult',2.2);let px=null,py=null;for(let k=0;k<5;k++)later(k*.32,()=>{if(f.dead)return;const q=odPred(t,.5),x=q.x+rand(-22,22),y=q.y+rand(-22,22);odE('odring',f,x,y,{r:58,d:.95,dl:.55,dmg:14,once:1,iv:.05,kb:90,c:0,v:'strike',px,py},1);px=x;py=y;});
  later(1.9,()=>{if(f.dead)return;const q=odPred(t,.4);odE('odring',f,q.x,q.y,{r:140,d:1.3,dl:.6,dmg:26,once:1,iv:.05,kb:230,c:0,v:'nova'},1);later(.7,()=>odHeal(f,16));});},
 odB0:(f,t,a)=>{odAct(f,'dash',.55);const x2=f.x+Math.cos(a)*300,y2=f.y+Math.sin(a)*300;odE('odline',f,f.x,f.y,{x2,y2,w:20,d:.8,dl:.3,dmg:13,once:1,iv:.05,kb:70,c:1,v:'slash'});zD(f,a,520,.28);},
 odB1:(f,t)=>{odAct(f,'cast',.6);odFan(f,t,7,290,4.6,.16,.32,1);},
 odB2:(f,t,a)=>{odAct(f,'cast',.7);odE('odring',f,f.x,f.y,{r:48,d:.55,c:1,v:'eclipse',imp:1});warp(f,t.x-Math.cos(a)*74,t.y-Math.sin(a)*74);f.invuln=Math.max(f.invuln||0,.3);odE('odring',f,f.x,f.y,{r:84,d:.9,dl:.25,dmg:16,once:1,iv:.05,kb:150,c:1,v:'eclipse'});for(let i=0;i<14;i++)odSpark(f.x,f.y,1,1,'plume');},
 odB3:(f,t)=>{odAct(f,'ult',2.4);f.odSpin=2.6;const q0=odPred(t,.35);zE('odvortex',f,q0.x,q0.y,{r:110,d:2.3,c:1,ft:t.uid});for(let k=0;k<8;k++)later(k*.2,()=>{if(f.dead)return;const q=odPred(t,.35),b=k*.785+.3;odE('odring',f,q.x+Math.cos(b)*86,q.y+Math.sin(b)*86,{r:54,d:.9,dl:.5,dmg:14,once:1,iv:.05,kb:100,c:k%2,v:'eclipse'},1);});
  later(1.9,()=>{if(f.dead)return;const q=odPred(t,.35);odE('odring',f,q.x,q.y,{r:130,d:1.4,dl:.7,dmg:30,once:1,iv:.05,kb:260,c:1,v:'nova'},1);},1);},
 odD0:(f,t,a)=>{odAct(f,'dash',.6);const p=odPred(t,.45);for(const s of[-1,1]){const b=a+s*.62;odE('odline',f,p.x-Math.cos(b)*220,p.y-Math.sin(b)*220,{x2:p.x+Math.cos(b)*220,y2:p.y+Math.sin(b)*220,w:20,d:.85,dl:.4,dmg:13,once:1,iv:.05,kb:90,c:s<0?0:1,v:'comet'});}zD(f,a,500,.22);},
 odD1:(f,t)=>{odAct(f,'cast',.9);odE('cross',f,t.x,t.y,{r:150,d:2.4,dl:.4,n:2,w:20,dmg:8,iv:.28,slow:.35,ft:t.uid,c:2});},
 odD2:(f,t)=>{odAct(f,'bow',1.1);const p=odPred(t,.55);odE('odring',f,p.x,p.y,{r:112,d:1.2,dl:.6,dmg:24,once:1,iv:.05,kb:240,c:2,v:'bow'});f.shield=Math.min(26,(f.shield||0)+10);f.invuln=Math.max(f.invuln||0,.4);},
 odD3:(f,t)=>{odAct(f,'ult',3.4);odE('odcurtain',f,W/2,H/2,{r:10,d:3.6,c:2},1);const p=odPred(t,.8);for(let k=0;k<12;k++){const b=k*.5236;odE('odline',f,p.x,p.y,{x2:p.x+Math.cos(b)*260,y2:p.y+Math.sin(b)*260,w:16,d:1.6,dl:1+(k%2)*.35,dmg:12,once:1,iv:.05,kb:80,c:k%2,v:'beam'},1);}
  later(2.1,()=>{if(f.dead)return;const q=odPred(t,.3);odE('odring',f,q.x,q.y,{r:160,d:1.4,dl:.6,dmg:36,once:1,iv:.05,kb:300,c:2,v:'nova'},1);later(.7,()=>odHeal(f,18));});}
});

Object.assign(SOURCE_ZS,{
 svS0:(f,t,a)=>{f.svTool=1;f.svMine=0;f.svCraft=0;const x2=f.x+Math.cos(a)*330,y2=f.y+Math.sin(a)*330;svE('svline',f,f.x,f.y,{x2,y2,w:26,d:.55,dl:.04,dmg:12,once:1,iv:.03,kb:140,stun:.25,v:'pick'});zD(f,a,560,.3);f.stSw=.3;f.stSwMax=.3;f.stAng=a;
  later(.3,()=>{if(f.dead||t.dead)return;const p=svPred(t,.45),d=Math.hypot(p.x-f.x,p.y-f.y)||1,ang=Math.atan2(p.y-f.y,p.x-f.x);
   zD(f,ang,clamp(d/.36,140,520),.38);f.invuln=Math.max(f.invuln||0,.6);f.svTool=1;f.svZT=80;f.svZK=14;f.svAnv=.8;f.svAnvMax=.8;f.svMine=0;
   later(.34,()=>{if(f.dead)return;f.svZT=0;f.svZK=40;});
   later(.46,()=>{if(f.dead)return;f.svAnv=0;f.svZ=0;f.svZT=0;f.svLand=.3;svE('svblast',f,f.x,f.y,{r:88,d:.9,dl:.02,dmg:16,once:1,iv:.03,kb:300,stun:.55,v:'anvil'});zE('svanvil',f,f.x,f.y,{r:20,d:1.25});
    screenShake=Math.max(screenShake,16);flash=Math.max(flash,.18);svSnd('anvil');svMine(f,2,null,f.x,f.y);for(let i=0;i<6;i++)particle(f.x,f.y,f,1,'cast');});});},
 svS1:(f,t,a)=>{f.svTool=0;f.shield=Math.min(26,(f.shield||0)+9);const p=svPred(t,.5);
  for(let i=-1;i<=1;i++){const b=a+i*.5;svE('svblock',f,f.x+Math.cos(b)*58,f.y+Math.sin(b)*58,{r:19,d:4.2,v:f.stT});}
  svE('svtnt',f,p.x,p.y,{r:98,d:2.0,dl:1.25,dmg:17,once:1,iv:.03,kb:300});},
 svS2:(f,t,a)=>{f.svTool=2;f.svMine=0;f.svCraft=0;const p=svPred(t,.3),d=Math.hypot(p.x-f.x,p.y-f.y)||1,L=Math.min(380,d+90),x2=f.x+(p.x-f.x)/d*L,y2=f.y+(p.y-f.y)/d*L,ir=f.stM[2]>0;if(ir)f.stM[2]--;
  svE('svline',f,f.x,f.y,{x2,y2,w:26,d:.9,dl:.12,dmg:ir?15:11,once:1,iv:.03,kb:90,stun:ir?1.2:.8,v:'cart'});zD(f,a,620,.42);f.invuln=Math.max(f.invuln||0,.3);
  later(.5,()=>{if(f.dead)return;const q=svPred(t,.55),dd=Math.hypot(q.x-f.x,q.y-f.y)||1,ang=Math.atan2(q.y-f.y,q.x-f.x);
   f.svFly=1.05;f.svZT=54;f.svZK=6;f.svTool=3;zD(f,ang,clamp(dd/.7,220,430),.7);f.invuln=Math.max(f.invuln||0,.3);svSnd('rocket');
   zE('svrocket',f,f.x,f.y,{r:20,d:1.2,fol:1});
   later(.72,()=>{if(f.dead)return;f.svZT=0;f.svZK=10;});
   later(.95,()=>{if(f.dead)return;f.svFly=0;f.svZT=0;f.svZK=14;svE('svblast',f,f.x,f.y,{r:108,d:.9,dmg:10,once:1,iv:.03,kb:250,v:'elytra'});screenShake=Math.max(screenShake,8);f.invuln=Math.max(f.invuln||0,.3);});});},
 svS3:(f,t,a)=>{f.invuln=Math.max(f.invuln||0,.4);svE('svcave',f,W/2,H/2,{r:10,d:4.4},1);const p=svPred(t,.4);
  svE('svline',f,f.x,f.y,{x2:p.x,y2:p.y,w:36,d:.8,dl:.5,dmg:18,once:1,iv:.03,kb:340,stun:2.1,v:'piston'},1);
  later(.9,()=>{if(f.dead||t.dead)return;const q={x:t.x,y:t.y};
   for(let k=0;k<9;k++){const b=k*.698+.3,rr=40+(k%3)*26;svE('svtnt',f,q.x+Math.cos(b)*rr,q.y+Math.sin(b)*rr,{r:72,d:1.2+k*.05,dl:.7+k*.14,dmg:8,once:1,iv:.03,kb:150},1);}
   for(let k=0;k<4;k++){const b=k*1.57+.8;svE('svcreeper',f,q.x+Math.cos(b)*78,q.y+Math.sin(b)*78,{r:24,d:2.3,dl:1.6},1);}});
  later(2.55,()=>{if(f.dead)return;const q=svPred(t,.1);svE('svblast',f,q.x,q.y,{r:175,d:1.3,dl:.05,dmg:36,once:1,iv:.03,kb:360,v:'boom'},1);screenShake=Math.max(screenShake,30);flash=Math.max(flash,.6);
   later(.7,()=>{heal(f,20);floatText(f.x,f.y-f.r-26,'VICTORY STEAK','#ff9a7a',11);});});}
});

Object.assign(SOURCE_ZS,{
 btS0:(f,t,a)=>{const P=btSpend(f);f.btCast=.4;const p=btPred(t,.22),d=Math.hypot(p.x-f.x,p.y-f.y)||1,L=Math.min(470,d+70),ux=(p.x-f.x)/d,uy=(p.y-f.y)/d;
  btE('btline',f,f.x,f.y,{x2:f.x+ux*L,y2:f.y+uy*L,w:20,d:.95,dl:.08,dmg:6*P,once:1,iv:.03,slow:2.6*P,root:.45*P,v:'snare'});
  later(.22,()=>{if(!btLive(f)||t.dead)return;if(t.slow>1){btE('btwrap',f,t.x,t.y,{r:t.r+12,d:Math.min(3.4,t.slow),ft:t.uid});floatText(t.x,t.y-t.r-14,'SNARED',BT.goldL,10);}});},
 btS1:(f,t,a)=>{const P=btSpend(f);f.btCast=.45;for(const e of effects)if(e.z&&e.k==='btstitch'&&e.owner===f.uid)e.age=e.duration+.01;
  const d=Math.hypot(t.x-f.x,t.y-f.y);btE('btstitch',f,f.x,f.y,{r:16,d:7.5,fol:1,tgt:t.uid,max:clamp(d+85,175,310),dmg:26*P,stun:.7});floatText(t.x,t.y-t.r-14,'SEWN TOGETHER',BT.pinkL,10);},
 btS2:(f,t,a)=>{const P=btSpend(f);f.btCast=.35;btE('btdecoy',f,f.x,f.y,{r:20,d:7,P,seed:rand(0,6)});
  const away=Math.atan2(f.y-t.y,f.x-t.x)+rand(-.4,.4);zD(f,away,540,.38);f.invuln=Math.max(f.invuln||0,.4);floatText(f.x,f.y-f.r-14,'STAY WITH ME…',BT.lav,9);},
 btS3:(f,t,a)=>{const P=btSpend(f),dur=6.6;f.btUlt=dur;f.btUltMax=dur;f.btPinX=f.x;f.btPinY=f.y;f.btSmileT=0;f.vx=f.vy=0;f.invuln=Math.max(f.invuln||0,.5);
  btE('btult',f,W/2,H/2,{r:10,d:dur,P},1);}
});

  const CORE_HANDLER_SET = new Set(['well','lensbeam','shield','horizon','sunshot','flareorbit','prominence','supernova','lightdash','prism','photonedge','lightspeed','cloud','wisp','spores','dreamcollapse','charge','meteor','crater','cometstorm','dilation','rewind','timestop','timefracture','crescent','eclipsekiss','moonshards','totaleclipse','lance','blink','radiantpulse','redgiant','binary','arcstitch','pulsetrain','millinova','roots','seed','petalorbit','endgarden','cursorSnare','panelbreak','debugray','framebreak','wavefront','undertow','abyssal','maelstrom','sonicPing','reverbBloom','hushfield','infiniteChorus','polarityShift','railstrike','ironHalo','magnetarFlare','prismCopy','shiverShards','mirrorTrap','shatteredReflection','constellationMap','starfolio','catalogueMark','finalFootnote']);
  function executeCoreCase(name,f,target,index,dist,ang){
    if(!CORE_HANDLER_SET.has(name))return false;
    const tx=target.x,ty=target.y,ult=index===3;
    const zone=(type,x,y,r,duration,damage,interval=.45,extra={})=>createEffect(type,x,y,f,{r,duration,damage,interval,...extra,ultimate:ult});
    const radial=(type,r,duration,damage,interval=.45)=>zone(type,ARENA.x+ARENA.w/2,ARENA.y+ARENA.h/2,r,duration,damage,interval);
    switch(name){
      case 'well': zone('well',tx,ty,76,2,4.2,.5);zone('lensring',tx,ty,84,1.15,0); for(const q of fighters)if(q!==f&&effectHits(f,q)&&distanceTo(q,{x:tx,y:ty})<160){const a=Math.atan2(ty-q.y,tx-q.x);q.vx+=Math.cos(a)*20;q.vy+=Math.sin(a)*20;} break;
      case 'lensbeam': zone('lensbeam',f.x,f.y,40,.75,12,.45,{target:target.uid});hurt(target,12,f,'beam');target.vx+=Math.cos(ang)*125;target.vy+=Math.sin(ang)*125;break;
      case 'shield': f.shield=Math.min(api.sourceRules.shieldCapFor(f.id),f.shield+23);zone('shieldring',f.x,f.y,56,1.35,0);break;
      case 'horizon': radial('horizon',380,4,7,.52);break;
      case 'sunshot': shoot(f,target,'sunshot',13,310,{r:8});zone('flarecast',f.x,f.y,30,.45,0);break;
      case 'flareorbit': zone('flareorbit',f.x,f.y,65,2.1,4.5,.45);break;
      case 'prominence': zone('prominence',f.x,f.y,120,1.1,12,.75);break;
      case 'supernova': radial('supernova',420,1.85,18,.65);break;
      case 'lightdash': zone('lightdash',f.x,f.y,52,.62,0);zone('lensbeam',f.x,f.y,40,.46,5,.4,{target:target.uid});if(dist<220)hurt(target,15,f);break;
      case 'prism': shoot(f,target,'prism',11,385,{r:7,pierce:1});break;
      case 'photonedge': zone('photonedge',f.x+Math.cos(ang)*38,f.y+Math.sin(ang)*38,66,.65,0);if(dist<125)hurt(target,14,f);break;
      case 'lightspeed': radial('lightspeed',300,2.65,7,.42);zone('lensbeam',f.x,f.y,40,.7,6,.4,{target:target.uid});hurt(target,13,f);break;
      case 'cloud': zone('cloud',tx,ty,70,3.1,3.8,.48);break;
      case 'wisp': f.cloneTime=1.6;zone('wisp',f.x,f.y,55,1.4,0);f.invuln=Math.max(f.invuln||0,.25);break;
      case 'spores': fan(f,target,3,245,7,.27,{r:7,life:2.2,homing:.3});break;
      case 'dreamcollapse': radial('dreamcollapse',260,3.2,10,.56);for(let k=0;k<3;k++)zone('cloud',tx+rand(-60,60),ty+rand(-45,45),38,1.6,2.5,.5);break;
      case 'charge': zone('comettrail',f.x,f.y,50,.7,0);zone('crater',tx,ty,65,.45,0);if(dist<195)hurt(target,17,f);zD(f,ang,480,.28);break;
      case 'meteor': shoot(f,target,'meteor',14,210,{r:10,homing:.7,life:2.6});zone('meteorcall',tx,ty,38,.65,0);break;
      case 'crater': zone('crater',f.x,f.y,112,1.15,14,.62);break;
      case 'cometstorm': radial('cometstorm',250,3.15,6.5,.46);for(let k=0;k<3;k++)shoot(f,target,'meteor',8,rand(180,260),{r:9,homing:.6,life:2.5});break;
      case 'dilation': zone('dilation',tx,ty,80,2.8,3.5,.55);target.slow=Math.max(target.slow||0,1.9);break;
      case 'rewind': { f.invuln=Math.max(f.invuln||0,.48);f.hp=Math.min(f.maxHp,Math.max(f.hp,f.hp+Math.min(46,f.maxHp-f.hp)));target.stun=Math.max(target.stun||0,.35);zone('rewind',f.x,f.y,68,.95,0);zone('rewindfreeze',target.x,target.y,target.r+24,1.25,0,{target:target.uid});break; }
      case 'timestop': {const ts=roomRef.sim.sourceTimeStop;if(ts.timer<=0){Object.assign(ts,{timer:1.55,owner:f.uid,target:target.uid,startedAt:gameTime});f.invuln=Math.max(f.invuln||0,.18);zone('rewind',f.x,f.y,105,.9,0);floatText(f.x,f.y-42,'TIME STOP','#fff',16);}break;}
      case 'timefracture': radial('timefracture',280,3.25,6.6,.52);target.slow=Math.max(target.slow||0,2.6);break;
      case 'crescent': shoot(f,target,'crescent',12,275,{r:11,homing:.35,pierce:1});zone('crescent',f.x,f.y,50,.55,0);break;
      case 'eclipsekiss': zone('eclipsekiss',tx,ty,86,1.2,11,.4);if(dist<190)heal(f,8);break;
      case 'moonshards': fan(f,target,5,310,6.5,.19,{r:5,life:2,homing:.12});break;
      case 'totaleclipse': radial('totaleclipse',285,3.25,8.7,.48);break;
      case 'lance': zone('lance',f.x,f.y,30,.7,16,.45,{target:target.uid});hurt(target,16,f,'beam');break;
      case 'blink': zone('blink',f.x,f.y,44,.65,0);zone('blink',tx,ty,44,.65,0);if(dist<180)hurt(target,9,f);warp(f,tx-Math.cos(ang)*70,ty-Math.sin(ang)*70);break;
      case 'radiantpulse': zone('radiantpulse',f.x,f.y,118,1.2,13,.65);break;
      case 'redgiant': radial('redgiant',300,2.65,7.5,.48);hurt(target,14,f,'beam');break;
      case 'binary': zone('binary',f.x,f.y,75,1.8,5,.38);for(let k=0;k<2;k++)shoot(f,target,'pulsarorb',7,280,{r:6,homing:.3});break;
      case 'arcstitch': zone('arcstitch',f.x,f.y,dist,.7,14,.4,{target:target.uid});hurt(target,14,f,'electric');target.slow=Math.max(target.slow||0,.6);break;
      case 'pulsetrain': zone('pulsetrain',f.x,f.y,150,1.8,8,.48);break;
      case 'millinova': radial('millinova',250,3,6.3,.4);break;
      case 'roots': zone('roots',tx,ty,64,2,4.4,.42);target.rooted=Math.max(target.rooted||0,.9);break;
      case 'seed': shoot(f,target,'seed',13,240,{r:9,homing:.4});break;
      case 'petalorbit': zone('petalorbit',f.x,f.y,68,2.1,4.3,.42);f.shield=Math.min(api.sourceRules.shieldCapFor(f.id),f.shield+9);break;
      case 'endgarden': radial('endgarden',255,3.6,7.3,.48);break;
      case 'cursorSnare': zone('desync',f.x,f.y,68,.7,0,{target:target.uid});warp(f,tx-Math.cos(ang)*78,ty-Math.sin(ang)*78);f.invuln=Math.max(f.invuln||0,.14);hurt(target,15,f);target.stun=Math.max(target.stun||0,.24);break;
      case 'panelbreak': zone('panelbreak',tx,ty,92,1.05,0);warp(f,tx-Math.cos(ang)*92,ty-Math.sin(ang)*92);f.invuln=Math.max(f.invuln||0,.14);hurt(target,16,f);target.vx+=Math.cos(ang)*105;target.vy+=Math.sin(ang)*105;break;
      case 'debugray': f.invuln=Math.max(f.invuln||0,.27);target.stun=Math.max(target.stun||0,.42);zone('debugray',f.x,f.y,dist,.85,16,.8,{target:target.uid});hurt(target,16,f,'debug');break;
      case 'framebreak': radial('realityCrash',455,3.35,6.6,.48);f.invuln=Math.max(f.invuln||0,.38);for(const q of fighters)if(q!==f&&effectHits(f,q)){q.vx*=.68;q.vy*=.68;}roomRef.sim.sourceFourthWall={timer:2.2,x:f.x,y:f.y,side:4,owner:f.uid};break;
      case 'wavefront': zone('wavefront',tx,ty,95,1.3,7.2,.36);break;
      case 'undertow': zone('undertow',tx,ty,100,1.45,5.3,.38);for(const q of fighters)if(effectHits(f,q)){const a=Math.atan2(f.y-q.y,f.x-q.x);q.vx+=Math.cos(a)*45;q.vy+=Math.sin(a)*45;}break;
      case 'abyssal': zone('abyssal',tx,ty,120,2.1,5.4,.42);for(const q of fighters)if(effectHits(f,q)&&distanceTo(q,{x:tx,y:ty})<140)q.slow=Math.max(q.slow||0,1.1);break;
      case 'maelstrom': radial('maelstrom',430,3.55,7,.48);break;
      case 'sonicPing': shoot(f,target,'echo',13,330,{r:7,homing:.15});zone('sonicPing',f.x,f.y,dist,.48,0,{target:target.uid});break;
      case 'reverbBloom': hurt(target,10,f,'resonance');zone('reverbBloom',tx,ty,95,1.6,4.5,.34);break;
      case 'hushfield': radial('hushfield',280,2.8,5.8,.47);for(const q of fighters)if(effectHits(f,q))q.slow=Math.max(q.slow||0,1.5);break;
      case 'infiniteChorus': radial('infiniteChorus',430,3.45,7.2,.42);break;
      case 'polarityShift': zone('polarityShift',f.x,f.y,dist,.65,11,.45,{target:target.uid});target.vx+=(f.x-target.x)*.72;target.vy+=(f.y-target.y)*.72;hurt(target,11,f,'magnetic');break;
      case 'railstrike': zone('railstrike',f.x,f.y,dist,.55,19,.45,{target:target.uid});hurt(target,19,f,'melee');f.vx+=Math.cos(ang)*40;f.vy+=Math.sin(ang)*40;break;
      case 'ironHalo': zone('ironHalo',f.x,f.y,72,2.1,4.5,.38);f.shield=Math.min(api.sourceRules.shieldCapFor(f.id),f.shield+38);break;
      case 'magnetarFlare': radial('magnetarFlare',390,3.15,7.8,.43);break;
      case 'prismCopy': f.cloneTime=2.2;zone('prismCopy',f.x,f.y,48,1.5,0);shoot(f,target,'crystalshard',9,300,{r:6,homing:.22});break;
      case 'shiverShards': fan(f,target,5,295,8,.17,{r:6,life:2,homing:.05});break;
      case 'mirrorTrap': zone('mirrorTrap',tx,ty,78,1.8,6,.38);target.slow=Math.max(target.slow||0,.85);break;
      case 'shatteredReflection': radial('shatteredReflection',450,3.3,7.5,.42);break;
      case 'constellationMap': zone('constellationMap',tx,ty,120,1.45,6.3,.36);break;
      case 'starfolio': fan(f,target,3,295,7.5,.12,{r:6,homing:.28});break;
      case 'catalogueMark': target.markTarget=3.3;zone('catalogueMark',tx,ty,60,1.25,13,.5,{target:target.uid});hurt(target,13,f,'index');break;
      case 'finalFootnote': radial('finalFootnote',410,3.4,7.3,.44);break;
    }
    spawnBurst(f.x,f.y,f,6);return true;
  }

  function castSkill(room, f, target, index) {
    syncRoom(room); if (!f || f.dead || !target || target.dead || index < 0 || index > 3) return false;
    if (f.id === 'button') return false; // Button keeps its already-tested bespoke online pilot.
    const handlerName = handlerFor(f, index); if (!handlerName) return false;
    const dist = distanceTo(f, target), ang = Math.atan2(target.y - f.y, target.x - f.x);
    const reason = reasonForIndex(index);
    emit(index === 3 ? 'ultimate' : 'skill', { ownerUid: f.uid, targetUid: target.uid, x: f.x, y: f.y, targetX: target.x, targetY: target.y, skillIndex: index, ability: handlerName, source: 'v45' });
    return withReason(reason, index, f, () => {
      const fn = SOURCE_ZS[handlerName];
      if (typeof fn === 'function') {
        try { fn(f, target, ang, dist); }
        catch (error) {
          if (api.strict) throw new Error(`${f.id}.${handlerName}: ${error?.stack || error}`);
          api.emitEvent(room, 'ability_error', { fighterId: f.id, handler: handlerName, message: String(error?.message || error).slice(0, 120) });
          fallbackAbility(f, target, index, dist, ang, handlerName);
        }
      } else {
        const handled = executeCoreCase(handlerName, f, target, index, dist, ang);
        if (!handled) { fallbackAbility(f, target, index, dist, ang, handlerName); }
      }
      if (index === 3) v13_3GainUlt(f, 30); else v13_3GainUlt(f, 11);
      return true;
    });
  }
  function fallbackAbility(f, target, index, dist, angle, handler) {
    const reason = reasonForIndex(index);
    if (index === 2 || index === 3 || /ult|world|event|storm|collapse|harvest|finale|paradox|reversal|judgement|judgment/i.test(handler)) {
      createEffect('realityCrash', ARENA.x + ARENA.w/2, ARENA.y + ARENA.h/2, f, { r: index === 3 ? 300 : 150, duration: index === 3 ? 1.4 : 0.7, damage: index === 3 ? 10 : 5, interval: 0.4, reason, sourceIndex: index, ultimate: index === 3 });
    } else if (index === 1) {
      fan(f, target, 3, 300, 5.5, 0.2, { r: 6, homing: 0.18 });
    } else {
      shoot(f, target, 'zp', 7, 280, { r: 6, homing: 0.12 });
    }
  }
  function basicAttack(room, f, target, dist) {
    syncRoom(room); if (!f || !target || f.dead || target.dead) return false;
    const angle = Math.atan2(target.y - f.y, target.x - f.x);
    return withReason('impact', -1, f, () => {
      // These characters have distinct source-defined basic attacks in V45;
      // keep their attack shape/state instead of routing them through starbolt.
      if (f.id === 'perplexity') {
        if (f.pxThesis && f.pxThesis.uid === target.uid && (f.pxThesis.expires || 0) >= gameTime) {
          const p = shoot(f, target, 'zp', 5.5, 280, { r: 5, life: 2, homing: 0.16 });
          if (p) p.s = 'perplexity';
        } else {
          const p = shoot(f, target, 'zp', 5.5, 280, { r: 5, life: 2, homing: 0.16 });
          if (p) p.s = 'perplexity';
        }
        f.attackCD = 1.15 + rand(-0.04, 0.06); f.pxSerial = (f.pxSerial || 0) + 1;
        return true;
      }
      if (f.id === 'lovers') {
        if ((f.llWaltz || 0) > 0) { f.attackCD = 0.25; return true; }
        f.attackCD = 1.0;
        const p = shoot(f, target, 'zp', 5, 300, { r: 5, life: 1.9, homing: 0.2 });
        const lead = f.loversLead || f.llLead || 0;
        if (p) { p.s = 'lovers'; p.lq = lead; }
        if (f.llP2) for (const side of [-0.32, 0.32]) {
          const q = shoot(f, target, 'zp', 4, 330, { r: 5, life: 1.7, homing: 0.28 });
          if (q) { q.s = 'lovers'; q.lq = lead ^ 1; q.vx = Math.cos(angle + side) * 330; q.vy = Math.sin(angle + side) * 330; q.rot = angle + side; }
        }
        return true;
      }
      if (f.id === 'focalors') {
        if ((f.foUlt || 0) > 0) { f.attackCD = 0.3; return true; }
        const p = shoot(f, target, 'focalors', 7.4 * (f.foForm ? 1 : 1.15), 295, { r: 6, life: 2, homing: 0.2 });
        if (p) p.s = 'focalors'; f.attackCD = 0.88 + rand(-0.06, 0.08); return true;
      }
      if (f.id === 'eidolon') {
        if ((f.eiUlt || 0) > 0) { f.attackCD = 0.3; return true; }
        const p = shoot(f, target, 'eidolon', 6.6, 310, { r: 6, life: 2, homing: 0.25 });
        if (p) { p.s = 'eidolon'; p.fk = 3; } f.attackCD = 0.85 + rand(-0.04, 0.09); return true;
      }
      if (f.id === 'nullity') {
        if ((f.nlRed || 0) > 0 || (f.nlUlt || 0) > 0) { f.attackCD = 0.3; return true; }
        const p = shoot(f, target, 'nullity', 6.2, 330, { r: 6, life: 2, homing: 0.2 });
        if (p) { p.s = 'nullity'; p.fk = 0; } f.attackCD = 0.8 + rand(-0.04, 0.08); return true;
      }
      if (f.id === 'manacle') {
        const broken = Array.isArray(f.mcBrk) ? f.mcBrk.filter(v => Number.isFinite(v) && v > 0).length : 0;
        const unleashed = (f.mcUnr || 0) > 0;
        f.attackCD = (unleashed ? 0.62 : 0.95) + rand(-0.04, 0.07);
        const reach = (f.r || 22) + (target.r || 22) + 34 + broken * 9 + (unleashed ? 34 : 0);
        if (dist <= reach) {
          hurt(target, 9 + rand(0, 2) + broken * 0.8, f, 'weapon');
          target.vx += Math.cos(angle) * (46 + broken * 5); target.vy += Math.sin(angle) * (46 + broken * 5);
          zE('mclash', f, (f.x + target.x)/2, (f.y + target.y)/2, { r: 25 + broken * 3, d: 0.28, dmg: 0 });
        }
        return true;
      }
      if (f.id === 'seraphim') {
        if ((f.srFace || 0) > 0 || f.srFly || f.srUlt) { f.attackCD = 0.3; return true; }
        const holy = (f.srHoly || 0) > 0;
        const p = shoot(f, target, 'zp', holy ? 8 : 7, 330, { r: 5, life: 2.4, homing: 0.55 });
        if (p) p.s = 'seraphim'; f.attackCD = holy ? 0.7 : 1.0; return true;
      }
      if (f.id === 'odette') {
        if ((f.odCut || 0) > 0) { f.attackCD = 0.3; return true; }
        f.attackCD = 1.05 + rand(-0.05, 0.08); f.odetteAct = 1;
        const count = (f.odP | 0) === 2 ? 3 : 1;
        fan(f, target, count, 310, 3.8, 0.16, { r: 5, life: 1.9, homing: 0.2 });
        return true;
      }
      if (f.id === 'steve') {
        if (f.svMine || f.svCraft || f.svFly || f.svAnv) { f.attackCD = 0.3; return true; }
        f.attackCD = 0.66 + rand(-0.04, 0.07); f.svN = (f.svN || 0) + 1; f.stSw = 0.28;
        if (dist < 128) {
          hurt(target, 4.4, f, 'weapon'); target.vx += Math.cos(angle) * 55; target.vy += Math.sin(angle) * 55;
          zE('svslash', f, target.x, target.y, { r: (f.r || 22) + 42, d: 0.28, dmg: 0, target: target.uid });
          if (f.svN % 5 === 0) createEffect('svlava', target.x, target.y, f, { r: 46, duration: 2.2, damage: 2.4, interval: 0.45, reason: 'impact' });
        } else {
          const p = shoot(f, target, 'steve', 3.6, 340, { r: 5, life: 1.8 });
          if (p) { p.s = 'steve'; p.sv = f.stT || 0; }
        }
        return true;
      }
      if (ZMELEE.has(f.id)) {
        if (dist < (f.r || 22) + (target.r || 22) + 33) {
          const base = f.id === 'comet' ? 13 : (f.id === 'photon' || f.id === 'lunar') ? 11 : f.id === 'magnetar' ? 12 : 10;
          hurt(target, base + rand(0, 2), f, 'weapon');
          target.vx += Math.cos(angle) * (f.id === 'comet' ? 65 : 42); target.vy += Math.sin(angle) * (f.id === 'comet' ? 65 : 42);
          zE('burst', f, (f.x + target.x)/2, (f.y + target.y)/2, { r: 34, d: 0.4, dmg: 0, once: 1 });
        }
      } else {
        const row = ZRNG[f.id] || ['starbolt', 5.5];
        shoot(f, target, row[0], row[1], 235 + rand(-18, 20), { r: 5, life: 1.8, homing: ['nebula','voidbloom','fourthwall','mimic','archivist'].includes(f.id) ? 0.2 : 0 });
      }
      return true;
    });
  }
  function passiveStep(room, f, dt) {
    syncRoom(room);
    if (!f || f.dead) return;
    withReason('passive', -1, f, () => {
      try {
        if (typeof SOURCE_ZS.zPass === 'function') SOURCE_ZS.zPass(f, dt);
        if (f.id === 'lunar' && Math.random() < dt * 0.6 && f.hp < f.maxHp) heal(f, 0.45);
        if (f.id === 'ceres' && Math.random() < dt * 1.1) heal(f, 0.65);
        if (f.id === 'moonbeam' && Math.random() < dt * 0.9) heal(f, 0.5);
        if (f.id === 'venus' && f.hp < f.maxHp * 0.55) f.slow = Math.max(f.slow || 0, 0);
      } catch (error) {
        if (api.strict) throw error;
        api.emitEvent(room, 'ability_error', { fighterId: f.id, handler: 'passive', message: String(error?.message || error).slice(0, 120) });
      }
    });
  }
  const allHandlers = new Set(CATALOG.fighters.flatMap(entry => entry.variants.flatMap(v => v.skills.map(s => s.handler))));
  const sourceCoverage = () => {
    const covered = [...allHandlers].filter(name => typeof SOURCE_ZS[name] === 'function' || CORE_HANDLER_SET.has(name) || /^btS[0-3]$/.test(name));
    return { rosterCount: CATALOG.fighters.length, uniqueHandlers: allHandlers.size, sourceHandlers: Object.keys(SOURCE_ZS).length, coveredHandlers: covered.length, missing: [...allHandlers].filter(name => !covered.includes(name)) };
  };
  function expireSummons(room) {
    syncRoom(room);
    for (const f of fighters) if (f.twin) zTwin(f, 0); // Life is decremented in stepSummons instead; this call checks master/death.
  }
  function stepSummons(room, dt) {
    syncRoom(room);
    for (const f of [...fighters]) {
      if (!f.twin || f.dead) continue;
      f.life = (f.life || 0) - dt;
      const master = fighters.find(x => x.uid === f.mast);
      if (f.life <= 0 || !master || master.dead) { f.dead = true; f.koTime = 0; zPoof(f); }
      else {
        const target = findTarget(f);
        if (target && f.attackCD <= 0) { f.attackCD = 1.1; shoot(f, target, 'zp', 4.5 * (f.pow || 0.6), 250, { r: 5, homing: 0.15 }); }
        f.attackCD = Math.max(0, (f.attackCD || 0) - dt);
      }
    }
  }
  return { castSkill, basicAttack, passiveStep, stepScheduled, stepEffects, stepSummons, sourceCoverage, handlerFor, buildVariant };
}

// This data-driven source engine intentionally keeps the original character
// handlers separate from the authoritative transport/server lifecycle.
module.exports = createSourceAbilityEngine;
