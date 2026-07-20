import { round2 } from './plannerUtils';

/**
 * Frontend port of backend operational dimension helpers.
 * Mirrors leaned_operational_cassette_dimensions() and related logic in
 * services/planner_v3/dimensions.py — kept in sync manually.
 *
 * All dimensions are in inches. All weights are in kg.
 */

// ─── Thickness lookup ────────────────────────────────────────────────────────

const THICKNESS_INCH = {
  '2CM': 0.79,
  '3CM': 1.18,
  '4CM': 1.57,
  '2.0CM': 0.79,
  '3.0CM': 1.18,
  'Mixed': 0.98,
};

// ─── Part Type → crate class ──────────────────────────────────────────────────
// island_vertical: Kitchen - Island Tops ONLY — upright cassette geometry
// kitchen_vertical: Kitchen perimeter/range tops + splashes — upright family bundle
// vanity_vertical: Vanity tops + splashes — upright family bundle (compact)
// misc: everything else — horizontal layered (legacy flat-lay)

const PART_TYPE_TO_CRATE_CLASS = {
  'Kitchen - Island Tops':     'island_vertical',
  'Kitchen - Perimeter Tops':  'kitchen_vertical',
  'Kitchen - Range Tops':      'kitchen_vertical',
  'Kitchen - Back Splash':     'kitchen_vertical',
  'Kitchen - Side Splash':     'kitchen_vertical',
  'Vanity - Top':              'vanity_vertical',
  'Vanity - Back Splash':      'vanity_vertical',
  'Vanity - Side Splash':      'vanity_vertical',
  'Misc - Full Height Splash': 'misc',
  'Misc - Window Sill':        'misc',
  'Misc - Bar Top':            'misc',
};

const BUCKET_TO_CRATE_CLASS = {
  kitchen_islands: 'island_vertical',
  kitchen:         'kitchen_vertical',
  vanity:          'vanity_vertical',
  misc:            'misc',
};

export function getCrateClass(bundle) {
  // part_bucket is backend-authoritative — use it first to prevent category fallback
  // from misrouting splash bundles that carry an island family's category field.
  if (bundle.part_bucket && BUCKET_TO_CRATE_CLASS[bundle.part_bucket]) {
    return BUCKET_TO_CRATE_CLASS[bundle.part_bucket];
  }
  // Try Part Type from main pieces next
  const pieces = bundle.pieces || [];
  for (const p of pieces) {
    if (p.role !== 'splash') {
      const cls = PART_TYPE_TO_CRATE_CLASS[String(p.part || '').trim()];
      if (cls) return cls;
    }
  }
  // Final fallback: derive from category field
  const cat = (bundle.category || '').toLowerCase();
  if (cat === 'island') return 'island_vertical';
  if (cat === 'perimeter' || cat === 'range') return 'kitchen_vertical';
  if (cat === 'vanity') return 'vanity_vertical';
  return 'misc';
}

// Infer crate class from a group of bundles (used by buildDraftCrate).
function inferCrateClassFromBundles(bundles) {
  const classes = new Set(bundles.map((b) => getCrateClass(b)));
  if (classes.has('island_vertical') && classes.size === 1) return 'island_vertical';
  if (classes.has('vanity_vertical') && !classes.has('island_vertical') && !classes.has('kitchen_vertical')) return 'vanity_vertical';
  if ((classes.has('kitchen_vertical')) && !classes.has('island_vertical')) return 'kitchen_vertical';
  return 'misc';
}

// ─── Island splash stripping ──────────────────────────────────────────────────
// Island crates must contain ONLY island tops. If a bundle has splash pieces
// (role === 'splash') they are removed before the bundle enters an island crate.
// Stripped weight is subtracted so the weight-batching target stays accurate.

function stripSplashFromBundle(bundle) {
  const pieces = bundle.pieces || [];
  const splashPieces = pieces.filter((p) => p.role === 'splash');
  if (splashPieces.length === 0) return bundle;

  const mainPieces    = pieces.filter((p) => p.role !== 'splash');
  const splashWeight  = splashPieces.reduce((s, p) => s + (p.weight_kg || 0), 0);

  return {
    ...bundle,
    pieces:          mainPieces,
    splash_count:    0,
    part_count:      mainPieces.length,
    total_weight_kg: Math.max(0, (bundle.total_weight_kg || 0) - splashWeight),
    splash_stripped: splashPieces.length,
  };
}

// ─── Weight batching ──────────────────────────────────────────────────────────
// Greedy: accumulate bundles until next one would breach targetWeightKg, then start a new batch.

function weightBatchBundles(bundles, targetWeightKg) {
  if (!bundles.length) return [];
  const batches = [];
  let current = [];
  let currentWeight = 0;

  for (const bundle of bundles) {
    const w = bundle.total_weight_kg || 0;
    if (currentWeight + w > targetWeightKg && current.length > 0) {
      batches.push(current);
      current = [bundle];
      currentWeight = w;
    } else {
      current.push(bundle);
      currentWeight += w;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Same greedy-fill idea as weightBatchBundles, but at raw-part granularity
// (no crate-class splitting — this view is filter-driven, not geometry-driven).
export function weightBatchParts(parts, targetWeightKg = 1900) {
  if (!parts?.length) return [];
  const batches = [];
  let current = [];
  let currentWeight = 0;

  for (const part of parts) {
    const w = part.weight_kg || 0;
    if (currentWeight + w > targetWeightKg && current.length > 0) {
      batches.push(current);
      current = [part];
      currentWeight = w;
    } else {
      current.push(part);
      currentWeight += w;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const CLASS_ORDER = ['island_vertical', 'kitchen_vertical', 'vanity_vertical', 'misc'];

// ─── Multi-crate batch builder ────────────────────────────────────────────────
// Phase 1: partition by crate class (island stays isolated from all other categories).
// Phase 2: weight-batch within each class at targetWeightKg.
// Returns array of bundle groups — caller assigns IDs and calls buildDraftCrate().

export function batchBundlesIntoCrates(selectedBundles, targetWeightKg = 1900) {
  if (!selectedBundles?.length) return [];

  const buckets = Object.fromEntries(CLASS_ORDER.map((cls) => [cls, []]));
  for (const bundle of selectedBundles) {
    buckets[getCrateClass(bundle)].push(bundle);
  }

  const groups = [];
  for (const cls of CLASS_ORDER) {
    // Strip splash before weight-batching so island crate weights are accurate.
    // Then discard any bundles stripped down to zero content — they must not form empty crates.
    const bundles = cls === 'island_vertical'
      ? buckets[cls]
          .map(stripSplashFromBundle)
          .filter((b) => (b.part_count || b.pieces?.length || 0) > 0 || (b.total_weight_kg || 0) > 0)
      : buckets[cls];

    if (!bundles.length) continue;
    const batches = weightBatchBundles(bundles, targetWeightKg);
    for (const batch of batches) {
      groups.push({ crateClass: cls, bundles: batch });
    }
  }
  return groups;
}

function parseThicknessIn(t) {
  if (!t) return 1.18; // default 3CM
  const key = String(t).trim().toUpperCase().replace(' ', '');
  if (THICKNESS_INCH[key] != null) return THICKNESS_INCH[key];
  if (THICKNESS_INCH[String(t).trim()] != null) return THICKNESS_INCH[String(t).trim()];
  const n = parseFloat(t);
  return isNaN(n) ? 1.18 : n;
}

// ─── Rectangular upright cassette geometry ────────────────────────────────────
// Mirrors leaned_operational_cassette_dimensions() in Python (dimensions.py).
//
// Physical model: slabs stand upright, flush against internal wall supports.
// No lean angle. No cosine correction.
//
//   L (primary, fixed): max slab LONG edge  + end clearance
//   D (depth, dynamic): Σ thicknesses + foam separators + framing
//   H (direct):         slab SHORT edge + pallet + headroom

const SEPARATOR_IN        = 0.75;   // kitchen/vanity layer foam (depth stack)
const ISLAND_SEPARATOR_IN = 0.04;   // island cassette: 100µm poly-film face separator
const DEPTH_FRAME      = 4.0;    // total framing allowance on depth axis
const LENGTH_CLEARANCE = 2.0;    // internal end clearance (1" each end)
const END_FRAME        = 2.0;    // external end-board thickness (1" each end)
const PALLET_BASE      = 6.0;    // pallet / sled base height
const HEADROOM         = 4.0;    // head clearance above slabs
const WALL_TIMBER      = 3.0;    // structural timber wall each side (depth axis)
const HEIGHT_CAP_TBR   = 6.0;    // top cap timber
const FORKLIFT_TINE    = 7.0;    // forklift tine clearance

export function estimateLeanedCassetteDimensions(pieces) {
  if (!pieces || pieces.length === 0) {
    return {
      internal_length: 0, internal_width: 0, internal_height: 0,
      external_length: 0, external_width: 0, external_height: 0,
    };
  }

  // Height derives from main piece short edges; splash pieces are shallow and don't dictate height
  const mainPieces = pieces.filter((p) => (p.role || 'main') !== 'splash');
  const refPieces  = mainPieces.length > 0 ? mainPieces : pieces;

  let stackDepth   = 0;
  let maxLongEdge  = 0;
  let maxShortEdge = 0;

  for (const p of pieces) {
    stackDepth += parseThicknessIn(p.thickness);
  }
  for (const p of refPieces) {
    const L = parseFloat(p.length) || 0;
    const W = parseFloat(p.width)  || 0;
    maxLongEdge  = Math.max(maxLongEdge,  Math.max(L, W));
    maxShortEdge = Math.max(maxShortEdge, L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W));
  }

  // L — primary length: fixed by slab footprint, not by slab count
  const intL = maxLongEdge + LENGTH_CLEARANCE;

  // D — cassette depth: grows with slab count and foam separators
  const intD = stackDepth + Math.max(0, pieces.length - 1) * ISLAND_SEPARATOR_IN + DEPTH_FRAME;

  // H — height: short edge upright (no lean correction)
  const intH = maxShortEdge + PALLET_BASE + HEADROOM;

  return {
    internal_length: round2(intL),
    internal_width:  round2(intD),
    internal_height: round2(intH),
    external_length: round2(intL + END_FRAME),
    external_width:  round2(intD + WALL_TIMBER * 2),
    external_height: round2(intH + HEIGHT_CAP_TBR + FORKLIFT_TINE),
  };
}

// Kept for any legacy callers; delegates to the upright cassette model.
export function estimateVerticalCassetteDimensions(pieces) {
  return estimateLeanedCassetteDimensions(pieces);
}

const HORIZ_PALLET_BASE   = 4.0;   // pallet / sled base (flat-lay misc only)
const HORIZ_LID           = 3.0;   // top cap framing
const HORIZ_WALL          = 3.0;   // side wall timber
const HORIZ_END_FRAME     = 4.0;   // end boards (2" each end)
const HORIZ_LENGTH_CLEAR  = 6.0;   // internal end clearance (3" each end)
const HORIZ_WIDTH_PAD     = 6.0;   // internal side clearance (3" each side)
const HORIZ_LAYER_SEP     = 1.0;   // foam separator between layers

function isBackSplashPiece(piece) {
  return /back.?splash/i.test(piece.part || '');
}

function isSideSplashPiece(piece) {
  return /side.?splash/i.test(piece.part || '');
}

// ─── Rectangular family bundle geometry (Kitchen / Vanity) ─────────────────
// Warehouse model: tops stand upright, flush against internal wall supports.
// No lean angle. Splashes and multi-top separation accumulate on DEPTH — not HEIGHT.
//
//   L (length):  max slab long edge + end clearance  [long edge on pallet]
//   H (height):  max TOP short edge + pallet + headroom  [upright, no correction]
//   D (depth):   Σ top thicknesses + inter-top foam + splash depths + framing
//
// Build sequence preserved: tops → foam → back splash → foam → side splash (depth order).

function pieceLongShort(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 0;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short };
}

export function estimateLeaningFamilyBundleDimensions(pieces, layerGapIn = HORIZ_LAYER_SEP) {
  const gap = Number(layerGapIn) > 0 ? Number(layerGapIn) : HORIZ_LAYER_SEP;
  if (!pieces || pieces.length === 0) {
    return {
      internal_length: 0, internal_width: 0, internal_height: 0,
      external_length: 0, external_width: 0, external_height: 0,
    };
  }

  const mainTops = pieces.filter((p) => !isBackSplashPiece(p) && !isSideSplashPiece(p));
  const backSplash = pieces.filter(isBackSplashPiece);
  const sideSplash = pieces.filter(isSideSplashPiece);
  const heightRef = mainTops.length > 0 ? mainTops : pieces;

  let maxLong = 0;
  for (const p of pieces) {
    maxLong = Math.max(maxLong, pieceLongShort(p).long);
  }

  let maxTopShort = 0;
  for (const p of heightRef) {
    maxTopShort = Math.max(maxTopShort, pieceLongShort(p).short);
  }

  const intL = maxLong + HORIZ_LENGTH_CLEAR;
  const intH = maxTopShort + PALLET_BASE + HEADROOM;

  let depth = DEPTH_FRAME;
  if (mainTops.length > 0) {
    mainTops.forEach((p, i) => {
      depth += parseThicknessIn(p.thickness);
      if (i > 0) depth += gap;
    });
  }
  if (backSplash.length > 0) {
    depth += gap + Math.max(...backSplash.map((p) => parseThicknessIn(p.thickness)));
  }
  if (sideSplash.length > 0) {
    depth += gap + Math.max(...sideSplash.map((p) => parseThicknessIn(p.thickness)));
  }

  const intW = depth;

  return {
    internal_length: round2(intL),
    internal_width: round2(intW),
    internal_height: round2(intH),
    external_length: round2(intL + HORIZ_END_FRAME),
    external_width: round2(intW + HORIZ_WALL * 2),
    external_height: round2(intH + HEIGHT_CAP_TBR + FORKLIFT_TINE),
  };
}

/** Draft-crate display geometry — islands unchanged; kitchen/vanity use family bundle. */
export function estimateDraftCrateDimensions(crateClass, pieces, layerGapIn = HORIZ_LAYER_SEP) {
  if (crateClass === 'island_vertical') return estimateLeanedCassetteDimensions(pieces);
  if (crateClass === 'kitchen_vertical' || crateClass === 'vanity_vertical') {
    return estimateLeaningFamilyBundleDimensions(pieces, layerGapIn);
  }
  return estimateHorizontalLayeredDimensions(pieces, layerGapIn);
}

// ─── Horizontal layered crate geometry (misc / legacy) ───────────────────────
// Flat-lay model retained for misc class only — NOT used for kitchen/vanity.
//
// Physical stack (bottom → top):
//   pallet frame
//   main tops  (Perimeter Tops / Range Tops / Vanity Top)
//   1″ separator
//   back splashes
//   1″ separator
//   side splashes
//   lid framing
//
// Axis model:
//   internal_length = max long edge of all pieces + length clearance  [L]
//   internal_width  = max short edge of all pieces + side padding      [W]
//   internal_height = accumulated layer thicknesses + separators + framing [H]

export function estimateHorizontalLayeredDimensions(pieces, layerGapIn = HORIZ_LAYER_SEP) {
  const gap = Number(layerGapIn) > 0 ? Number(layerGapIn) : HORIZ_LAYER_SEP;
  if (!pieces || pieces.length === 0) {
    return {
      internal_length: 0, internal_width: 0, internal_height: 0,
      external_length: 0, external_width: 0, external_height: 0,
    };
  }

  const backSplash = pieces.filter(isBackSplashPiece);
  const sideSplash = pieces.filter(isSideSplashPiece);
  const mainTops   = pieces.filter((p) => !isBackSplashPiece(p) && !isSideSplashPiece(p));

  // Length + width driven by largest footprint across all pieces
  let maxLong = 0, maxShort = 0;
  for (const p of pieces) {
    const L = parseFloat(p.length) || 0;
    const W = parseFloat(p.width)  || 0;
    maxLong  = Math.max(maxLong, Math.max(L, W));
    maxShort = Math.max(maxShort, L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W));
  }

  const intL = maxLong  + HORIZ_LENGTH_CLEAR;
  const intW = maxShort + HORIZ_WIDTH_PAD;

  // Height from stacked layers — each layer's height is its max material thickness
  const mainH = mainTops.length   > 0 ? Math.max(...mainTops.map((p)   => parseThicknessIn(p.thickness))) : 0;
  const backH = backSplash.length > 0 ? Math.max(...backSplash.map((p) => parseThicknessIn(p.thickness))) : 0;
  const sideH = sideSplash.length > 0 ? Math.max(...sideSplash.map((p) => parseThicknessIn(p.thickness))) : 0;

  let intH = HORIZ_PALLET_BASE;
  if (mainH > 0) intH += mainH;
  if (backH > 0) intH += gap + backH;
  if (sideH > 0) intH += gap + sideH;

  return {
    internal_length: round2(intL),
    internal_width:  round2(intW),
    internal_height: round2(intH),
    external_length: round2(intL + HORIZ_END_FRAME),
    external_width:  round2(intW + HORIZ_WALL * 2),
    external_height: round2(intH + HORIZ_LID),
  };
}

// ─── Operational warnings ────────────────────────────────────────────────────

export function generateCrateWarnings({ totalWeightKg, dimensions, partTypeMix, bundleCount, islandSplashViolation = false, hadSplashStripped = false, crateClass = null }) {
  const warnings = [];
  if (!bundleCount || totalWeightKg === 0) return warnings;

  if (islandSplashViolation) {
    warnings.push('Island crate contains splash pieces — Kitchen - Island Tops ONLY are permitted.');
  }
  if (hadSplashStripped) {
    warnings.push('Splash pieces excluded from island crate — they remain unassigned in inventory.');
  }

  if (totalWeightKg < 300) {
    warnings.push('Underloaded — consider adding more pieces before shipping.');
  }
  if (totalWeightKg > 5000) {
    warnings.push(`Heavy load — ${totalWeightKg.toLocaleString('en-AU')} kg. Verify forklift capacity.`);
  }

  // Warn if crate mixes parts from different crate classes (e.g. island tops with vanity tops).
  const ptm = partTypeMix || {};
  const crateClasses = new Set(
    Object.keys(ptm).filter((k) => (ptm[k] || 0) > 0).map((pt) => PART_TYPE_TO_CRATE_CLASS[pt] || 'misc'),
  );
  if (crateClasses.size > 1) {
    warnings.push('Mixed-type crate — confirm operational grouping with site team.');
  }

  const isIslandCrate = crateClass === 'island_vertical';

  // Island cassette: depth axis is internal_width — warn if cassette gets very deep.
  if (isIslandCrate && (dimensions?.internal_width || 0) > 24) {
    warnings.push('Deep cassette — check slot clearance and load stability.');
  }

  // Horizontal crates: check overall height clears the container roof (< 90″ external).
  if (!isIslandCrate && (dimensions?.external_height || 0) > 88) {
    warnings.push('Tall crate — verify container interior clearance (target < 90″).');
  }

  return warnings;
}

// ─── Draft crate builder ─────────────────────────────────────────────────────

export function buildDraftCrate(id, selectedBundles) {
  const allPieces = selectedBundles.flatMap((b) => b.pieces || []);

  // Metrics computed from individual pieces — never from bundle aggregates.
  // Falls back to bundle-level fields when piece detail is absent.
  const hasPieceDetail = allPieces.length > 0;
  const totalWeightKg = hasPieceDetail
    ? allPieces.reduce((s, p) => s + (p.weight_kg || 0), 0)
    : selectedBundles.reduce((s, b) => s + (b.total_weight_kg || 0), 0);
  const totalSqft = hasPieceDetail
    ? allPieces.reduce((s, p) => s + (p.sqft || 0), 0)
    : selectedBundles.reduce((s, b) => s + (b.total_sqft || 0), 0);
  const partCount = hasPieceDetail
    ? allPieces.length
    : selectedBundles.reduce((s, b) => s + (b.part_count || 0), 0);

  // Part Type mix — keyed by standardized Part Type name (e.g. "Kitchen - Island Tops").
  // Drives chips, warnings, and operational status — NEVER uses legacy category fields.
  const partTypeMix = {};
  for (const p of allPieces) {
    const pt = String(p.part || '').trim() || '(Unknown)';
    partTypeMix[pt] = (partTypeMix[pt] || 0) + 1;
  }

  // Determine crate class to select the correct geometry model.
  const crateClass = inferCrateClassFromBundles(selectedBundles);
  const isIslandCrate = crateClass === 'island_vertical';

  // Island isolation: splash pieces must NEVER appear in island crates.
  const islandSplashViolation = isIslandCrate && allPieces.some((p) => {
    if (p.role === 'splash') return true;
    const partType = String(p.part || '').trim();
    return /back.?splash|side.?splash/i.test(partType);
  });
  const hadSplashStripped = selectedBundles.some((b) => (b.splash_stripped || 0) > 0);

  // Select geometry: island → upright cassette; kitchen/vanity → family bundle; misc → flat-lay.
  const dimensions = estimateDraftCrateDimensions(crateClass, allPieces);

  const warnings = generateCrateWarnings({
    totalWeightKg,
    dimensions,
    partTypeMix,
    bundleCount: selectedBundles.length,
    islandSplashViolation,
    hadSplashStripped,
    crateClass,
  });

  return {
    id,
    bundles:                 [...selectedBundles],
    bundle_count:            selectedBundles.length,
    part_count:              partCount,
    total_weight_kg:         round2(totalWeightKg),
    total_sqft:              round2(totalSqft),
    part_type_mix:           partTypeMix,
    crate_class:             crateClass,
    island_splash_violation: islandSplashViolation,
    dimensions,
    warnings,
    created_at:              Date.now(),
  };
}

/**
 * Recompute all derived fields after bundle list changes.
 */
export function recomputeCrate(crate) {
  return buildDraftCrate(crate.id, crate.bundles);
}

/**
 * Operational status for a draft crate.
 * Priority: ERROR > OVERWEIGHT > REVIEW > UNDERLOADED > READY
 */
export function getCrateOperationalStatus(crate) {
  if (crate.island_splash_violation) return 'ERROR';
  const w = crate.total_weight_kg || 0;
  if (w > 2200) return 'OVERWEIGHT';
  // REVIEW if parts from different crate classes are mixed (e.g. island tops + vanity tops).
  const ptm = crate.part_type_mix || {};
  const crateClasses = new Set(
    Object.keys(ptm).filter((k) => (ptm[k] || 0) > 0).map((pt) => PART_TYPE_TO_CRATE_CLASS[pt] || 'misc'),
  );
  if (crateClasses.size > 1) return 'REVIEW';
  if (w < 1400) return 'UNDERLOADED';
  return 'READY';
}

/**
 * Return the lowest DC-NNN id not already in use.
 * Deleting DC-002 from [DC-001, DC-002, DC-003] → next is DC-002 again.
 */
export function getNextDraftCrateId(draftCrates) {
  const existing = new Set(
    (draftCrates || [])
      .map((c) => Number(c.id.replace('DC-', '')))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  let n = 1;
  while (existing.has(n)) n++;
  return `DC-${String(n).padStart(3, '0')}`;
}
