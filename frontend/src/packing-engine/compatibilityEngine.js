// Fragility heuristic — shared across modules
export const isFragilePiece = (piece) => {
  const edge = (piece.edge || '').toLowerCase();
  const cat  = (piece.category || '').toLowerCase();
  return (
    edge.includes('polish') ||
    edge.includes('manual') ||
    cat.includes('sill') ||
    cat.includes('hearth') ||
    cat.includes('threshold') ||
    piece.thickness === '2CM' ||
    Boolean(piece.radius_value)
  );
};

const isHeavyPiece = (piece) =>
  Number(piece.length || 0) * Number(piece.width || 0) > 2000;

/**
 * Score the compatibility between two pieces.
 * Returns { score (-100–240), reasons[], warnings[] }
 */
export const scoreCompatibility = (pieceA, pieceB, rules = {}) => {
  let score = 0;
  const reasons  = [];
  const warnings = [];

  // ── Destination ──────────────────────────────────────────────
  const bA = String(pieceA.building || ''), bB = String(pieceB.building || '');
  const fA = String(pieceA.floor    || ''), fB = String(pieceB.floor    || '');
  const aA = String(pieceA.flat     || ''), aB = String(pieceB.flat     || '');

  if (bA && bB) {
    if (bA === bB) {
      score += 30; reasons.push('Same building');
      if (fA && fB && fA === fB) {
        score += 25; reasons.push('Same floor');
        if (aA && aB && aA === aB) {
          score += 40; reasons.push('Same apartment');
        }
      }
    } else {
      score -= 50; warnings.push('Different buildings');
    }
  } else if (bA || bB) {
    score -= 10;
  }

  // ── Material ──────────────────────────────────────────────────
  if (pieceA.material && pieceB.material) {
    if (pieceA.material === pieceB.material) {
      score += 20; reasons.push('Same material');
    } else {
      const penalty = rules.materialMixPenalty ?? -10;
      score += penalty;
      if (penalty < 0) warnings.push('Mixed materials');
    }
  }
  if (pieceA.thickness && pieceB.thickness) {
    if (pieceA.thickness === pieceB.thickness) {
      score += 20; reasons.push('Same thickness');
    } else {
      score -= 5;
    }
  }
  if (pieceA.finish && pieceB.finish && pieceA.finish === pieceB.finish) {
    score += 10; reasons.push('Same finish');
  }

  // ── Production ────────────────────────────────────────────────
  if (pieceA.category && pieceB.category && pieceA.category === pieceB.category) {
    score += 15; reasons.push('Same category');
  }
  const eA = (pieceA.edge || '').toLowerCase();
  const eB = (pieceB.edge || '').toLowerCase();
  if (eA && eB && eA !== 'none' && eA === eB) {
    score += 15; reasons.push('Matching edge profile');
  }
  const rA = String(pieceA.radius_value || ''), rB = String(pieceB.radius_value || '');
  if (rA && rB && rA === rB) {
    score += 10; reasons.push('Matching radius');
  }

  // ── Physical ──────────────────────────────────────────────────
  const lA = Number(pieceA.length || 0), lB = Number(pieceB.length || 0);
  const wA = Number(pieceA.width  || 0), wB = Number(pieceB.width  || 0);
  if (lA > 0 && lB > 0) {
    const dimDiff = Math.abs(lA - lB) / Math.max(lA, lB);
    if (dimDiff < 0.15)      { score += 20; reasons.push('Similar dimensions'); }
    else if (dimDiff > 0.5)  { score -= 20; warnings.push('Large size mismatch'); }
  }
  const areaA = lA * wA, areaB = lB * wB;
  if (areaA > 0 && areaB > 0) {
    const areaDiff = Math.abs(areaA - areaB) / Math.max(areaA, areaB);
    if (areaDiff < 0.25)     { score += 20; reasons.push('Balanced weight / size'); }
    else if (areaDiff > 0.7) { score -= 15; warnings.push('Heavy / light imbalance'); }
  }
  if ((lA > 80 || lB > 80) && Math.abs(lA - lB) > 20) {
    score -= 20; warnings.push('Oversized piece mismatch');
  }

  // ── Safety ────────────────────────────────────────────────────
  const fragA  = isFragilePiece(pieceA), fragB  = isFragilePiece(pieceB);
  const heavyA = isHeavyPiece(pieceA),   heavyB = isHeavyPiece(pieceB);

  if ((fragA && heavyB) || (fragB && heavyA)) {
    score -= 40; warnings.push('Fragile + heavy — foam separator required');
  }
  if (fragA || fragB) {
    warnings.push('Polished / fragile edges — separator foam recommended');
  }
  if ((fragA && !fragB) || (!fragA && fragB)) {
    score -= 15; warnings.push('Mixed fragile / rough surfaces');
  }
  if (Boolean(pieceA.radius_value) || Boolean(pieceB.radius_value)) {
    warnings.push('Corner radius — corner protectors required');
  }

  // Installation sequence
  const seqA = Number(pieceA.install_sequence || 0);
  const seqB = Number(pieceB.install_sequence || 0);
  if (seqA && seqB) {
    const seqDiff = Math.abs(seqA - seqB);
    if (seqDiff === 0)      { score += 25; reasons.push('Same install sequence'); }
    else if (seqDiff <= 2)  { score += 10; reasons.push('Adjacent install sequence'); }
    else if (seqDiff > 5)   { score -= 15; warnings.push('Sequence mismatch'); }
  }

  return { score: Math.max(-100, score), reasons, warnings };
};

/**
 * Score the overall compatibility of a crate's piece set.
 * Averages pairwise scores and normalises to 0–100.
 */
export const scoreCrateCompatibility = (pieces, rules = {}) => {
  if (!pieces || pieces.length === 0) return { score: 0, rawScore: 0, reasons: [], warnings: [] };
  if (pieces.length === 1) return { score: 100, rawScore: 100, reasons: ['Single piece crate'], warnings: [] };

  let totalScore = 0;
  const allReasons  = new Set();
  const allWarnings = new Set();
  let pairs = 0;

  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const result = scoreCompatibility(pieces[i], pieces[j], rules);
      totalScore += result.score;
      result.reasons.forEach(r  => allReasons.add(r));
      result.warnings.forEach(w => allWarnings.add(w));
      pairs++;
    }
  }

  const avgScore   = pairs > 0 ? totalScore / pairs : 0;
  const normalized = Math.round(Math.max(0, Math.min(100, ((avgScore + 100) / 200) * 100)));

  return {
    score:    normalized,
    rawScore: Math.round(avgScore),
    reasons:  Array.from(allReasons),
    warnings: Array.from(allWarnings),
  };
};
