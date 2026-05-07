import { isFragilePiece } from './compatibilityEngine';

/**
 * Comprehensive risk analysis for a crate.
 * All scores are 0–100 where higher = more risk / harder.
 * Production efficiency and shipping efficiency are 0–100 where higher = better.
 */
export const analyzeCrateRisk = (pieces, crateData = {}, grossWeight = 0) => {
  if (!pieces || !pieces.length) {
    return {
      damage_risk: 0, damage_risk_level: 'low',
      handling_difficulty: 0, handling_level: 'easy',
      production_efficiency: 100, shipping_efficiency: 0,
      recommendations: [],
    };
  }

  const fragileCount = pieces.filter(isFragilePiece).length;
  const fragileRatio = fragileCount / pieces.length;
  const hasPolished  = pieces.some(p => (p.edge || '').toLowerCase().includes('polish'));
  const hasRadius    = pieces.some(p => Boolean(p.radius_value));
  const hasHeavy     = pieces.some(p => Number(p.length || 0) * Number(p.width || 0) > 2000);
  const catSet       = new Set(pieces.map(p => p.category || 'Other'));
  const isMixed      = catSet.size > 2;
  const maxLen       = Math.max(...pieces.map(p => Number(p.length || 0)), 0);

  // ── Damage Risk ──────────────────────────────────────────────
  let damageRisk = 0;
  damageRisk += fragileRatio * 40;
  if (hasPolished) damageRisk += 20;
  if (hasRadius)   damageRisk += 15;
  if (fragileCount > 0 && hasHeavy) damageRisk += 25;
  if (isMixed)     damageRisk += 10;
  damageRisk = Math.min(100, Math.round(damageRisk));

  // ── Handling Difficulty ──────────────────────────────────────
  let handling = 0;
  if (grossWeight > 700)      handling += 50;
  else if (grossWeight > 400) handling += 35;
  else if (grossWeight > 200) handling += 20;
  if (maxLen > 100)           handling += 30;
  else if (maxLen > 60)       handling += 15;
  if (fragileRatio > 0.5)     handling += 20;
  handling = Math.min(100, Math.round(handling));

  // ── Production Efficiency ────────────────────────────────────
  let prodEff = 100;
  if (isMixed)                      prodEff -= 25;
  if (fragileRatio > 0.5 && hasHeavy) prodEff -= 30;
  if (grossWeight > (crateData.max_weight || 1000)) prodEff -= 20;
  prodEff = Math.max(0, prodEff);

  // ── Shipping Efficiency (fill %) ────────────────────────────
  const shippingEff = Math.round(crateData.fill_percent || 0);

  // ── Risk levels ──────────────────────────────────────────────
  const damageLevel  = damageRisk  > 60 ? 'high' : damageRisk  > 30 ? 'medium' : 'low';
  const handlingLevel = handling   > 60 ? 'difficult' : handling > 30 ? 'moderate' : 'easy';

  // ── Recommendations ──────────────────────────────────────────
  const recs = [];
  if (damageRisk > 40)                recs.push('Add foam separator between every piece');
  if (hasPolished)                    recs.push('Wrap polished surfaces with soft protective film');
  if (hasRadius)                      recs.push('Install corner protectors at all radius corners');
  if (grossWeight > 600)              recs.push('Forklift required — ensure lifting points on crate base');
  if (fragileCount > 0 && hasHeavy)   recs.push('Load heavy pieces first; place fragile pieces on top');
  if (isMixed)                        recs.push('Label each zone — mixed categories need sorting at site');
  if (shippingEff < 50 && shippingEff > 0) recs.push('Low fill — consider merging with another underfilled crate');

  return {
    damage_risk:          damageRisk,
    damage_risk_level:    damageLevel,
    handling_difficulty:  handling,
    handling_level:       handlingLevel,
    production_efficiency: prodEff,
    shipping_efficiency:  shippingEff,
    recommendations:      recs,
  };
};
