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

function parseThicknessIn(t) {
  if (!t) return 1.18; // default 3CM
  const key = String(t).trim().toUpperCase().replace(' ', '');
  if (THICKNESS_INCH[key] != null) return THICKNESS_INCH[key];
  if (THICKNESS_INCH[String(t).trim()] != null) return THICKNESS_INCH[String(t).trim()];
  const n = parseFloat(t);
  return isNaN(n) ? 1.18 : n;
}

const r1 = (n) => Math.round(n * 10) / 10;

// ─── Vertical cassette dimensions ────────────────────────────────────────────
// Mirrors island_cassette_dimensions_operational() in Python.
// Used for both Island (A-type) and Kitchen (B-type vertical cassette).
//
// Geometry:
//   Depth  = accumulated slab thicknesses + framing
//   Width  = widest short-edge + allowance
//   Height = tallest long-edge + base support + head clearance

export function estimateVerticalCassetteDimensions(pieces) {
  if (!pieces || pieces.length === 0) {
    return {
      internal_length: 0, internal_width: 0, internal_height: 0,
      external_length: 0, external_width: 0, external_height: 0,
    };
  }

  let stackDepth = 0;
  let maxLongEdge = 0;
  let maxShortEdge = 0;

  for (const p of pieces) {
    const t = parseThicknessIn(p.thickness);
    const L = parseFloat(p.length) || 0;
    const W = parseFloat(p.width) || 0;
    const longE  = Math.max(L, W);
    const shortE = L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W);
    stackDepth  += t;
    maxLongEdge  = Math.max(maxLongEdge,  longE);
    maxShortEdge = Math.max(maxShortEdge, shortE);
  }

  const FRAMING       = 4.0;  // light internal framing depth
  const BASE_SUPPORT  = 2.0;  // pallet / sled base
  const TOP_CLEARANCE = 6.0;  // internal head clearance
  const WALL          = 3.0;  // structural timber wall (each side)
  const HEIGHT_TOP    = 6.0;  // top cap timber
  const FORKLIFT      = 7.0;  // forklift tine clearance on external height

  const intL = r1(Math.min(92.0, stackDepth + FRAMING));
  const intW = r1(maxShortEdge + 6.0);
  const intH = r1(maxLongEdge  + BASE_SUPPORT + TOP_CLEARANCE);

  return {
    internal_length: intL,
    internal_width:  intW,
    internal_height: intH,
    external_length: r1(intL + WALL),
    external_width:  r1(intW + WALL),
    external_height: r1(intH + HEIGHT_TOP + FORKLIFT),
  };
}

// ─── Operational warnings ────────────────────────────────────────────────────

export function generateCrateWarnings({ totalWeightKg, dimensions, categoryMix, bundleCount }) {
  const warnings = [];
  if (!bundleCount || totalWeightKg === 0) return warnings;

  if (totalWeightKg < 300) {
    warnings.push('Underloaded — consider adding more bundles before shipping.');
  }
  if (totalWeightKg > 5000) {
    warnings.push(`Heavy load — ${Math.round(totalWeightKg).toLocaleString()} kg. Verify forklift capacity.`);
  }

  const cats = Object.keys(categoryMix || {}).filter((k) => (categoryMix[k] || 0) > 0);
  if (cats.length > 1) {
    warnings.push('Mixed-category crate — confirm operational grouping with site team.');
  }

  if ((dimensions?.internal_length || 0) > 24) {
    warnings.push('Deep cassette — check slot clearance and load stability.');
  }
  if ((dimensions?.external_height || 0) > 88) {
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

  const dimensions = estimateVerticalCassetteDimensions(allPieces);
  const warnings   = generateCrateWarnings({
    totalWeightKg,
    dimensions,
    categoryMix,
    bundleCount: selectedBundles.length,
  });

  return {
    id,
    bundles:          [...selectedBundles],
    bundle_count:     selectedBundles.length,
    part_count:       partCount,
    total_weight_kg:  totalWeightKg,
    total_sqft:       totalSqft,
    category_mix:     categoryMix,
    dimensions,
    warnings,
    created_at:       Date.now(),
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
 * Priority: OVERWEIGHT > REVIEW > UNDERLOADED > READY
 */
export function getCrateOperationalStatus(crate) {
  const w = crate.total_weight_kg || 0;
  const cats = Object.keys(crate.category_mix || {}).filter((k) => (crate.category_mix[k] || 0) > 0);
  if (w > 2200) return 'OVERWEIGHT';
  if (cats.length > 1) return 'REVIEW';
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
