import { isFragilePiece } from './compatibilityEngine';

/**
 * Generate a human-readable explanation for why pieces are grouped together.
 * Returns { summary, score, scoreLabel, reasons[], warnings[] }
 */
export const generateCrateReasoning = (pieces, compatibilityResult = {}) => {
  if (!pieces || !pieces.length) {
    return { summary: 'Empty crate', score: 0, scoreLabel: 'N/A', reasons: [], warnings: [] };
  }

  const reasons  = [];
  const warnings = new Set(compatibilityResult.warnings || []);

  // ── Destination ──────────────────────────────────────────────
  const buildings = [...new Set(pieces.map(p => p.building).filter(Boolean))];
  const floors    = [...new Set(pieces.map(p => p.floor).filter(Boolean))];
  const flats     = [...new Set(pieces.map(p => p.flat).filter(Boolean))];

  if (buildings.length === 1)      reasons.push(`Building ${buildings[0]}`);
  else if (buildings.length > 1)   warnings.add(`Mixed buildings: ${buildings.join(', ')}`);
  if (floors.length === 1)         reasons.push(`Floor ${floors[0]}`);
  else if (floors.length === 2)    reasons.push(`Adjacent floors: ${floors.join(' & ')}`);
  else if (floors.length > 2)      reasons.push(`${floors.length} floors`);
  if (flats.length === 1)          reasons.push(`Flat ${flats[0]}`);
  else if (flats.length <= 3)      reasons.push(`${flats.length} apartments (${flats.join(', ')})`);
  else                             reasons.push(`${flats.length} apartments`);

  // ── Material ─────────────────────────────────────────────────
  const materials  = [...new Set(pieces.map(p => p.material).filter(Boolean))];
  const thicknesses = [...new Set(pieces.map(p => p.thickness).filter(Boolean))];
  if (materials.length === 1)  reasons.push(`${materials[0]} only`);
  else                         warnings.add(`Mixed materials: ${materials.join(', ')}`);
  if (thicknesses.length === 1) reasons.push(`Uniform ${thicknesses[0]}`);

  // ── Category ─────────────────────────────────────────────────
  const cats = [...new Set(pieces.map(p => p.category).filter(Boolean))];
  if (cats.length === 1)   reasons.push(`All ${cats[0]}`);
  else if (cats.length > 1) reasons.push(`${cats.length} categories`);

  // ── Edge / Finish ─────────────────────────────────────────────
  const edges = [...new Set(
    pieces.map(p => p.edge).filter(v => v && v !== 'None' && v !== 'none' && v !== '')
  )];
  if (edges.length === 1) reasons.push(`${edges[0]} edge`);
  const polishedCount = pieces.filter(p => (p.edge || '').toLowerCase().includes('polish')).length;
  if (polishedCount > 0) warnings.add(`${polishedCount} polished edge piece${polishedCount > 1 ? 's' : ''} — foam separator required`);

  // ── Physical ─────────────────────────────────────────────────
  const areas = pieces.map(p => Number(p.length || 0) * Number(p.width || 0)).filter(a => a > 0);
  if (areas.length > 1) {
    const maxA = Math.max(...areas), minA = Math.min(...areas);
    if (maxA > 0 && (maxA - minA) / maxA < 0.3) reasons.push('Similar piece dimensions');
  }

  // ── Fragile warnings ─────────────────────────────────────────
  const fragCount = pieces.filter(isFragilePiece).length;
  if (fragCount > 0) warnings.add(`${fragCount} fragile piece${fragCount > 1 ? 's' : ''}`);

  // ── Summary ──────────────────────────────────────────────────
  const score      = compatibilityResult.score ?? 0;
  const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Acceptable' : 'Poor';
  const summary    = `${scoreLabel} compatibility (${score}/100) — ${reasons.length} matching factor${reasons.length !== 1 ? 's' : ''}`;

  return {
    summary,
    score,
    scoreLabel,
    reasons:  reasons.slice(0, 8),
    warnings: Array.from(warnings).slice(0, 5),
  };
};

/**
 * Generate warehouse-level metadata and label for a crate.
 */
export const generateWarehouseMetadata = (crate, pieces, constructionInfo = {}) => {
  const destinations = [...new Set(
    pieces.map(p => [
      p.building && `B${p.building}`,
      p.floor    && `F${p.floor}`,
      p.flat,
    ].filter(Boolean).join('/'))
  )].filter(Boolean);

  const crateIdStr = String(crate.crate_id || crate.id || '');
  const numericPart = crateIdStr.replace(/\D/g, '').padStart(6, '0');
  const flags = constructionInfo.handling_flags || [];

  return {
    crate_id:          crateIdStr,
    barcode:           `SD-${numericPart}`,
    label:             `${crate.name || crateIdStr} — ${destinations[0] || 'No Destination'}`,
    handling_type:     constructionInfo.crate_type_label || 'Standard Crate',
    handling_flags:    flags,
    forklift_required: flags.includes('FORKLIFT_REQUIRED'),
    team_lift_required: flags.includes('TEAM_LIFT'),
    upright_only:      flags.includes('UPRIGHT_ONLY'),
    do_not_stack:      flags.includes('DO_NOT_STACK'),
    fragile:           flags.includes('FRAGILE'),
    top_load_only:     false,
    destination_note:  destinations.slice(0, 4).join(' · '),
    piece_count:       pieces.length,
    sequence_priority: 1,
  };
};
