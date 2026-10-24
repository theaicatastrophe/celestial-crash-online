'use strict';

/*
 * Source-derived combat constants extracted from CelestialCrash_Button_V45_Cute.html.
 * This is a compact rules module for the online server, not the full offline engine.
 * The source still contains additional per-character hooks and ability implementations.
 */

const BASE_HP = 360; // V10's wrapped makeFighter sets every fighter to 360 before character overrides.
const MAX_HP_BY_ID = Object.freeze({
  blackhole: 420,
  lovers: 480,
  focalors: 490,
  eidolon: 420,
  nullity: 410,
  seraphim: 420,
  odette: 450,
  steve: 430,
  button: 410
});
const INITIAL_HP_BY_ID = Object.freeze({ blackhole: 300 });

const DAMAGE_SCALE = Object.freeze({
  blackhole:.98, solarflare:.85, photon:.99, nebula:.97, comet:1.16,
  chrono:.91, lunar:.86, quasar:1.12, pulsar:.96, voidbloom:.83,
  fourthwall:.79, tidal:.90, siren:.96, magnetar:.78, mimic:.90, archivist:.90,
  aries:.90, taurus:.87, gemini:.85, cancer:.76, leo:.91, virgo:.78,
  libra:.87, scorpio:.78, sagittarius:.87, capricorn:.84, aquarius:.90, pisces:.58,
  mercury:.50, venus:.74, earth:.85, mars:.85, jupiter:.84, saturn:.84,
  uranus:.92, neptune:.83, pluto:.72, ceres:.68
});
const SUSTAIN = Object.freeze({
  lunar:.07, voidbloom:.06, scorpio:.04, venus:.03, pluto:.05,
  ceres:.04, comet:.12, pisces:.028, libra:.035, virgo:.025, neptune:.03
});
const SHIELD_CAP = Object.freeze({
  blackhole:32, solarflare:18, photon:20, nebula:18, comet:22, chrono:20,
  lunar:22, quasar:18, pulsar:20, voidbloom:26, fourthwall:18, tidal:22,
  siren:18, magnetar:32, mimic:24, archivist:20, aries:26, taurus:40,
  gemini:18, cancer:22, leo:18, virgo:22, libra:22, scorpio:18,
  sagittarius:16, capricorn:26, aquarius:22, pisces:18, mercury:16,
  venus:20, earth:26, mars:24, jupiter:30, saturn:34, uranus:22,
  neptune:30, pluto:20, ceres:22
});
const SKILL_BASE_COOLDOWNS = Object.freeze({"blackhole":[4.4,4.9,6.8,14.0],"solarflare":[3.7,5.3,6.4,15.2],"photon":[3.3,4.7,5.9,13.9],"nebula":[4.8,5.4,4.5,14.6],"comet":[3.9,5.4,6.4,15.5],"chrono":[5.0,9.0,13.0,15.0],"lunar":[4.4,5.8,4.6,15.2],"quasar":[4.2,5.3,6.2,14.8],"pulsar":[4.2,5.0,6.4,14.4],"voidbloom":[4.8,4.6,5.7,15.1],"fourthwall":[4.5,6.1,6.8,15.2],"tidal":[4.4,5.2,6.6,15.3],"siren":[4.0,5.5,6.5,15.1],"magnetar":[4.2,5.6,6.7,15.6],"mimic":[4.3,5.0,6.4,15.2],"archivist":[4.5,5.1,6.1,15.4],"aries":[3.6,5.0,6.8,14.6],"taurus":[4.2,5.3,6.2,15.4],"gemini":[3.5,11.5,5.6,15.0],"cancer":[4.4,6.6,5.2,15.2],"leo":[4.0,5.0,6.5,15.0],"virgo":[3.8,7.0,5.8,15.4],"libra":[4.0,5.6,6.4,15.6],"scorpio":[3.6,5.8,4.6,14.8],"sagittarius":[3.2,5.0,6.0,14.8],"capricorn":[4.0,5.4,6.2,15.3],"aquarius":[3.8,5.4,6.3,15.2],"pisces":[3.6,6.0,6.8,15.5],"mercury":[3.0,4.6,5.4,14.6],"venus":[3.8,6.0,5.8,15.2],"earth":[4.4,9.0,6.8,15.6],"mars":[3.4,6.0,7.4,15.4],"jupiter":[4.2,6.5,7.0,15.8],"saturn":[3.8,6.2,6.8,15.4],"uranus":[3.8,5.4,6.4,15.6],"neptune":[3.8,5.6,8.6,15.2],"pluto":[4.2,5.8,8.0,15.8],"ceres":[3.8,6.4,5.6,15.0],"stardust":[3.4,4.8,6.4,14.2],"cinder":[3.6,5.6,4.8,14.0],"moonbeam":[3.6,5.6,7.0,14.6],"pebble":[3.6,5.2,6.2,14.8],"frostwisp":[3.6,6.4,5.0,14.4],"zapmoth":[4.6,5.2,4.0,14.0],"whitehole":[4.4,5.5,6.8,16.2],"claude":[4.6,5.2,6.6,15.0],"chatgpt":[4.5,5.6,6.7,15.6],"grok":[4.4,5.5,6.3,15.8],"metaai":[4.2,5.8,6.4,15.2],"dola":[4.2,5.6,6.5,15.4],"perplexity":[3.9,5.8,6.7,15.2],"lovers":[3.6,5.4,6.8,15.5],"focalors":[3.9,5.5,6.9,15.4],"eidolon":[3.8,6.0,8.5,15.4],"nullity":[3.4,6.4,9.2,15.4],"manacle":[4.2,5.6,6.5,15.8],"seraphim":[4.4,5.6,6.4,15.6],"odette":[3.6,4.6,6.8,15.5],"steve":[3.2,5.2,7.0,15.0],"button":[3.4,6.2,7.4,16.0]});
const ULT_CHARACTER_SCALE = Object.freeze({
  earth:.90, mercury:.82, venus:.78, cancer:.76, scorpio:.82,
  virgo:.86, pisces:.60, pluto:.80, ceres:.82
});
const HEAL_SCALE = Object.freeze({
  lunar:.82, voidbloom:.76, scorpio:.68, venus:.60, pluto:.55,
  ceres:.56, pisces:.40, libra:.72, virgo:.45, neptune:.78, cancer:.58
});
const HEAL_RATE = Object.freeze({
  lunar:6.0, voidbloom:5.2, scorpio:4.0, venus:2.8, pluto:4.0,
  ceres:3.8, pisces:2.4, libra:4.4, virgo:2.3, neptune:4.2, cancer:3.2
});
const SKILL_FACTOR = .94;
const ULTIMATE_FACTOR = .83;

const SKILL_REASONS = new Set([
  'skill', 'button_snare', 'button_stitch', 'button_decoy'
]);
const ULTIMATE_REASONS = new Set(['ultimate', 'button_ultimate_tick', 'button_ultimate']);
const NO_SUSTAIN_REASONS = new Set(['burn', 'passive', 'button_passive']);


function skillBaseCooldownFor(id, index) {
  const row = SKILL_BASE_COOLDOWNS[id];
  const value = row && row[index];
  if (Number.isFinite(value)) return value;
  return [3.3, 5.0, 6.6, 14.8][index] || 3.3;
}
function cooldownAfterCastFor(id, index, random = Math.random) {
  const base = skillBaseCooldownFor(id, index);
  // V45's shared cast wrapper applies 1.16× plus ±0.12 s for skills 0–2.
  // The later V13.3 wrapper rearms ultimates to max(7.5 s, metadata cooldown × .58).
  if (index === 3) return Math.max(7.5, base * 0.58);
  return base * 1.16 + (random() * 0.24 - 0.12);
}

function maxHpFor(id) { return MAX_HP_BY_ID[id] || BASE_HP; }
function initialHpFor(id) { return INITIAL_HP_BY_ID[id] ?? maxHpFor(id); }
function shieldCapFor(id, twin = false) { return twin ? 14 : (SHIELD_CAP[id] || 26); }
function damageMultiplierFor(sourceId, reason = 'impact') {
  // Mirrors the final V10 hurt wrapper: per-source tuning and the global raw-damage factor.
  let multiplier = .68 * (DAMAGE_SCALE[sourceId] || .88);
  if (ULTIMATE_REASONS.has(reason)) {
    multiplier *= ULTIMATE_FACTOR * (ULT_CHARACTER_SCALE[sourceId] || 1);
  } else if (SKILL_REASONS.has(reason)) {
    multiplier *= SKILL_FACTOR;
  }
  return multiplier;
}
function scaleOutgoingDamage(rawDamage, sourceId, reason = 'impact') {
  const raw = Number(rawDamage);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw * damageMultiplierFor(sourceId, reason);
}
function applySourceHeal(fighter, requestedAmount, elapsedSeconds) {
  if (!fighter || fighter.dead || !(requestedAmount > 0)) return 0;
  const scaled = requestedAmount * (HEAL_SCALE[fighter.id] ?? .82);
  const second = Math.floor(Math.max(0, elapsedSeconds || 0));
  if (fighter.sourceHealSecond !== second) {
    fighter.sourceHealSecond = second;
    fighter.sourceHealApplied = 0;
  }
  const rate = HEAL_RATE[fighter.id] ?? 3.8;
  const grant = Math.min(scaled, Math.max(0, rate - (fighter.sourceHealApplied || 0)));
  if (!(grant > 0)) return 0;
  const before = fighter.hp;
  fighter.hp = Math.min(fighter.maxHp, fighter.hp + grant);
  const actual = Math.max(0, fighter.hp - before);
  fighter.sourceHealApplied = (fighter.sourceHealApplied || 0) + actual;
  return actual;
}
function capShield(fighter) {
  if (!fighter) return;
  const cap = shieldCapFor(fighter.id, !!fighter.twin);
  const value = Number.isFinite(fighter.shield) ? fighter.shield : 0;
  fighter.shield = Math.max(0, Math.min(cap, value));
}

module.exports = {
  BASE_HP, MAX_HP_BY_ID, INITIAL_HP_BY_ID, DAMAGE_SCALE, SUSTAIN,
  SHIELD_CAP, ULT_CHARACTER_SCALE, HEAL_SCALE, HEAL_RATE,
  SKILL_FACTOR, ULTIMATE_FACTOR,
  maxHpFor, initialHpFor, shieldCapFor, damageMultiplierFor,
  SKILL_BASE_COOLDOWNS, skillBaseCooldownFor, cooldownAfterCastFor,
  scaleOutgoingDamage, applySourceHeal, capShield,
  SKILL_REASONS, ULTIMATE_REASONS, NO_SUSTAIN_REASONS
};
