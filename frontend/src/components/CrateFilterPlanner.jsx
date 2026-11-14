import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';
import { weightBatchParts, rebalanceBatchesEvenly } from '../utils/crateEstimator';
import { thicknessInchesFromLabel } from '../utils/thicknessConstants';
import {
  groupPiecesIntoRows, rowRawLength,
  CRATE_INTERNAL_WIDTH_MIN_IN, CRATE_INTERNAL_WIDTH_MAX_IN,
} from '../utils/rowPacking';
import MultiSelectDropdown from './MultiSelectDropdown';
import TargetWeightControl from './TargetWeightControl';

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FILTER_DIMS = [
  { key: 'buildings', field: 'building', label: 'Building' },
  { key: 'pods', field: 'pod', label: 'POD' },
  { key: 'floors', field: 'floor', label: 'Floor' },
  { key: 'lengths', field: 'length', label: 'Length (in)' },
  { key: 'widths', field: 'width', label: 'Width / Depth (in)' },
  { key: 'qtys', field: 'qty', label: 'Qty' },
  { key: 'thicknesses', field: 'thickness', label: 'Thickness' },
  { key: 'categories', field: 'category', label: 'Category' },
  { key: 'partTypes', field: 'part', label: 'Part Type' },
  { key: 'drawings', field: 'drawing', label: 'Drawing' },
  { key: 'units', field: 'unit', label: 'Unit' },
];

export const EMPTY_FILTERS = FILTER_DIMS.reduce((acc, d) => ({ ...acc, [d.key]: [] }), {});
const FILTER_DIMS_BY_KEY = Object.fromEntries(FILTER_DIMS.map((d) => [d.key, d]));

// Pool table columns, left to right — Excel-style: filterable columns carry a
// small ▾ arrow right in the header, exactly where a spreadsheet AutoFilter puts it.
const POOL_COLUMNS = [
  { field: 'drawing', label: 'Drawing', filterKey: 'drawings' },
  { field: 'unit', label: 'Unit', filterKey: 'units' },
  { field: 'part', label: 'Part Type', filterKey: 'partTypes' },
  { field: 'category', label: 'Category', filterKey: 'categories' },
  { field: 'part_no', label: 'Part #' },
  { field: 'building', label: 'Building', filterKey: 'buildings' },
  { field: 'pod', label: 'POD', filterKey: 'pods' },
  { field: 'floor', label: 'Floor', filterKey: 'floors' },
  { field: 'length', label: 'Length (in)', filterKey: 'lengths', numeric: true },
  { field: 'width', label: 'Width (in)', filterKey: 'widths', numeric: true },
  { field: 'qty', label: 'Qty', filterKey: 'qtys', numeric: true },
  { field: 'thickness', label: 'Thickness', filterKey: 'thicknesses' },
  { field: 'sqft', label: 'Sq Ft', numeric: true },
  { field: 'weight_kg', label: 'Weight (kg)', numeric: true },
];

function partMatchesFilters(part, filters, exceptKey) {
  return FILTER_DIMS.every((d) => {
    if (d.key === exceptKey) return true;
    const sel = filters[d.key];
    if (!sel.length) return true;
    return sel.includes(String(part[d.field]));
  });
}

// After parts get allocated into a crate, the filters that just matched them
// can leave the pool showing nothing — not because the user wants an empty
// view, but because every part that combination matched is now gone. Instead
// of wiping all filters back to empty, drop them one at a time (most
// recently touched first, per filterOrder) until the remaining pool has
// something to show, stopping at the very first filter removal that works.
export function relaxFiltersUntilNonEmpty(currentFilters, filterOrder, pool) {
  const hasMatch = (f) => pool.some((p) => partMatchesFilters(p, f, null));
  if (hasMatch(currentFilters)) return currentFilters;

  let next = currentFilters;
  const seen = new Set();
  for (let i = filterOrder.length - 1; i >= 0; i -= 1) {
    const key = filterOrder[i];
    if (seen.has(key)) continue;
    seen.add(key);
    if (!next[key] || !next[key].length) continue; // already inactive
    next = { ...next, [key]: [] };
    if (hasMatch(next)) return next;
  }
  // Order didn't cover every active filter (e.g. set via some other path) —
  // fall back to clearing whatever's left, one dimension at a time.
  for (const d of FILTER_DIMS) {
    if (seen.has(d.key)) continue;
    if (!next[d.key] || !next[d.key].length) continue;
    next = { ...next, [d.key]: [] };
    if (hasMatch(next)) return next;
  }
  return next;
}

// Cascading facet options: for a given dimension, compute distinct values (with
// how many parts each matches) from parts that match every OTHER active filter
// (classic Excel AutoFilter behavior) — the counts make the narrowing visible as
// other filters are applied, instead of just shrinking the list silently.
function facetOptions(parts, filters, dim) {
  const counts = new Map();
  for (const p of parts) {
    if (!partMatchesFilters(p, filters, dim.key)) continue;
    const v = String(p[dim.field]);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
    })
    .map((value) => ({ value, count: counts.get(value) }));
}

// ─── Category bucket ordering ─────────────────────────────────────────────────
// Kitchen Islands fill first, then remaining Kitchen (perimeter/range/splash),
// then Vanity, then everything else — mirrors dispatch-order used elsewhere
// (backend _PART_TYPE_TO_BUCKET) so auto-bucketing never interleaves categories.
const PART_TYPE_TO_BUCKET_ORDER = {
  'Kitchen - Island Tops': 0,
  'Kitchen - Perimeter Tops': 1,
  'Kitchen - Range Tops': 1,
  'Kitchen - Back Splash': 1,
  'Kitchen - Side Splash': 1,
  'Vanity - Top': 2,
  'Vanity - Back Splash': 2,
  'Vanity - Side Splash': 2,
  'Misc - Full Height Splash': 3,
  'Misc - Window Sill': 3,
  'Misc - Bar Top': 3,
};
const CATEGORY_TO_BUCKET_ORDER = { island: 0, perimeter: 1, range: 1, vanity: 2, misc: 3 };

function bucketOrderForPart(part) {
  // A non-primary island companion piece (see findNonPrimaryIslandPartIds)
  // carries this override so every downstream consumer of bucket order —
  // partitioning, batching, and computeCrateDimensions' own isIsland check —
  // sees it as a kitchen piece, not an island one, without needing to know
  // about the override separately.
  if (part._crateBucketOverride != null) return part._crateBucketOverride;
  const byType = PART_TYPE_TO_BUCKET_ORDER[String(part.part || '').trim()];
  if (byType != null) return byType;
  return CATEGORY_TO_BUCKET_ORDER[String(part.category || '').toLowerCase()] ?? 3;
}

// ─── Location-aware, class-isolated weight batching ───────────────────────────
// The factory floor never lets one crate span two buildings, and never mixes
// crate classes (an island crate is only island tops). weightBatchParts() on
// its own only enforces the weight cap — fed a flat list it can still bridge
// across a class or building boundary right where the cap happens to land.
// A "Kitchen - Island Tops" drawing can carry more than one piece for the
// same flat — the full-size slab plus one or more small companion pieces
// (e.g. a short return) that share the exact same part type tag. The
// fabrication floor only treats the slab as an island; the companion pieces
// travel with that flat's other kitchen pieces (perimeter/splash) instead.
// There's no universal size cutoff that identifies "small" across every
// project, so this isn't a fixed-inch threshold — within each (drawing,
// building, floor, flat) family of Island-Tops-tagged pieces, only the piece
// with the largest footprint stays classified as the island; every other
// same-tagged piece in that family is demoted to the kitchen bucket. A
// family with only one Island-Tops piece is never affected.
function islandFamilyKey(part) {
  return `${part.drawing ?? ''}||${part.building ?? ''}||${part.floor ?? ''}||${part.flat ?? ''}`;
}

// Returns a new array: every part is passed through unchanged except
// non-primary island companion pieces, which get a shallow clone carrying
// `_crateBucketOverride: 1` (kitchen bucket). The clone keeps its real
// `part`/`category` fields as-is — only how it's bucketed for crating
// changes, not what it displays as. Clones mean this never mutates the
// pool arrays the rest of the screen (filters, the pieces table) reads from.
export function withIslandFamilyOverrides(parts) {
  const families = new Map();
  for (const part of parts) {
    if (bucketOrderForPart(part) !== 0) continue; // only Island-Tops-tagged pieces
    const key = islandFamilyKey(part);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(part);
  }
  const demoted = new Set();
  for (const family of families.values()) {
    if (family.length < 2) continue;
    let primary = family[0];
    let primaryArea = (primary.length || 0) * (primary.width || 0);
    for (const part of family) {
      const area = (part.length || 0) * (part.width || 0);
      if (area > primaryArea) { primary = part; primaryArea = area; }
    }
    for (const part of family) {
      if (part !== primary) demoted.add(part.id);
    }
  }
  if (!demoted.size) return parts;
  return parts.map((part) => (demoted.has(part.id) ? { ...part, _crateBucketOverride: 1 } : part));
}

// Partition by (class, building) first, batch within each partition, so every
// resulting crate is single-class and single-building like the manual plan.
// Expects parts whose island-companion overrides were already decided
// against the full pool (see withIslandFamilyOverrides) — annotating here
// against whatever subset is passed in would be unsafe, since a filtered
// subset can be missing a family's primary piece.
export function partitionPartsByClassAndBuilding(parts) {
  const annotated = withIslandFamilyOverrides(parts);
  const byClass = new Map();
  for (const part of annotated) {
    const cls = bucketOrderForPart(part);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(part);
  }
  const partitions = []; // { crateClassOrder, building, parts }
  for (const [cls, clsParts] of byClass) {
    const byBuilding = new Map();
    for (const part of clsParts) {
      const b = String(part.building ?? '').trim() || '(no building)';
      if (!byBuilding.has(b)) byBuilding.set(b, []);
      byBuilding.get(b).push(part);
    }
    for (const [building, buildingParts] of byBuilding) {
      partitions.push({ crateClassOrder: cls, building, parts: buildingParts });
    }
  }
  return partitions;
}

// Islands stack thickness directly into crate WIDTH with no row-packing (see
// computeCrateDimensions' isIsland branch) — weightBatchParts alone can still
// hand it a batch whose summed thickness blows past the 26" structural
// maximum. Cap on stack depth (thickness × qty) as well as weight so an
// island batch never needs to be re-split after the fact.
export function islandBatchParts(parts, targetWeightKg, widthMarginTotal, overageTolerance = 0) {
  if (!parts.length) return [];
  const weightCap = targetWeightKg * (1 + overageTolerance);
  const widthCap = Math.max(0, CRATE_INTERNAL_WIDTH_MAX_IN - widthMarginTotal);
  const batches = [];
  let current = [];
  let currentWeight = 0;
  let currentStackDepth = 0;

  for (const part of parts) {
    const w = part.weight_kg || 0;
    const td = thicknessInches(part.thickness) * (part.qty || 1);
    const nextWeight = currentWeight + w;
    const nextStack = currentStackDepth + td;
    if (current.length > 0 && (nextWeight > weightCap || nextStack > widthCap)) {
      batches.push(current);
      current = [part];
      currentWeight = w;
      currentStackDepth = td;
    } else {
      current.push(part);
      currentWeight = nextWeight;
      currentStackDepth = nextStack;
    }
  }
  if (current.length) batches.push(current);
  // Spread evenly across however many crates the weight/width cap requires
  // instead of packing every crate to the brim and leaving a small leftover
  // (e.g. 36 pieces at a 10-per-crate cap becomes four crates of 9, not
  // 10+10+10+6) — see rebalanceBatchesEvenly. Falls back to the greedy
  // result if an even split would itself breach either cap.
  const balanced = rebalanceBatchesEvenly(parts, batches.length, (group) => {
    const w = group.reduce((s, p) => s + (p.weight_kg || 0), 0);
    const td = group.reduce((s, p) => s + thicknessInches(p.thickness) * (p.qty || 1), 0);
    return w <= weightCap && td <= widthCap;
  });
  return balanced || batches;
}

// ─── Crate dimension configuration ────────────────────────────────────────────
// Editable by the employee before auto-bucketing, fully independent per crate
// class (Vanity/Kitchen vs Islands) — nothing is shared between the two.
// internal = raw part extents + margin (length/width each side, height total);
// external = internal + that class's own add-on for length/width, plus that
// class's own fixed external height.
const DEFAULT_CLASS_DIM_CONFIG = {
  lengthMargin: 0.5,
  widthMargin: 0.5,
  heightMargin: 2,
  extLengthAdd: 4,
  extWidthAdd: 4,
  extHeight: 7,
};

export const DEFAULT_DIM_CONFIG = {
  kv: { ...DEFAULT_CLASS_DIM_CONFIG },
  island: { ...DEFAULT_CLASS_DIM_CONFIG, extHeight: 9 },
};

const thicknessInches = thicknessInchesFromLabel;

// Mirrors estimateHorizontalLayeredDimensions() in crateEstimator.js — the
// established packing model: bigger parts (tops) form one layer, back
// splashes another, side splashes another, stacked with a separator between
// each. A layer's height is its MAX piece thickness, not the sum of every
// piece in it — same-role parts sit side by side in the layer, not stacked
// on each other.
const LAYER_SEPARATOR_IN = 1.0;
function isBackSplashPart(p) {
  return /back.?splash/i.test(p.part || '');
}
function isSideSplashPart(p) {
  return /side.?splash/i.test(p.part || '');
}

export function computeCrateDimensions(parts, dimConfig) {
  if (!parts.length) {
    return { internal_length: 0, internal_width: 0, internal_height: 0, external_length: 0, external_width: 0, external_height: 0, warnings: [] };
  }

  const isIsland = parts.some((p) => bucketOrderForPart(p) === 0);
  const cfg = isIsland ? dimConfig.island : dimConfig.kv;

  if (isIsland) {
    // Islands stand upright (cassette model) — a completely different axis
    // assignment than flat-lay kitchen/vanity crates: the piece's SHORT edge
    // becomes the crate's HEIGHT (it's standing on end), and thickness stacks
    // on the WIDTH/DEPTH axis (pieces lean side by side like books on a
    // shelf), not on height. Mirrors estimateLeanedCassetteDimensions() in
    // crateEstimator.js.
    let maxLongEdge = 0;
    let maxShortEdge = 0;
    for (const p of parts) {
      const L = p.length || 0;
      const W = p.width || 0;
      maxLongEdge = Math.max(maxLongEdge, Math.max(L, W));
      maxShortEdge = Math.max(maxShortEdge, L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W));
    }
    const stackDepth = parts.reduce((s, p) => s + thicknessInches(p.thickness) * (p.qty || 1), 0);

    const internal_length = maxLongEdge + cfg.lengthMargin * 2;
    const internal_width = stackDepth + cfg.widthMargin * 2;
    const internal_height = maxShortEdge + cfg.heightMargin;

    return {
      internal_length,
      internal_width,
      internal_height,
      external_length: internal_length + cfg.extLengthAdd,
      external_width: internal_width + cfg.extWidthAdd,
      external_height: internal_height + cfg.extHeight,
      warnings: [],
    };
  }

  // Kitchen/Vanity/Perimeter/Range — pieces stand upright on their short
  // edge (the "standing height"), leaning side by side; thickness stacks
  // into the crate's WIDTH axis via "rows" (a thickness-slot that can hold
  // more than one piece end to end — see rowPacking.js, which mirrors
  // backend group_main_pieces_into_rows()/horizontal_crate_dimensions()
  // exactly). This replaced a flat-stack model that took Math.max() of
  // thicknesses (as if only one piece's worth of material existed
  // regardless of how many were actually selected) and used a piece's own
  // face-width as the crate's width — the literal "generic bounding box,
  // oblivious to piece count" problem.
  const backSplash = parts.filter(isBackSplashPart);
  const sideSplash = parts.filter(isSideSplashPart);
  const mainTops = parts.filter((p) => !isBackSplashPart(p) && !isSideSplashPart(p));
  const rowSource = mainTops.length ? mainTops : parts;

  const maxSingleLong = Math.max(...parts.map((p) => Math.max(p.length || 0, p.width || 0)));
  const rowWidth = (rws) => rws.reduce((s, row) => s + Math.max(...row.map((p) => thicknessInches(p.thickness))), 0);

  // Pairs matching-length pieces into a shared row (never more than
  // MAX_PIECES_PER_ROW), with any already-identified filler/companion piece
  // (see withIslandFamilyOverrides) used to top off a pair before it's ever
  // paired with its own kind. Confirmed specifically for "side top"/"range
  // top" (kitchen/perimeter) crates against the real packing list (8
  // crates, 336 physical rows, zero exceptions) — see rowPacking.js.
  // Vanity crates do NOT follow this convention: the same real packing
  // list shows every single Vanity row holding exactly one piece (checked
  // across all 90 rows of a full Vanity crate, zero exceptions) — no
  // pairing, no filler-topping. Misc has no confirming data either way, so
  // it defaults to the same safe one-piece-per-row behavior as Vanity
  // rather than assuming the kitchen/perimeter convention applies there too.
  const usesRowPairing = parts.some((p) => bucketOrderForPart(p) === 1);
  const rows = !rowSource.length ? [] : (usesRowPairing ? groupPiecesIntoRows(rowSource) : rowSource.map((p) => [p]));
  const rowThicknessSum = rowWidth(rows);
  const widthWarnings = [];
  if (rowSource.length && rowThicknessSum + cfg.widthMargin * 2 > CRATE_INTERNAL_WIDTH_MAX_IN) {
    widthWarnings.push(
      `Crate width ${(rowThicknessSum + cfg.widthMargin * 2).toFixed(1)}" exceeds the ` +
      `${CRATE_INTERNAL_WIDTH_MAX_IN}" maximum — needs manual review.`
    );
  }
  const longestRowRaw = rows.length ? Math.max(...rows.map((r) => rowRawLength(r))) : 0;

  const heightRef = mainTops.length ? mainTops : parts;
  const standingHeight = heightRef.length
    ? Math.max(...heightRef.map((p) => {
        const L = p.length || 0;
        const W = p.width || 0;
        return L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W);
      }))
    : 0;
  // Splash height contribution is the splash piece's own physical stacking
  // height (its "width" field — e.g. a 4"-tall back splash), not its
  // material thickness — matches the fabricator's reference packing sheets.
  const backH = backSplash.length ? Math.max(...backSplash.map((p) => p.width || 0)) : 0;
  const sideH = sideSplash.length ? Math.max(...sideSplash.map((p) => p.width || 0)) : 0;

  let stackedHeight = standingHeight;
  if (backH > 0) stackedHeight += LAYER_SEPARATOR_IN + backH;
  if (sideH > 0) stackedHeight += LAYER_SEPARATOR_IN + sideH;

  const internal_length = Math.max(maxSingleLong, longestRowRaw) + cfg.lengthMargin * 2;
  // Flat clearance, no per-row foam separator — matches the fabricator's
  // reference packing sheets (Stone Width + 1" clearance), not a per-row
  // foam-gap model.
  const rawWidth = rows.length
    ? rowThicknessSum + cfg.widthMargin * 2
    : cfg.widthMargin * 2;
  // Floor only — padding a too-narrow result up to 10" is always safe. No
  // ceiling clamp: if the length-for-width trade above couldn't bring width
  // at/under 26", silently reporting 26" would understate the crate's true
  // physical size instead of flagging it (see widthWarnings).
  const internal_width = Math.max(CRATE_INTERNAL_WIDTH_MIN_IN, rawWidth);
  const internal_height = stackedHeight + cfg.heightMargin;

  return {
    internal_length,
    internal_width,
    internal_height,
    external_length: internal_length + cfg.extLengthAdd,
    external_width: internal_width + cfg.extWidthAdd,
    external_height: internal_height + cfg.extHeight,
    warnings: widthWarnings,
  };
}

// Layer # / Row # exactly mirrors the fabricator's own packing-list
// convention (e.g. Excel's "Layer # 1 Row -3"): an island crate is one
// layer with each piece in its own row; a kitchen/vanity/misc crate splits
// into up to 3 layers in this order — main tops, back splash, side splash —
// each with its own row numbering 1..N, using the same row-pairing rule
// computeCrateDimensions uses for its width calc. Purely a placement label
// for the crate detail view and Excel export; it has no effect on any
// computed dimension.
export function assignLayersAndRows(parts) {
  const byId = new Map();
  if (!parts.length) return byId;

  const isIsland = parts.some((p) => bucketOrderForPart(p) === 0);
  if (isIsland) {
    parts.forEach((p, i) => byId.set(p.id, { layer: 1, row: i + 1 }));
    return byId;
  }

  const backSplash = parts.filter(isBackSplashPart);
  const sideSplash = parts.filter(isSideSplashPart);
  const mainTops = parts.filter((p) => !isBackSplashPart(p) && !isSideSplashPart(p));
  const usesRowPairing = parts.some((p) => bucketOrderForPart(p) === 1);
  const rowsOf = (group) => (!group.length ? [] : (usesRowPairing ? groupPiecesIntoRows(group) : group.map((p) => [p])));

  let layerNum = 1;
  for (const group of [mainTops, backSplash, sideSplash]) {
    if (!group.length) continue;
    rowsOf(group).forEach((row, ri) => {
      row.forEach((p) => byId.set(p.id, { layer: layerNum, row: ri + 1 }));
    });
    layerNum += 1;
  }
  return byId;
}

const DIM_CLASS_SECTIONS = [
  { key: 'kv', label: 'Vanity / Kitchen' },
  { key: 'island', label: 'Islands' },
];

const DIM_CLASS_FIELDS = [
  { key: 'lengthMargin', label: 'Length — internal margin/side (in)' },
  { key: 'extLengthAdd', label: 'Length — external add (in)' },
  { key: 'widthMargin', label: 'Width — internal margin/side (in)' },
  { key: 'extWidthAdd', label: 'Width — external add (in)' },
  { key: 'heightMargin', label: 'Height — internal margin (in)' },
  { key: 'extHeight', label: 'Height — external add (in)' },
];

const TABLE_COLUMNS = [
  { key: 'drawing', label: 'Drawing' },
  { key: 'unit', label: 'Unit' },
  { key: 'part', label: 'Part Type' },
  { key: 'category', label: 'Category' },
  { key: 'part_no', label: 'Part #' },
  { key: 'building', label: 'Building' },
  { key: 'pod', label: 'POD' },
  { key: 'floor', label: 'Floor' },
  { key: 'flat', label: 'Flat' },
  { key: 'length', label: 'Length (in)', numeric: true },
  { key: 'width', label: 'Width (in)', numeric: true },
  { key: 'thickness', label: 'Thickness' },
  { key: 'qty', label: 'Qty', numeric: true },
  { key: 'sqft', label: 'Sq Ft', numeric: true },
  { key: 'weight_kg', label: 'Weight (kg)', numeric: true },
  { key: 'layer', label: 'Layer' },
  { key: 'row', label: 'Row' },
];

function crateFromParts(crateNo, parts, dimConfig) {
  const layerRowById = assignLayersAndRows(parts);
  const decoratedParts = parts.map((p) => {
    const lr = layerRowById.get(p.id);
    return { ...p, layer: lr ? lr.layer : null, row: lr ? lr.row : null };
  });
  return {
    crate_no: crateNo,
    parts: decoratedParts,
    total_weight_kg: parts.reduce((s, p) => s + (p.weight_kg || 0), 0),
    total_sqft: parts.reduce((s, p) => s + (p.sqft || 0), 0),
    ...computeCrateDimensions(parts, dimConfig),
  };
}

const CRATE_SUMMARY_COLUMNS = [
  { key: 'crate_no', label: 'Crate #' },
  { key: 'parts', label: 'Parts', numeric: true },
  { key: 'total_weight_kg', label: 'Weight (kg)', numeric: true },
  { key: 'total_sqft', label: 'Sq Ft', numeric: true },
  { key: 'internal_size', label: 'Internal Size (L×W×H)', numeric: true },
  { key: 'external_size', label: 'External Size (L×W×H)', numeric: true },
];

function sizeLWH(l, w, h) {
  return `${fmt(l)}×${fmt(w)}×${fmt(h)}″`;
}

// Excel-style summary — one row per crate, inline-scrolled (the container, not
// the page, scrolls), with View/Delete as inline links per row.
function CrateSummaryTable({ crates, onViewDetails, onDeleteCrate }) {
  return (
    <div className="rounded-[20px] border border-[#dbe4f0] bg-white overflow-hidden">
      <div className="max-h-[520px] overflow-y-auto overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#f8fafc] text-[#64748b] uppercase tracking-wide text-[10px]">
              {CRATE_SUMMARY_COLUMNS.map((c) => (
                <th key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-left whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {crates.map((c) => (
              <tr key={c.crate_no} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                <td className="px-3 py-2 whitespace-nowrap font-semibold text-[#0f172a]">
                  #{c.crate_no}
                  {c.warnings?.length > 0 && (
                    <span className="ml-1.5 text-amber-600" title={c.warnings.join(' ')}>⚠</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#334155]">{c.parts.length}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-[#1e293b]">{fmt(c.total_weight_kg)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#334155]">{fmt(c.total_sqft)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{sizeLWH(c.internal_length, c.internal_width, c.internal_height)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{sizeLWH(c.external_length, c.external_width, c.external_height)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onViewDetails(c.crate_no)}
                    className="text-[#1d4ed8] font-medium hover:underline"
                  >
                    View details
                  </button>
                  <span className="mx-2 text-[#e2e8f0]">|</span>
                  <button
                    type="button"
                    onClick={() => onDeleteCrate(c.crate_no)}
                    className="text-red-600 font-medium hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Compact Excel-style column header filter — click the funnel to check/uncheck
// values; empty selection = show all (same convention as MultiSelectDropdown).
function ColumnFilterMenu({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const isAll = selected.length === 0;
  const active = !isAll;

  return (
    <span className="relative inline-block ml-1" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] ${active ? 'text-[#1d4ed8]' : 'text-[#94a3b8]'} hover:text-[#1d4ed8]`}
        title="Filter"
      >
        ▾
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-48 max-h-64 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg flex flex-col normal-case font-normal text-[11px]">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#f1f5f9]">
            <button type="button" className="text-blue-600 font-semibold" onClick={() => onChange([])}>All</button>
            <button
              type="button"
              className="text-[#94a3b8] font-semibold"
              onClick={() => onChange(options.length ? [`__nomatch__${Math.random()}`] : [])}
            >
              Clear
            </button>
          </div>
          <div className="overflow-y-auto p-1">
            {options.map((opt) => {
              const checked = isAll || selected.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#f8fafc] cursor-pointer text-[#334155]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (isAll) onChange(options.filter((o) => o !== opt));
                      else if (selected.includes(opt)) {
                        const next = selected.filter((v) => v !== opt);
                        onChange(next.length ? next : []);
                      } else onChange([...selected, opt]);
                    }}
                    className="rounded border-[#cbd5e1]"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

// Part-detail modal for a single crate — opened via "View details" in the
// summary table above. Each column header has an Excel-style filter.
function CrateDetailModal({ crate, crateOptions, onMovePart, onClose }) {
  const [columnFilters, setColumnFilters] = useState({});

  // Reset filters whenever a different crate is opened.
  useEffect(() => { setColumnFilters({}); }, [crate?.crate_no]);

  const matchesColumnFilters = useCallback((part, exceptKey) => {
    return TABLE_COLUMNS.every((c) => {
      if (c.key === exceptKey) return true;
      const sel = columnFilters[c.key] || [];
      if (!sel.length) return true;
      return sel.includes(String(part[c.key] ?? ''));
    });
  }, [columnFilters]);

  const columnOptions = useMemo(() => {
    if (!crate) return {};
    const out = {};
    for (const c of TABLE_COLUMNS) {
      const values = new Set();
      for (const p of crate.parts) {
        if (matchesColumnFilters(p, c.key)) values.add(String(p[c.key] ?? ''));
      }
      out[c.key] = [...values].sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
      });
    }
    return out;
  }, [crate, matchesColumnFilters]);

  const filteredParts = useMemo(
    () => (crate ? crate.parts.filter((p) => matchesColumnFilters(p, null)) : []),
    [crate, matchesColumnFilters],
  );

  if (!crate) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[85vh] rounded-[20px] bg-white shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 px-5 py-4 border-b border-[#f1f5f9] flex-wrap">
          <span className="text-sm font-bold text-[#0f172a]">Crate #{crate.crate_no}</span>
          <span className="text-xs text-[#64748b]">
            {filteredParts.length === crate.parts.length ? `${crate.parts.length} parts` : `${filteredParts.length} of ${crate.parts.length} parts`}
          </span>
          <span className="text-sm font-semibold text-[#1e293b]">{fmt(crate.total_weight_kg)} kg</span>
          <span className="text-xs text-[#94a3b8]">{fmt(crate.total_sqft)} ft²</span>
          <span className="text-xs text-[#94a3b8]">
            Int (L×W×H) {fmt(crate.internal_length)}×{fmt(crate.internal_width)}×{fmt(crate.internal_height)}″
          </span>
          <span className="text-xs text-[#94a3b8]">
            Ext (L×W×H) {fmt(crate.external_length)}×{fmt(crate.external_width)}×{fmt(crate.external_height)}″
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-medium text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto overflow-x-auto flex-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f8fafc] text-[#64748b] uppercase tracking-wide text-[9px]">
                {TABLE_COLUMNS.map((c) => {
                  const isFiltered = (columnFilters[c.key] || []).length > 0;
                  return (
                    <th
                      key={c.key}
                      className={`px-3 py-2 whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'} ${isFiltered ? 'bg-[#dbeafe] text-[#1d4ed8]' : ''}`}
                      title={isFiltered ? 'Filter active on this column' : undefined}
                    >
                      {c.label}
                      <ColumnFilterMenu
                        options={columnOptions[c.key] || []}
                        selected={columnFilters[c.key] || []}
                        onChange={(vals) => setColumnFilters((f) => ({ ...f, [c.key]: vals }))}
                      />
                    </th>
                  );
                })}
                <th className="px-3 py-2 text-left whitespace-nowrap">Move to</th>
              </tr>
            </thead>
            <tbody>
              {filteredParts.map((p) => (
                <tr key={p.id} className="border-t border-[#f8fafc] hover:bg-[#f8fafc]">
                  {TABLE_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap text-[#334155] ${c.numeric ? 'text-right font-medium' : ''}`}>
                      {c.numeric ? fmt(p[c.key]) : (p[c.key] || '—')}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onMovePart(p.id, crate.crate_no, e.target.value);
                        e.target.value = '';
                      }}
                      className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[11px] text-[#475569]"
                    >
                      <option value="" disabled>Move…</option>
                      {crateOptions.filter((cn) => cn !== crate.crate_no).map((cn) => (
                        <option key={cn} value={cn}>Crate #{cn}</option>
                      ))}
                      <option value="__new__">+ New crate</option>
                      <option value="__remove__">↩ Remove (back to pool)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const CrateFilterPlanner = ({ projectId }) => {
  const [allParts, setAllParts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [targetWeightKg, setTargetWeightKg] = useState(1900);
  const [dimConfig, setDimConfig] = useState(DEFAULT_DIM_CONFIG);
  const [selectCount, setSelectCount] = useState(''); // "# pieces to select" cap on the filtered pool
  const [selectedPartIds, setSelectedPartIds] = useState(() => new Set());
  const [suggestions, setSuggestions] = useState(null);
  const [manualCrateNo, setManualCrateNo] = useState(''); // user-editable crate # for the next manually-built crate

  // crates: array of { crate_no, parts: [...] } — local editable state.
  const [crates, setCrates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [detailCrateNo, setDetailCrateNo] = useState(null);
  // Process labels load incrementally — a small batch renders immediately,
  // more batches fetch as the user scrolls, instead of blocking on every
  // page for the whole (possibly thousands-of-parts) project up front.
  const LABEL_BATCH_SIZE = 30;
  const [generatingLabels, setGeneratingLabels] = useState(false);
  const [labelBatches, setLabelBatches] = useState([]); // [{ url, count }]
  const [labelsTotalParts, setLabelsTotalParts] = useState(0);
  const [loadingMoreLabels, setLoadingMoreLabels] = useState(false);
  const [exportingLabels, setExportingLabels] = useState(false);
  const [exportElapsedSec, setExportElapsedSec] = useState(0);

  // Revoke every batch blob URL when the component unmounts.
  useEffect(() => () => { labelBatches.forEach((b) => window.URL.revokeObjectURL(b.url)); }, [labelBatches]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    axios
      .get(`${API_BASE}/projects/${projectId}/dispatch-parts`)
      // Annotate island-companion overrides once, against the complete,
      // unfiltered pool — never against whatever subset happens to be
      // filtered/available at Auto-bucket time. The suggested workflow here
      // is to filter and bucket in multiple passes (islands, then kitchen,
      // then vanity); if a family's main slab is already allocated into an
      // earlier pass's crates by the time its companion pieces are batched,
      // the companions would see no sibling to compare against and could
      // wrongly stay classified as islands themselves.
      .then((res) => setAllParts(withIslandFamilyOverrides(res.data || [])))
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to load parts'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // A saved plan is offered, never applied silently — starting fresh must
  // actually mean fresh, not "whatever was saved last time" reappearing
  // without warning.
  const [savedPlanCandidate, setSavedPlanCandidate] = useState(null);

  useEffect(() => {
    if (!projectId || !allParts.length) return;
    axios
      .get(`${API_BASE}/projects/${projectId}/manual-crate-plan`)
      .then((res) => {
        const plan = res.data?.plan;
        if (!plan || !plan.crates?.length) return;
        setSavedPlanCandidate(plan);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, allParts.length]);

  const handleLoadSavedPlan = useCallback(() => {
    if (!savedPlanCandidate) return;
    const partsById = new Map(allParts.map((p) => [p.id, p]));
    const restored = savedPlanCandidate.crates
      .map((c) => crateFromParts(c.crate_no, (c.part_ids || []).map((id) => partsById.get(id)).filter(Boolean), DEFAULT_DIM_CONFIG))
      .filter((c) => c.parts.length > 0);
    setCrates(restored);
    setTargetWeightKg(savedPlanCandidate.target_weight_kg || 1900);
    setSavedPlanCandidate(null);
  }, [savedPlanCandidate, allParts]);

  const handleDiscardSavedPlan = useCallback(() => {
    setSavedPlanCandidate(null);
  }, []);

  // Editing the dimension config must reflect immediately on every crate already
  // built, not just future auto-bucket rounds — recompute all of them in place.
  useEffect(() => {
    setCrates((prev) => prev.map((c) => crateFromParts(c.crate_no, c.parts, dimConfig)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimConfig]);

  // Parts already sitting in a crate never come back through the filter pool —
  // to remove one, go into its specific crate and use "Remove (back to pool)".
  const allocatedIds = useMemo(() => {
    const s = new Set();
    for (const c of crates) for (const p of c.parts) s.add(p.id);
    return s;
  }, [crates]);

  const availableParts = useMemo(
    () => allParts.filter((p) => !allocatedIds.has(p.id)),
    [allParts, allocatedIds],
  );

  const filteredPartsAll = useMemo(
    () => availableParts.filter((p) => partMatchesFilters(p, filters, null)),
    [availableParts, filters],
  );

  // "# pieces to select" caps how many of the matched parts are pulled in —
  // e.g. take the first 40 of 1740 matches instead of the whole pool.
  const filteredParts = useMemo(() => {
    const n = parseInt(selectCount, 10);
    if (!n || n <= 0 || n >= filteredPartsAll.length) return filteredPartsAll;
    return filteredPartsAll.slice(0, n);
  }, [filteredPartsAll, selectCount]);

  // Tracks which filter dimensions were touched, oldest first, so a later
  // auto-relax (see relaxFiltersUntilNonEmpty) knows which one to drop first
  // — the one the user most recently set is the most likely reason the pool
  // just went empty.
  const filterOrderRef = useRef([]);
  const setFilter = (key, values) => {
    filterOrderRef.current = [...filterOrderRef.current.filter((k) => k !== key), key];
    setFilters((f) => ({ ...f, [key]: values }));
  };

  useEffect(() => {
    // Reset selection whenever the pool changes so stale checkbox state
    // never survives a filter change into a manual crate.
    setSelectedPartIds(new Set());
  }, [filteredParts]);

  useEffect(() => {
    if (!projectId) return;
    axios
      .get(`${API_BASE}/projects/${projectId}/crate-suggestions`)
      .then((res) => setSuggestions(res.data))
      .catch(() => setSuggestions(null));
  }, [projectId]);

  const logCrateAction = useCallback((crate, filtersUsed) => {
    if (!projectId) return;
    const category = crate.parts[0]?.category || null;
    const partType = crate.parts[0]?.part || null;
    axios
      .post(`${API_BASE}/projects/${projectId}/crate-actions`, {
        filters: filtersUsed,
        part_ids: crate.parts.map((p) => p.id),
        category,
        part_type: partType,
        total_weight_kg: crate.total_weight_kg,
        total_sqft: crate.total_sqft,
        part_count: crate.parts.length,
      })
      .catch(() => {}); // logging is best-effort, never blocks crate building
  }, [projectId]);

  const togglePartSelected = useCallback((partId) => {
    setSelectedPartIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId); else next.add(partId);
      return next;
    });
  }, []);

  const suggestedNextCrateNo = useMemo(
    () => (crates.length ? Math.max(...crates.map((c) => c.crate_no)) + 1 : 1),
    [crates],
  );

  // Pre-fill the crate # field with the next free number whenever it's empty
  // (fresh into manual mode, or right after a crate was just created) — the
  // factory floor can still type over it to match their own physical labels.
  useEffect(() => {
    if (manualCrateNo === '') setManualCrateNo(String(suggestedNextCrateNo));
  }, [suggestedNextCrateNo, manualCrateNo]);

  const manualCrateNoTaken = useMemo(() => {
    const n = Number(manualCrateNo);
    return manualCrateNo !== '' && crates.some((c) => c.crate_no === n);
  }, [manualCrateNo, crates]);

  const handleCreateManualCrate = useCallback(() => {
    const chosen = filteredParts.filter((p) => selectedPartIds.has(p.id));
    if (!chosen.length) return;
    const crateNo = Number(manualCrateNo);
    if (!crateNo || crateNo <= 0 || crates.some((c) => c.crate_no === crateNo)) return;
    setCrates((prev) => {
      const crate = crateFromParts(crateNo, chosen, dimConfig);
      logCrateAction(crate, filters);
      return [...prev, crate].sort((a, b) => a.crate_no - b.crate_no);
    });
    setSelectedPartIds(new Set());
    setManualCrateNo('');
    // Keep the active filters as-is — the user picked them on purpose and
    // may want to keep building more crates from the same filtered view.
    // But if every part they just matched is now allocated, the pool would
    // show nothing at all under that same combination — relax filters one
    // at a time (most recently touched first) until something reappears,
    // instead of wiping them all back to empty.
    const chosenIds = new Set(chosen.map((p) => p.id));
    const remainingPool = availableParts.filter((p) => !chosenIds.has(p.id));
    setFilters((f) => relaxFiltersUntilNonEmpty(f, filterOrderRef.current, remainingPool));
    setSelectCount('');
  }, [filteredParts, selectedPartIds, manualCrateNo, crates, dimConfig, filters, logCrateAction, availableParts]);

  const handleAutoBucket = useCallback(() => {
    if (!filteredParts.length) return;
    // Never let one crate straddle a crate class or a building — batch each
    // (class, building) partition on its own, then run class/building groups
    // through in bucket order (islands, then kitchen, then vanity, then misc)
    // so crate numbering still reads in the familiar order.
    const partitions = partitionPartsByClassAndBuilding(filteredParts)
      .sort((a, b) => a.crateClassOrder - b.crateClassOrder);
    const batches = partitions.flatMap(({ crateClassOrder, parts }) => (
      crateClassOrder === 0
        ? islandBatchParts(parts, targetWeightKg, dimConfig.island.widthMargin * 2)
        : weightBatchParts(parts, targetWeightKg)
    ));
    setCrates((prev) => {
      let nextNo = prev.length ? Math.max(...prev.map((c) => c.crate_no)) + 1 : 1;
      const added = batches.map((parts) => crateFromParts(nextNo++, parts, dimConfig));
      return [...prev, ...added];
    });
    // Keep the active filters as-is, but relax them if the pool they just
    // emptied out would otherwise show nothing — see handleCreateManualCrate.
    const chosenIds = new Set(filteredParts.map((p) => p.id));
    const remainingPool = availableParts.filter((p) => !chosenIds.has(p.id));
    setFilters((f) => relaxFiltersUntilNonEmpty(f, filterOrderRef.current, remainingPool));
    setSelectCount('');
  }, [filteredParts, targetWeightKg, dimConfig, availableParts]);

  const handleMovePart = useCallback((partId, fromCrateNo, toCrateNoRaw) => {
    setCrates((prev) => {
      const part = prev.find((c) => c.crate_no === fromCrateNo)?.parts.find((p) => p.id === partId);
      if (!part) return prev;

      // Removing sends the part back to the unallocated pool — just drop it.
      if (toCrateNoRaw === '__remove__') {
        return prev
          .map((c) => (c.crate_no === fromCrateNo ? crateFromParts(c.crate_no, c.parts.filter((p) => p.id !== partId), dimConfig) : c))
          .filter((c) => c.parts.length > 0);
      }

      const toCrateNo = toCrateNoRaw === '__new__' ? Math.max(...prev.map((c) => c.crate_no)) + 1 : Number(toCrateNoRaw);

      let next = prev.map((c) => {
        if (c.crate_no === fromCrateNo) {
          const parts = c.parts.filter((p) => p.id !== partId);
          return crateFromParts(c.crate_no, parts, dimConfig);
        }
        return c;
      });

      const targetExists = next.some((c) => c.crate_no === toCrateNo);
      next = targetExists
        ? next.map((c) => (c.crate_no === toCrateNo ? crateFromParts(toCrateNo, [...c.parts, part], dimConfig) : c))
        : [...next, crateFromParts(toCrateNo, [part], dimConfig)];

      // Drop emptied crates.
      return next.filter((c) => c.parts.length > 0).sort((a, b) => a.crate_no - b.crate_no);
    });
  }, [dimConfig]);

  const handleDeleteCrate = useCallback((crateNo) => {
    setCrates((prev) => prev.filter((c) => c.crate_no !== crateNo));
  }, []);

  const handleDeleteAll = useCallback(() => {
    if (!crates.length) return;
    if (!window.confirm('Delete all crates and return every part to the pool?')) return;
    setCrates([]);
  }, [crates.length]);

  const handleSave = useCallback(() => {
    setSaving(true);
    axios
      .post(`${API_BASE}/projects/${projectId}/manual-crate-plan`, {
        target_weight_kg: targetWeightKg,
        filters,
        crates: crates.map((c) => ({ crate_no: c.crate_no, part_ids: c.parts.map((p) => p.id) })),
      })
      .then((res) => setSavedAt(res.data?.saved_at))
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to save crate plan'))
      .finally(() => setSaving(false));
  }, [projectId, crates, targetWeightKg, filters]);

  const handleDownload = useCallback(() => {
    if (!crates.length) return;
    setExporting(true);
    axios
      .post(
        `${API_BASE}/projects/${projectId}/manual-crate-plan/export`,
        {
          crates: crates.map((c) => ({
            ...c,
            part_ids: c.parts.map((p) => p.id),
            part_layers: c.parts.map((p) => ({ id: p.id, layer: p.layer, row: p.row })),
          })),
        },
        { responseType: 'blob' },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const disposition = res.headers['content-disposition'] || '';
        const match = disposition.match(/filename="?([^";]+)"?/);
        const link = document.createElement('a');
        link.href = url;
        link.download = match ? match[1] : 'CratePlan.xlsx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to export crate plan'))
      .finally(() => setExporting(false));
  }, [projectId, crates]);

  const crateSpecs = useMemo(
    () => crates.map((c) => ({ crate_no: c.crate_no, part_ids: c.parts.map((p) => p.id) })),
    [crates],
  );

  const fetchLabelBatch = useCallback((offset) => {
    return axios
      .post(
        `${API_BASE}/projects/${projectId}/process-labels/export`,
        { crates: crateSpecs, offset, limit: LABEL_BATCH_SIZE },
        { responseType: 'blob' },
      )
      .then((res) => {
        const total = Number(res.headers['x-total-parts'] || 0);
        const returned = Number(res.headers['x-returned-parts'] || 0);
        const url = window.URL.createObjectURL(res.data);
        setLabelsTotalParts(total);
        setLabelBatches((prev) => [...prev, { url, count: returned }]);
      });
  }, [projectId, crateSpecs]);

  const handleGenerateLabels = useCallback(() => {
    if (!crates.length) return;
    labelBatches.forEach((b) => window.URL.revokeObjectURL(b.url));
    setLabelBatches([]);
    setLabelsTotalParts(0);
    setGeneratingLabels(true);
    fetchLabelBatch(0)
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to generate process labels'))
      .finally(() => setGeneratingLabels(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crates.length, fetchLabelBatch]);

  const labelsLoadedCount = useMemo(() => labelBatches.reduce((s, b) => s + b.count, 0), [labelBatches]);

  // "Load more" is an explicit button, not scroll-triggered — each batch is
  // its own embedded PDF viewer with its own internal scrollbar, which
  // captures mouse-wheel input before it ever reaches the outer container,
  // so a scroll-into-view sentinel below the iframe is unreachable by
  // scrolling over it. A button sidesteps that entirely.
  const handleLoadMoreLabels = useCallback(() => {
    if (loadingMoreLabels || labelsLoadedCount >= labelsTotalParts) return;
    setLoadingMoreLabels(true);
    fetchLabelBatch(labelsLoadedCount)
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to load more labels'))
      .finally(() => setLoadingMoreLabels(false));
  }, [loadingMoreLabels, labelsLoadedCount, labelsTotalParts, fetchLabelBatch]);

  const handleDownloadLabels = useCallback(() => {
    if (!crates.length) return;
    setExportingLabels(true);
    setExportElapsedSec(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setExportElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    axios
      .post(
        `${API_BASE}/projects/${projectId}/process-labels/export`,
        { crates: crateSpecs },
        { responseType: 'blob' },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ProcessLabels.pdf';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to download process labels'))
      .finally(() => window.clearInterval(timer))
      .finally(() => setExportingLabels(false));
  }, [projectId, crates.length, crateSpecs]);

  const crateOptions = useMemo(() => crates.map((c) => c.crate_no), [crates]);
  const detailCrate = useMemo(() => crates.find((c) => c.crate_no === detailCrateNo) || null, [crates, detailCrateNo]);

  const filteredTotals = useMemo(() => ({
    part_count: filteredParts.length,
    weight_kg: filteredParts.reduce((s, p) => s + (p.weight_kg || 0), 0),
    sqft: filteredParts.reduce((s, p) => s + (p.sqft || 0), 0),
  }), [filteredParts]);

  return (
    <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Crate Planning</div>
        <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Filter parts and build crates</div>
        <div className="mt-1 text-sm text-[#64748b]">
          Multi-select any combination of filters, then auto-bucket by target weight. Allocated parts drop out of the
          pool automatically — repeat with a new filter (e.g. Kitchen Islands, then Kitchen, then Vanity) to build the
          rest. Remove a part from a specific crate to send it back to the pool.
        </div>
      </div>

      {savedPlanCandidate && (
        <div className="rounded-[24px] border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold text-blue-900">Saved crate plan found</div>
              <div className="mt-1 text-sm text-blue-700">
                Saved {new Date(savedPlanCandidate.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                {' — '}
                {savedPlanCandidate.crates?.length ?? 0} crate{savedPlanCandidate.crates?.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleLoadSavedPlan}
                className="rounded-full border border-blue-600 bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                Load saved plan
              </button>
              <button
                type="button"
                onClick={handleDiscardSavedPlan}
                className="rounded-full border border-blue-200 bg-white px-4 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors whitespace-nowrap"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading && (
        <div className="rounded-[24px] border border-[#dbe4f0] bg-white px-5 py-12 text-center text-sm text-[#94a3b8]">
          Loading parts…
        </div>
      )}

      {!loading && allParts.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 items-center rounded-[20px] border border-[#dbe4f0] bg-[#f8fafc] px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8] mr-1 self-center">In scope (unallocated)</span>
            {[
              { l: 'Parts', v: filteredTotals.part_count },
              { l: 'Weight', v: `${fmt(filteredTotals.weight_kg)} kg` },
              { l: 'Sq ft', v: fmt(filteredTotals.sqft) },
            ].map(({ l, v }) => (
              <span key={l} className="flex flex-col items-center rounded-xl border border-[#e8edf3] bg-white px-3 py-1.5 min-w-[64px] text-center">
                <span className="text-[9px] uppercase tracking-wide text-[#94a3b8] leading-none">{l}</span>
                <span className="mt-0.5 text-sm font-semibold text-[#0f172a] leading-tight">{v}</span>
              </span>
            ))}
            <span className="ml-2 text-xs text-[#94a3b8]">{allocatedIds.size} parts already allocated</span>
            <label className="ml-auto flex items-center gap-2 text-xs text-[#64748b]">
              # pieces to select
              <input
                type="number"
                min="1"
                placeholder={`All (${filteredPartsAll.length})`}
                value={selectCount}
                onChange={(e) => setSelectCount(e.target.value)}
                className="w-24 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
              />
            </label>
          </div>

          {suggestions?.sample_size > 0 && (
            <div className="rounded-[16px] border border-[#dbe4f0] bg-amber-50 px-4 py-3 text-xs text-[#78350f]">
              <span className="font-semibold">Learned from {suggestions.sample_size} manually-built crate{suggestions.sample_size !== 1 ? 's' : ''}:</span>{' '}
              {suggestions.suggestions.map((s) => (
                <span key={s.group} className="mr-3 inline-block">
                  {s.group}: ~{s.avg_target_weight_kg ?? '—'} kg, ~{s.avg_part_count ?? '—'} parts (n={s.sample_size})
                </span>
              ))}
            </div>
          )}

          <details className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-3">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Crate size settings (advanced) — only touch if crates are coming out the wrong physical size
            </summary>
            <div className="space-y-4 mt-3">
              {DIM_CLASS_SECTIONS.map((section) => (
                <div key={section.key} className="space-y-2">
                  <div className="text-[11px] font-semibold text-[#334155]">{section.label}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {DIM_CLASS_FIELDS.map((f) => (
                      <label key={f.key} className="flex flex-col text-[10px] text-[#64748b]">
                        <span className="flex min-h-[28px] items-end">{f.label}</span>
                        <input
                          type="number"
                          step="0.1"
                          value={dimConfig[section.key][f.key]}
                          onChange={(e) =>
                            setDimConfig((c) => ({
                              ...c,
                              [section.key]: { ...c[section.key], [f.key]: Number(e.target.value) },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>

          {/* Excel-style parts table: click a column's ▾ to filter it, right where the
              data lives (not a separate control panel) — tick rows on the left and build
              a crate from just those, or hit Auto-bucket to batch everything shown below. */}
          <div className="rounded-[16px] border border-[#dbe4f0] bg-white overflow-hidden">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-left text-[12px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#f8fafc] text-[#475569]">
                  <tr>
                    <th className="px-2 py-2 w-9 border-b border-[#e2e8f0]">
                      <input
                        type="checkbox"
                        checked={filteredParts.length > 0 && selectedPartIds.size === filteredParts.length}
                        onChange={(e) => setSelectedPartIds(e.target.checked ? new Set(filteredParts.map((p) => p.id)) : new Set())}
                      />
                    </th>
                    {POOL_COLUMNS.map((col) => (
                      <th key={col.field} className={`px-2 py-2 border-b border-[#e2e8f0] font-semibold whitespace-nowrap ${col.numeric ? 'text-right' : ''}`}>
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {col.filterKey && (
                            <MultiSelectDropdown
                              compact
                              label={col.label}
                              options={facetOptions(availableParts, filters, FILTER_DIMS_BY_KEY[col.filterKey])}
                              selected={filters[col.filterKey]}
                              onChange={(vals) => setFilter(col.filterKey, vals)}
                            />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredParts.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => togglePartSelected(p.id)}
                      className={`cursor-pointer border-b border-[#f1f5f9] ${selectedPartIds.has(p.id) ? 'bg-blue-50' : 'hover:bg-[#f8fafc]'}`}
                    >
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedPartIds.has(p.id)} onChange={() => togglePartSelected(p.id)} />
                      </td>
                      {POOL_COLUMNS.map((col) => (
                        <td key={col.field} className={`px-2 py-1.5 whitespace-nowrap ${col.numeric ? 'text-right text-[#0f172a]' : 'text-[#334155]'}`}>
                          {col.field === 'weight_kg' || col.field === 'sqft' ? fmt(p[col.field]) : p[col.field]}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filteredParts.length === 0 && (
                    <tr>
                      <td colSpan={POOL_COLUMNS.length + 1} className="px-4 py-8 text-center text-[#94a3b8]">
                        No parts match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-3">
            <TargetWeightControl value={targetWeightKg} onChange={setTargetWeightKg} />
            <button
              type="button"
              onClick={handleAutoBucket}
              disabled={!filteredParts.length}
              className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e40af] disabled:opacity-50"
            >
              Auto-bucket all {filteredParts.length} shown into crates
            </button>
            <span className="text-[#cbd5e1]">|</span>
            <span className="text-xs font-semibold text-[#64748b]">{selectedPartIds.size} row{selectedPartIds.size !== 1 ? 's' : ''} checked</span>
            <label className="flex items-center gap-1.5 text-[11px] text-[#64748b]">
              Crate #
              <input
                type="number"
                min="1"
                value={manualCrateNo}
                onChange={(e) => setManualCrateNo(e.target.value)}
                className={`w-20 rounded-lg border px-2 py-1 text-[12px] focus:outline-none ${
                  manualCrateNoTaken ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#e2e8f0] bg-white text-[#0f172a] focus:border-[#0f172a]'
                }`}
              />
            </label>
            <button
              type="button"
              onClick={handleCreateManualCrate}
              disabled={!selectedPartIds.size || !manualCrateNo || manualCrateNoTaken}
              className="ml-auto rounded-full border border-[#1d4ed8] bg-white px-5 py-2 text-sm font-semibold text-[#1d4ed8] shadow-sm transition-all hover:bg-blue-50 disabled:opacity-50"
            >
              Build crate from checked rows
            </button>
          </div>
          {manualCrateNoTaken && (
            <div className="text-[11px] text-red-600 text-right">Crate #{manualCrateNo} already exists — pick a different number.</div>
          )}

          {crates.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  {crates.length} crate{crates.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  className="rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                >
                  Delete all crates
                </button>
              </div>
              <CrateSummaryTable
                crates={crates}
                onViewDetails={setDetailCrateNo}
                onDeleteCrate={handleDeleteCrate}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[#0f172a] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e293b] disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save Crate Plan'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={exporting}
                  className="rounded-full border border-[#0f172a] bg-white px-6 py-3 text-sm font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-60"
                >
                  {exporting ? 'Exporting…' : 'Download Excel (2 sheets)'}
                </button>
                {savedAt && <span className="text-xs text-[#64748b]">Saved {new Date(savedAt).toLocaleString()}</span>}
              </div>

              {savedAt && (
                <div className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-4 space-y-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Next: process labels</div>
                    <div className="mt-1 text-sm text-[#475569]">
                      One process label per part, for every part currently in a crate — the fabrication reference sheet to print and stick on each piece.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleGenerateLabels}
                      disabled={generatingLabels}
                      className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e40af] disabled:opacity-50"
                    >
                      {generatingLabels ? 'Loading first labels…' : 'Preview process labels'}
                    </button>
                    {labelBatches.length > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadLabels}
                        disabled={exportingLabels}
                        className="rounded-full border border-[#0f172a] bg-white px-5 py-2 text-sm font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-50"
                      >
                        {exportingLabels ? `Generating all ${labelsTotalParts}… (${exportElapsedSec}s)` : `Download PDF (all ${labelsTotalParts})`}
                      </button>
                    )}
                    {exportingLabels && (
                      <span className="text-xs text-[#94a3b8]">
                        Large projects can take several minutes — keep this tab open.
                      </span>
                    )}
                    {labelBatches.length > 0 && (
                      <span className="text-xs text-[#94a3b8]">
                        Showing {labelsLoadedCount} of {labelsTotalParts} labels
                      </span>
                    )}
                  </div>
                  {labelBatches.length > 0 && (
                    <div className="rounded-[12px] border border-[#e2e8f0] overflow-hidden" style={{ height: 600 }}>
                      <div className="overflow-y-auto h-full">
                        {labelBatches.map((b, i) => (
                          <iframe
                            key={b.url}
                            title={`Process labels preview batch ${i + 1}`}
                            src={b.url}
                            style={{ width: '100%', height: 500, border: 'none', display: 'block' }}
                          />
                        ))}
                        {labelsLoadedCount < labelsTotalParts && (
                          <div className="py-4 flex justify-center">
                            <button
                              type="button"
                              onClick={handleLoadMoreLabels}
                              disabled={loadingMoreLabels}
                              className="rounded-full border border-[#0f172a] bg-white px-5 py-2 text-xs font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-50"
                            >
                              {loadingMoreLabels ? 'Loading…' : `Load ${Math.min(LABEL_BATCH_SIZE, labelsTotalParts - labelsLoadedCount)} more`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <CrateDetailModal
        crate={detailCrate}
        crateOptions={crateOptions}
        onMovePart={handleMovePart}
        onClose={() => setDetailCrateNo(null)}
      />
    </div>
  );
};

export default CrateFilterPlanner;
