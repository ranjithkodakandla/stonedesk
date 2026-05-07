import { isFragilePiece } from './compatibilityEngine';

// ── Crate type specs ─────────────────────────────────────────────────────────

export const CRATE_TYPES = {
  LIGHT: {
    label:          'Light Crate',
    description:    'Simple flat-stacked crate for small, standard pieces.',
    woodThickness:  0.75,
    braceCount:     2,
    foamPaddingSqFt: 2,
    separatorCount: 1,
    strapPoints:    2,
    forkliftSlots:  true,
    cornerProtectors: false,
    baseCost:       45,
  },
  MEDIUM: {
    label:          'Medium Reinforced',
    description:    'Reinforced sides for mid-weight or mixed-category loads.',
    woodThickness:  1.0,
    braceCount:     4,
    foamPaddingSqFt: 4,
    separatorCount: 2,
    strapPoints:    4,
    forkliftSlots:  true,
    cornerProtectors: false,
    baseCost:       85,
  },
  HEAVY: {
    label:          'Heavy Reinforced',
    description:    'Full bracing for heavy countertop / slab loads.',
    woodThickness:  1.5,
    braceCount:     6,
    foamPaddingSqFt: 6,
    separatorCount: 3,
    strapPoints:    6,
    forkliftSlots:  true,
    cornerProtectors: true,
    baseCost:       150,
  },
  VERTICAL: {
    label:          'Vertical Slab Crate',
    description:    'A-frame style crate for large slabs or waterfall pieces.',
    woodThickness:  1.25,
    braceCount:     5,
    foamPaddingSqFt: 5,
    separatorCount: 2,
    strapPoints:    4,
    forkliftSlots:  true,
    cornerProtectors: true,
    baseCost:       120,
  },
  FRAGILE: {
    label:          'Fragile Finish Crate',
    description:    'Maximum foam padding for polished, radius, or miter pieces.',
    woodThickness:  1.25,
    braceCount:     4,
    foamPaddingSqFt: 10,
    separatorCount: 5,
    strapPoints:    4,
    forkliftSlots:  true,
    cornerProtectors: true,
    baseCost:       130,
  },
  MIXED: {
    label:          'Mixed Utility Crate',
    description:    'Multi-category crate with labelled zones.',
    woodThickness:  1.25,
    braceCount:     4,
    foamPaddingSqFt: 4,
    separatorCount: 2,
    strapPoints:    4,
    forkliftSlots:  true,
    cornerProtectors: false,
    baseCost:       95,
  },
};

// ── Classification ───────────────────────────────────────────────────────────

export const classifyCrate = (pieces, grossWeight = 0) => {
  if (!pieces || !pieces.length) return 'LIGHT';

  const fragileCount = pieces.filter(isFragilePiece).length;
  const fragileRatio = fragileCount / pieces.length;
  const hasPolished  = pieces.some(p => (p.edge || '').toLowerCase().includes('polish'));
  const hasMiter     = pieces.some(p => /miter/i.test(p.shape_type || ''));
  const hasWaterfall = pieces.some(p => /waterfall|l.shape/i.test(p.shape_type || ''));
  const hasRadius    = pieces.some(p => Boolean(p.radius_value));
  const isThin       = pieces.every(p => p.thickness === '2CM');
  const hasLarge     = pieces.some(p => Number(p.length || 0) > 80 || Number(p.width || 0) > 40);
  const catSet       = new Set(pieces.map(p => p.category || 'Other'));

  if (hasWaterfall || (isThin && hasLarge)) return 'VERTICAL';
  if (hasPolished || hasMiter || hasRadius || fragileRatio > 0.5) return 'FRAGILE';
  if (grossWeight > 700) return 'HEAVY';
  if (grossWeight > 350) return 'MEDIUM';
  if (catSet.size > 2)   return 'MIXED';
  return 'LIGHT';
};

// ── Handling flags ───────────────────────────────────────────────────────────

const buildHandlingFlags = (pieces, typeKey, grossWeight) => {
  const flags = [];
  if (typeKey === 'VERTICAL')                      flags.push('UPRIGHT_ONLY');
  if (typeKey === 'FRAGILE' || typeKey === 'VERTICAL') flags.push('FRAGILE');
  if (grossWeight > 600)                           flags.push('FORKLIFT_REQUIRED');
  else if (grossWeight > 250)                      flags.push('TEAM_LIFT');
  if (['HEAVY', 'FRAGILE', 'VERTICAL'].includes(typeKey)) flags.push('DO_NOT_STACK');
  if (pieces.some(p => Boolean(p.radius_value)))   flags.push('CORNER_PROTECTED');
  if (pieces.some(p => (p.edge || '').toLowerCase().includes('polish'))) flags.push('POLISHED_SURFACE');
  return flags;
};

// ── Main export ──────────────────────────────────────────────────────────────

export const getCrateConstruction = (pieces, grossWeight = 0) => {
  const typeKey = classifyCrate(pieces, grossWeight);
  const spec    = CRATE_TYPES[typeKey];

  const fragileCount   = pieces.filter(isFragilePiece).length;
  const extraFoam      = fragileCount * 0.5;
  const extraSeps      = pieces.length > 5 ? Math.floor(pieces.length / 5) : 0;
  const hasRadius      = pieces.some(p => Boolean(p.radius_value));
  const estimatedCost  = Math.round(spec.baseCost + extraFoam * 5 + extraSeps * 3);

  return {
    crate_type:         typeKey,
    crate_type_label:   spec.label,
    description:        spec.description,
    wood_thickness:     spec.woodThickness,
    brace_count:        spec.braceCount,
    foam_padding_sqft:  Math.round((spec.foamPaddingSqFt + extraFoam) * 10) / 10,
    separator_count:    spec.separatorCount + extraSeps,
    strap_points:       spec.strapPoints,
    forklift_slots:     spec.forkliftSlots,
    corner_protectors:  spec.cornerProtectors || hasRadius,
    estimated_cost_usd: estimatedCost,
    handling_flags:     buildHandlingFlags(pieces, typeKey, grossWeight),
  };
};
