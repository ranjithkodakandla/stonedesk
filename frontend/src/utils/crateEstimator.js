/**
 * Frontend port of backend operational dimension helpers.
 * Mirrors island_cassette_dimensions_operational() and related logic in
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

// ─── Crate class determination ────────────────────────────────────────────────
// island_vertical: island tops only — never mixed with splashes or other categories
// kitchen_vertical: perimeter tops, range tops, their associated splashes
// vanity_vertical: vanity tops and their associated splashes
// misc: everything else

export function getCrateClass(bundle) {
  const cat = (bundle.category || '').toLowerCase();
  if (cat === 'island') return 'island_vertical';
  if (cat === 'perimeter' || cat === 'range') return 'kitchen_vertical';
  if (cat === 'vanity') return 'vanity_vertical';
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
    total_weight_kg: r1(Math.max(0, (bundle.total_weight_kg || 0) - splashWeight)),
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
    // Strip splash before weight-batching so island crate weights are accurate
    const bundles = cls === 'island_vertical'
      ? buckets[cls].map(stripSplashFromBundle)
      : buckets[cls];

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

const r1 = (n) => Math.round(n * 10) / 10;

// ─── Leaned cassette geometry ─────────────────────────────────────────────────
// Mirrors island_cassette_dimensions_operational() in Python (dimensions.py).
//
// Real operational model: slabs lean backward at ~15° from vertical inside an
// A-frame cassette. This changes which slab dimension drives each crate axis:
//
//   L (primary, fixed): max slab LONG edge  + end clearance
//   D (depth, dynamic): Σ thicknesses + foam separators + framing
//   H (lean-corrected): slab SHORT edge × cos(15°) + pallet + headroom
//
// The old "height = slab long edge" model produced 106"+–131"+ external heights —
// operationally impossible. The leaned model gives realistic 50–65" heights.

const LEAN_FACTOR      = 0.966;  // cos(15°) — 15° lean from vertical
const SEPARATOR_IN     = 0.75;   // foam separator per slab gap
const DEPTH_FRAME      = 4.0;    // total framing allowance on depth axis
const LENGTH_CLEARANCE = 2.0;    // internal end clearance (1" each end)
const END_FRAME        = 2.0;    // external end-board thickness (1" each end)
const PALLET_BASE      = 6.0;    // pallet / sled base height
const LEAN_HEADROOM    = 4.0;    // head clearance above leaned slabs
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
  const intL = r1(maxLongEdge + LENGTH_CLEARANCE);

  // D — cassette depth: grows with slab count and foam separators
  const intD = r1(stackDepth + Math.max(0, pieces.length - 1) * SEPARATOR_IN + DEPTH_FRAME);

  // H — height from leaned geometry: short edge projected at lean angle
  const intH = r1(maxShortEdge * LEAN_FACTOR + PALLET_BASE + LEAN_HEADROOM);

  return {
    internal_length: intL,                           // primary cassette length (L)
    internal_width:  intD,                           // cassette depth          (D)
    internal_height: intH,                           // operational height      (H)
    external_length: r1(intL + END_FRAME),            // + end boards
    external_width:  r1(intD + WALL_TIMBER * 2),      // + side walls
    external_height: r1(intH + HEIGHT_CAP_TBR + FORKLIFT_TINE),
  };
}

// Kept for any legacy callers; delegates to the leaned model.
export function estimateVerticalCassetteDimensions(pieces) {
  return estimateLeanedCassetteDimensions(pieces);
}

// ─── Operational warnings ────────────────────────────────────────────────────

export function generateCrateWarnings({ totalWeightKg, dimensions, categoryMix, bundleCount, islandSplashViolation = false, hadSplashStripped = false }) {
  const warnings = [];
  if (!bundleCount || totalWeightKg === 0) return warnings;

  if (islandSplashViolation) {
    warnings.push('Island crate contains splash pieces — island crates must contain only island tops.');
  }
  if (hadSplashStripped) {
    warnings.push('Splash pieces excluded from island crate — they remain unassigned in inventory.');
  }

  if (totalWeightKg < 300) {
    warnings.push('Underloaded — consider adding more bundles before shipping.');
  }
  if (totalWeightKg > 5000) {
    warnings.push(`Heavy load — ${Math.round(totalWeightKg).toLocaleString()} kg. Verify forklift capacity.`);
  }

  const cats = Object.keys(categoryMix || {}).filter((k) => (categoryMix[k] || 0) > 0);
  if (cats.length > 1) {
    // perimeter + range together is a valid kitchen crate — no warning
    const isKitchenMix = cats.length === 2 && cats.includes('perimeter') && cats.includes('range');
    if (!isKitchenMix) {
      warnings.push('Mixed-category crate — confirm operational grouping with site team.');
    }
  }

  // Cassette depth check (internal_width is the depth axis in the leaned model)
  if ((dimensions?.internal_width || 0) > 24) {
    warnings.push('Deep cassette — check slot clearance and load stability.');
  }

  // Island crates use a dedicated operational envelope — skip generic 90" height check
  const isIslandOnly = cats.length === 1 && cats[0] === 'island';
  if (!isIslandOnly && (dimensions?.external_height || 0) > 88) {
    warnings.push('Tall crate — verify container interior clearance (target < 90″).');
  }

  return warnings;
}

// ─── Draft crate builder ─────────────────────────────────────────────────────

export function buildDraftCrate(id, selectedBundles) {
  const allPieces     = selectedBundles.flatMap((b) => b.pieces || []);
  const totalWeightKg = r1(selectedBundles.reduce((s, b) => s + (b.total_weight_kg || 0), 0));
  const totalSqft     = r1(selectedBundles.reduce((s, b) => s + (b.total_sqft     || 0), 0));
  const partCount     = selectedBundles.reduce((s, b) => s + (b.part_count || 0), 0);
  const categoryMix   = selectedBundles.reduce((acc, b) => {
    acc[b.category] = (acc[b.category] || 0) + 1;
    return acc;
  }, {});

  // Island isolation: detect any residual splash (can occur via manual "Add to…")
  const cats = Object.keys(categoryMix).filter((k) => (categoryMix[k] || 0) > 0);
  const isIslandOnly = cats.length === 1 && cats[0] === 'island';
  const islandSplashViolation = isIslandOnly && selectedBundles.some((b) => (b.splash_count || 0) > 0);
  const hadSplashStripped     = selectedBundles.some((b) => (b.splash_stripped || 0) > 0);

  const dimensions = estimateLeanedCassetteDimensions(allPieces);
  const warnings   = generateCrateWarnings({
    totalWeightKg,
    dimensions,
    categoryMix,
    bundleCount:          selectedBundles.length,
    islandSplashViolation,
    hadSplashStripped,
  });

  return {
    id,
    bundles:                 [...selectedBundles],
    bundle_count:            selectedBundles.length,
    part_count:              partCount,
    total_weight_kg:         totalWeightKg,
    total_sqft:              totalSqft,
    category_mix:            categoryMix,
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
  const cats = Object.keys(crate.category_mix || {}).filter((k) => (crate.category_mix[k] || 0) > 0);
  if (w > 2200) return 'OVERWEIGHT';
  // perimeter + range together is a valid kitchen crate — not a review flag
  const isKitchenMix = cats.length === 2 && cats.includes('perimeter') && cats.includes('range');
  if (cats.length > 1 && !isKitchenMix) return 'REVIEW';
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
      .map((c) => parseInt(c.id.replace('DC-', ''), 10))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  let n = 1;
  while (existing.has(n)) n++;
  return `DC-${String(n).padStart(3, '0')}`;
}
