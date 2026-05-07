import { scoreCrateCompatibility } from './compatibilityEngine';

const estimatePieceWeight = (piece) => {
  const area = Number(piece.length || 0) * Number(piece.width || 0) / 144; // sqft
  const factors = { Granite: 7.5, Quartz: 6.75, Marble: 8.0 };
  return area * (factors[piece.material] || 7.5);
};

/**
 * Greedy clustering optimizer.
 * Groups pieces into clusters that maximise intra-cluster compatibility
 * while respecting weight and count constraints.
 *
 * Returns Array<{ pieces, totalWeight, compatibility: {score, reasons, warnings} }>
 * sorted by compatibility score descending.
 */
export const optimizePacking = (pieces, constraints = {}, rules = {}) => {
  const {
    maxWeight            = 1000,
    maxPieces            = 30,
    minCompatibilityScore = 40,
  } = constraints;

  if (!pieces || !pieces.length) return [];

  // Seed order: largest pieces first so small pieces fill gaps
  const sorted = [...pieces].sort((a, b) => {
    const aA = Number(a.length || 0) * Number(a.width || 0);
    const aB = Number(b.length || 0) * Number(b.width || 0);
    return aB - aA;
  });

  const clusters  = [];
  const assigned  = new Set();

  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;

    const cluster = [seed];
    let clusterWeight = estimatePieceWeight(seed);
    assigned.add(seed.id);

    for (const candidate of sorted) {
      if (assigned.has(candidate.id))     continue;
      if (cluster.length >= maxPieces)    break;
      const cw = estimatePieceWeight(candidate);
      if (clusterWeight + cw > maxWeight) continue;

      // Only add if compatibility improves (or stays acceptable)
      const trial = [...cluster, candidate];
      const { score } = scoreCrateCompatibility(trial, rules);
      if (score >= minCompatibilityScore) {
        cluster.push(candidate);
        clusterWeight += cw;
        assigned.add(candidate.id);
      }
    }

    clusters.push({
      pieces:        cluster,
      totalWeight:   Math.round(clusterWeight * 10) / 10,
      compatibility: scoreCrateCompatibility(cluster, rules),
    });
  }

  return clusters.sort((a, b) => b.compatibility.score - a.compatibility.score);
};

/**
 * Score ALL existing crate groupings at once.
 * Returns { [crateId]: { score, rawScore, reasons, warnings } }
 */
export const scoreExistingGroupings = (piecesByCrate = {}, rules = {}) => {
  const result = {};
  Object.entries(piecesByCrate.grouped || {}).forEach(([crateId, pieces]) => {
    result[crateId] = scoreCrateCompatibility(pieces, rules);
  });
  return result;
};
