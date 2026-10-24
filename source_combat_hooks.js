'use strict';

/* Server-side non-skill hooks transcribed from the V45 zHurt chain. */
function applyV45DamageHooks({ room, target, source, reason, damage, emit = () => {}, random = Math.random }) {
  if (!target || !Number.isFinite(damage) || damage <= 0) return { damage: 0, dodged: false };
  const before = damage;
  const hasTwin = !!room?.sim?.fighters?.some(f => f && f.twin && f.mast === target.uid && !f.dead);

  // Defender hooks execute before the target's shield absorbs damage.
  if (target.id === 'aries' && (target.dash || 0) > 0) damage *= 0.6;
  if (target.id === 'taurus') {
    damage *= 0.88;
    if ((target.passiveTicks || 0) % 5 === 4) target.shield = Math.min(30, (target.shield || 0) + 8);
  }
  if (target.id === 'gemini' && hasTwin) damage *= 0.88;
  if (target.id === 'libra' && damage > 11) damage = 11 + (damage - 11) * 0.4;
  if (target.id === 'capricorn' && target.hp < target.maxHp * 0.5) damage *= 0.8;
  if (target.id === 'cancer' && source && (reason === 'collision' || reason === 'melee' || reason === 'weapon')) {
    const reflected = Math.min(2.3, damage * 0.08);
    const absorbed = Math.min(source.shield || 0, reflected);
    source.shield = Math.max(0, (source.shield || 0) - absorbed);
    source.hp = Math.max(1, source.hp - (reflected - absorbed));
  }
  if (target.id === 'pisces' && random() < 0.02) {
    emit('dodge', { targetUid: target.uid, x: target.x, y: target.y, passive: 'drift' });
    return { damage: 0, dodged: true };
  }

  // Source-side hooks follow the defender's passive adjustments in V45.
  if (source) {
    if (source.id === 'aries' && reason === 'collision') damage *= 1.35;
    if (source.id === 'leo' && source.hp < source.maxHp * 0.4) damage *= 1.22;
    if (source.id === 'sagittarius' && reason === 'projectile') damage *= 1 + Math.min(0.3, Math.hypot(source.x - target.x, source.y - target.y) / 1000);
    if (source.id === 'scorpio') {
      target.burn = Math.max(target.burn || 0, 2.2);
      target.burnCD = 0.1;
      target.burnSource = source.uid;
    }
    if (source.id === 'mars' && source.hp < source.maxHp * 0.5) damage *= 1.15;
  }
  return { damage: Math.max(0, damage), dodged: false, adjusted: damage !== before };
}

function applyV45OnHit({ target, source, reason }) {
  if (!target || !source) return;
  if (source.id === 'saturn') target.slow = Math.max(target.slow || 0, 0.25);
  if (source.id === 'uranus') target.slow = Math.max(target.slow || 0, 0.5);
  if (source.id === 'frostwisp') target.slow = Math.max(target.slow || 0, 0.3);
  if (source.id === 'cinder') {
    target.burn = Math.max(target.burn || 0, 1.2);
    target.burnCD = 0.1;
    target.burnSource = source.uid;
  }
  if (source.id === 'scorpio') {
    target.burn = Math.max(target.burn || 0, 2.2);
    target.burnCD = 0.1;
    target.burnSource = source.uid;
  }
}

function applyV45PassiveTick({ fighter, dt, heal = () => {}, emit = () => {}, random = Math.random }) {
  if (!fighter || fighter.dead) return;
  if (fighter.id === 'virgo') {
    if (random() < dt * 1.2) heal(fighter, 0.7);
    fighter.burn = 0;
  }
  if (fighter.dash > 0) emit('source_particle', { ownerUid: fighter.uid, x: fighter.x, y: fighter.y, count: fighter.id === 'mercury' ? 3 : 2, kind: 'cast' });
  if (fighter.id === 'capricorn' && fighter.hp < fighter.maxHp * 0.5 && random() < dt * 10) {
    emit('source_particle', { ownerUid: fighter.uid, x: fighter.x, y: fighter.y, count: 1, kind: 'cast' });
  }
  if (!fighter.twin && fighter.id === 'ceres' && random() < dt * 1.1) heal(fighter, 0.65);
  if (!fighter.twin && fighter.id === 'moonbeam' && random() < dt * 0.9) heal(fighter, 0.5);
}

module.exports = { applyV45DamageHooks, applyV45OnHit, applyV45PassiveTick };
