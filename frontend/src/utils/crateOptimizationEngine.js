/**
 * Preview / apply helpers for interactive crate optimization viewer.
 * Edits are visual overrides until applyEditsToPlan() persists via recomputeCrate.
 */
import {
  buildDraftCrate,
  estimateHorizontalLayeredDimensions,
  estimateLeanedCassetteDimensions,
  getCrateClass,
  getCrateOperationalStatus,
  recomputeCrate,
} from './crateEstimator';
import {
  buildHorizontalStackLayers,
  flattenPiecesFromCrate,
  isIslandCrate,
} from './cratePhysicalLayout';
import { round2 } from './plannerUtils';

const CRATE_TARE_KG = 220;
const GEOMETRY_EXT_HEIGHT_HARD_IN = 90;
const ISLAND_DEPTH_WARN_IN = 24;

/** Human-readable class merge failure (island isolation). */
export function getClassMergeError(pieceClass, targetClass) {
  if (!pieceClass || !targetClass || pieceClass === targetClass) return null;
  if (pieceClass === 'island_vertical' && targetClass === 'kitchen_vertical') {
    return 'Island cannot merge into Kitchen.';
  }
  if (pieceClass === 'island_vertical' && targetClass === 'vanity_vertical') {
    return 'Island cannot merge into Vanity.';
  }
  if (pieceClass === 'kitchen_vertical' && targetClass === 'island_vertical') {
    return 'Kitchen cannot merge into Island.';
  }
  if (pieceClass === 'vanity_vertical' && targetClass === 'island_vertical') {
    return 'Vanity cannot merge into Island.';
  }
  if (pieceClass === 'kitchen_vertical' && targetClass === 'vanity_vertical') {
    return 'Kitchen cannot merge into Vanity.';
  }
  if (pieceClass === 'vanity_vertical' && targetClass === 'kitchen_vertical') {
    return 'Vanity cannot merge into Kitchen.';
  }
  return `Part class (${pieceClass}) cannot join crate class (${targetClass}).`;
}

export function pieceCrateClass(piece) {
  return getCrateClass({
    part_bucket: piece.part_bucket,
    category: piece.category,
    pieces: [piece],
  });
}

export function isCrateEmpty(crate) {
  if (crate?._previewEmpty) return true;
  return flattenPiecesFromCrate(crate).length === 0;
}

export function buildEmptyCrateShell(crate) {
  return {
    ...crate,
    bundles: [],
    bundle_count: 0,
    part_count: 0,
    total_weight_kg: 0,
    total_sqft: 0,
    part_type_mix: {},
    dimensions: {
      internal_length: 0,
      internal_width: 0,
      internal_height: 0,
      external_length: 0,
      external_width: 0,
      external_height: 0,
    },
    warnings: [],
    _previewEmpty: true,
  };
}

/** Canonical factory stack steps for engineering / exploded labels. */
export function buildCanonicalStackSteps(layers, gapIn = 1) {
  const tops = layers.find((l) => l.type === 'main');
  const back = layers.find((l) => l.type === 'back_splash');
  const side = layers.find((l) => l.type === 'side_splash');
  const gapLabel = `${gapIn}″ SPACER`;
  const steps = [];
  let n = 1;

  steps.push({ step: n++, title: 'TOPS', kind: 'layer', present: Boolean(tops), layer: tops });
  if (tops && (back || side)) {
    steps.push({ step: n++, title: gapLabel, kind: 'spacer', present: true });
  }
  steps.push({ step: n++, title: 'BACK SPLASH', kind: 'layer', present: Boolean(back), layer: back });
  if (back && side) {
    steps.push({ step: n++, title: gapLabel, kind: 'spacer', present: true });
  }
  steps.push({ step: n++, title: 'SIDE SPLASH', kind: 'layer', present: Boolean(side), layer: side });
  return steps;
}

export function isCanonicalLayerOrder(layers) {
  const rank = { main: 0, back_splash: 1, side_splash: 2 };
  let last = -1;
  for (const layer of layers) {
    const r = rank[layer.type] ?? 99;
    if (r < last) return false;
    last = r;
  }
  return true;
}

/**
 * Validate full preview plan. Hard errors block Apply; warnings do not.
 */
export function validateEditPlan(editCrates, targetWeightKg = 1900, options = {}) {
  const errors = [];
  const warnings = [];
  const { layerOrderByCrateId = {}, gapInByCrateId = {} } = options;

  for (const c of editCrates) {
    if (isCrateEmpty(c)) {
      errors.push(`${c.id} is empty — delete the crate or restore parts before applying.`);
      continue;
    }

    const pieces = flattenPiecesFromCrate(c);
    const gapIn = gapInByCrateId[c.id] ?? 1;
    const preview = previewCrateFromEdits(c, pieces, gapIn, targetWeightKg);
    const { metrics, dimensions, island } = preview;

    if (preview.crate.island_splash_violation) {
      errors.push(`${c.id}: Island crate contains splash pieces — islands only.`);
    }

    if (metrics.status === 'ERROR') {
      errors.push(`${c.id}: Invalid crate configuration (splash or class conflict).`);
    }

    if (metrics.totalCrateWeightKg > targetWeightKg) {
      errors.push(
        `${c.id}: Weight overflow — ${fmtKg(metrics.totalCrateWeightKg)} kg exceeds ${fmtKg(targetWeightKg)} kg target.`,
      );
    } else if (metrics.status === 'OVERWEIGHT' || (c.total_weight_kg || 0) > 2200) {
      errors.push(`${c.id}: Weight overflow — exceeds 2200 kg operational limit.`);
    }

    if (!island && (dimensions.external_height || 0) > GEOMETRY_EXT_HEIGHT_HARD_IN) {
      errors.push(
        `${c.id}: Geometry overflow — external height ${dimensions.external_height}″ exceeds ${GEOMETRY_EXT_HEIGHT_HARD_IN}″ limit.`,
      );
    } else if (!island && (dimensions.external_height || 0) > 88) {
      warnings.push(`${c.id}: External height ${dimensions.external_height}″ — verify container clearance.`);
    }

    if (island && (dimensions.internal_width || 0) > ISLAND_DEPTH_WARN_IN) {
      warnings.push(`${c.id}: Deep island cassette (${dimensions.internal_width}″) — check slot clearance.`);
    }

    const customLayers = layerOrderByCrateId[c.id];
    const layers = customLayers || preview.layers;
    if (!island && layers.length > 0 && !isCanonicalLayerOrder(layers)) {
      errors.push(
        `${c.id}: Stack ordering violation — factory order is Tops → Spacer → Back splash → Side splash.`,
      );
    }

    if (!island && layers.length > 0) {
      const expectedKeys = [];
      for (const layer of buildHorizontalStackLayers(pieces, gapIn)) {
        layer.pieces.forEach((p, i) => expectedKeys.push(pieceKey(p, i)));
      }
      const actualKeys = pieces.map((p, i) => pieceKey(p, i));
      if (actualKeys.join('|') !== expectedKeys.join('|')) {
        warnings.push(
          `${c.id}: Piece list order may not match factory stack — review exploded stack.`,
        );
      }
    }

    const ptm = preview.crate.part_type_mix || {};
    const classes = new Set(
      Object.keys(ptm)
        .filter((k) => (ptm[k] || 0) > 0)
        .map((pt) => getCrateClass({ pieces: [{ part: pt }] })),
    );
    if (classes.size > 1) {
      errors.push(`${c.id}: Mixed crate classes — cannot apply until resolved.`);
    }

    if (metrics.status === 'REVIEW') {
      warnings.push(`${c.id}: Mixed part types — confirm with site team.`);
    }
    if (metrics.status === 'UNDERLOADED') {
      warnings.push(`${c.id}: Underloaded — consider consolidating before ship.`);
    }
  }

  const familyCrates = new Map();
  for (const c of editCrates) {
    if (isCrateEmpty(c)) continue;
    for (const p of flattenPiecesFromCrate(c)) {
      const fid = p._family_id || p.family_id;
      if (!fid) continue;
      if (!familyCrates.has(fid)) familyCrates.set(fid, new Set());
      familyCrates.get(fid).add(c.id);
    }
  }
  for (const [fid, crateIds] of familyCrates) {
    if (crateIds.size > 1) {
      const cls = editCrates.find((c) => crateIds.has(c.id))?.crate_class;
      if (cls === 'kitchen_vertical') {
        warnings.push(`Kitchen family separation: unit ${fid} split across ${[...crateIds].join(', ')}.`);
      } else if (cls === 'vanity_vertical') {
        warnings.push(`Vanity family separation: unit ${fid} split across ${[...crateIds].join(', ')}.`);
      } else {
        warnings.push(`Family ${fid} split across crates ${[...crateIds].join(', ')}.`);
      }
    }
  }

  for (const c of editCrates) {
    if (isCrateEmpty(c)) continue;
    const expected = c.crate_class;
    for (const p of flattenPiecesFromCrate(c)) {
      const pc = pieceCrateClass(p);
      const msg = getClassMergeError(pc, expected);
      if (msg) errors.push(`${c.id}: ${msg}`);
    }
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    canApply: errors.length === 0,
  };
}

export function pieceKey(piece, index = 0) {
  if (piece?.id != null && piece.id !== '') return String(piece.id);
  const uid = piece?._unit_id || piece?.unit_id || 'u';
  return `${uid}::${piece?.part_no || ''}::${piece?.part || ''}::${index}`;
}

function stripPreviewFields(piece) {
  const { _unit_id, _family_id, _previewKey, ...rest } = piece;
  return rest;
}

/** Group flat edited pieces back into draft bundles (internal grouping only). */
export function piecesToBundles(flatPieces) {
  const map = new Map();
  flatPieces.forEach((p, idx) => {
    const uid = p._unit_id || p.unit_id || `solo-${pieceKey(p, idx)}`;
    if (!map.has(uid)) {
      map.set(uid, {
        unit_id: uid,
        family_id: p._family_id || p.family_id,
        category: p.category,
        part_bucket: p.part_bucket,
        pieces: [],
        part_count: 0,
        total_weight_kg: 0,
        total_sqft: 0,
      });
    }
    const bundle = map.get(uid);
    bundle.pieces.push(stripPreviewFields(p));
    bundle.part_count = bundle.pieces.length;
    bundle.total_weight_kg = round2(
      bundle.pieces.reduce((s, x) => s + (Number(x.weight_kg) || 0), 0),
    );
    bundle.total_sqft = round2(
      bundle.pieces.reduce((s, x) => s + (Number(x.sqft) || 0), 0),
    );
  });
  return [...map.values()];
}

export function cloneDraftCrates(crates) {
  return JSON.parse(JSON.stringify(crates || []));
}

/** Infer whether a piece may enter a target crate class (island isolation). */
export function canPieceJoinCrate(piece, targetCrate) {
  if (!targetCrate) return false;
  const pseudoBundle = {
    part_bucket: piece.part_bucket,
    category: piece.category,
    pieces: [piece],
  };
  const pieceClass = getCrateClass(pseudoBundle);
  const targetClass = targetCrate.crate_class;
  if (!targetClass) return true;
  return pieceClass === targetClass;
}

export function listMovablePiecesFromOtherCrates(editCrates, activeCrateId) {
  const active = editCrates.find((c) => c.id === activeCrateId);
  if (!active) return [];
  const pool = [];
  for (const c of editCrates) {
    if (c.id === activeCrateId) continue;
    for (const p of flattenPiecesFromCrate(c)) {
      if (canPieceJoinCrate(p, active)) {
        pool.push({ ...p, _fromCrateId: c.id });
      }
    }
  }
  return pool;
}

/**
 * Live preview metrics — does not mutate saved plan.
 */
export function previewCrateFromEdits(crate, flatPieces, gapIn = 1, targetWeightKg = 1900) {
  const bundles = piecesToBundles(flatPieces);
  const draft = buildDraftCrate(crate.id, bundles);
  const island = draft.crate_class === 'island_vertical';
  const dimensions = island
    ? estimateLeanedCassetteDimensions(flatPieces)
    : estimateHorizontalLayeredDimensions(flatPieces, gapIn);

  const slabWeightKg = draft.total_weight_kg || 0;
  const estimatedCrateWeightKg = CRATE_TARE_KG;
  const totalCrateWeightKg = round2(slabWeightKg + estimatedCrateWeightKg);
  const utilizationPct = targetWeightKg > 0
    ? round2((totalCrateWeightKg / targetWeightKg) * 100)
    : 0;

  const previewCrate = {
    ...draft,
    dimensions,
    total_weight_kg: slabWeightKg,
  };
  const status = getCrateOperationalStatus(previewCrate);
  const weightMet = totalCrateWeightKg <= targetWeightKg && status !== 'ERROR';

  const extraWarnings = [];
  if (totalCrateWeightKg > targetWeightKg) {
    extraWarnings.push(`Over target — ${fmtKg(totalCrateWeightKg)} kg exceeds ${fmtKg(targetWeightKg)} kg cap.`);
  }
  if ((dimensions.external_height || 0) > 88 && !island) {
    extraWarnings.push('External height may exceed container clearance — verify before ship.');
  }

  const layers = island ? [] : buildHorizontalStackLayers(flatPieces, gapIn);
  const mainSlabCount = flatPieces.filter(
    (p) => !/back.?splash|side.?splash/i.test(p.part || ''),
  ).length;

  return {
    crate: previewCrate,
    dimensions,
    layers,
    island,
    metrics: {
      partCount: draft.part_count,
      slabCount: mainSlabCount,
      slabWeightKg,
      estimatedCrateWeightKg,
      totalCrateWeightKg,
      utilizationPct,
      targetWeightKg,
      weightOptimizationMet: weightMet,
      status,
    },
    warnings: [...(draft.warnings || []), ...extraWarnings],
    packingNotes: buildPackingNotes(draft, gapIn, island),
  };
}

function fmtKg(n) {
  return Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

function buildPackingNotes(crate, gapIn, island) {
  const notes = [];
  if (island) {
    notes.push('Island-only cassette — slabs on edge, long side open for load/unload.');
    notes.push('No kitchen or vanity parts — islands always ship separately.');
    notes.push('Separator: 100µm poly film between polished faces (negligible thickness).');
  } else {
    const cls = crate.crate_class;
    if (cls === 'kitchen_vertical') {
      notes.push('Kitchen stack: tops → spacer → back splash → side splash.');
      notes.push('Keep family units together — do not split splashes from their tops.');
    } else if (cls === 'vanity_vertical') {
      notes.push('Vanity stack: top → spacer → back splash → side splash.');
    }
    notes.push(`Spacer policy: ${gapIn}″ foam between layers (viewer override — factory default 1″).`);
    notes.push('Length driven by longest top long edge — not splash run totals.');
  }
  if (crate.island_splash_violation) {
    notes.push('Family violation: splash pieces are not permitted in island crates.');
  }
  return notes;
}

/** Apply manual edits to full draft plan (caller persists to Mongo). Skips empty preview shells. */
export function applyEditsToPlan(editCrates) {
  return editCrates
    .filter((c) => !isCrateEmpty(c))
    .map((c) => {
      const { _previewEmpty, ...rest } = c;
      return recomputeCrate(rest);
    });
}

export function deleteCrateFromPlan(editCrates, crateId) {
  return editCrates.filter((c) => c.id !== crateId);
}

export function removePieceFromCrate(editCrates, crateId, key) {
  let becameEmpty = false;
  const next = editCrates.map((c) => {
    if (c.id !== crateId) return c;
    const pieces = flattenPiecesFromCrate(c).filter((p, i) => pieceKey(p, i) !== key);
    if (pieces.length === 0) {
      becameEmpty = true;
      return buildEmptyCrateShell(c);
    }
    const updated = recomputeCrate({ ...c, bundles: piecesToBundles(pieces) });
    const { _previewEmpty, ...rest } = updated;
    return rest;
  });
  return { crates: next, becameEmpty };
}

export function movePieceBetweenCrates(editCrates, fromId, toId, key) {
  const from = editCrates.find((c) => c.id === fromId);
  const to = editCrates.find((c) => c.id === toId);
  if (!from || !to || fromId === toId) return { crates: editCrates, error: 'Invalid crate selection.' };

  let moving = null;
  let movingIdx = 0;
  const fromPieces = flattenPiecesFromCrate(from);
  const nextFrom = fromPieces.filter((p, i) => {
    const k = pieceKey(p, i);
    if (k === key) {
      moving = p;
      movingIdx = i;
      return false;
    }
    return true;
  });
  if (!moving) return { crates: editCrates, error: 'Part not found in source crate.' };
  const pieceClass = pieceCrateClass(moving);
  const mergeErr = getClassMergeError(pieceClass, to.crate_class);
  if (mergeErr) {
    return { crates: editCrates, error: mergeErr };
  }
  if (!canPieceJoinCrate(moving, to)) {
    return {
      crates: editCrates,
      error: getClassMergeError(pieceClass, to.crate_class)
        || `Cannot move to ${toId} — part type does not match crate (${to.crate_class}).`,
    };
  }

  const toPieces = [...flattenPiecesFromCrate(to), moving];
  const next = editCrates.map((c) => {
    if (c.id === fromId) {
      const bundles = piecesToBundles(nextFrom);
      if (bundles.length === 0) return buildEmptyCrateShell(c);
      return recomputeCrate({ ...c, bundles });
    }
    if (c.id === toId) {
      const updated = recomputeCrate({ ...c, bundles: piecesToBundles(toPieces) });
      const { _previewEmpty, ...rest } = updated;
      return rest;
    }
    return c;
  });

  return { crates: next, error: null, sourceEmpty: nextFrom.length === 0 };
}

export function reorderPiecesInCrate(editCrates, crateId, orderedKeys) {
  const crate = editCrates.find((c) => c.id === crateId);
  if (!crate) return editCrates;
  const pieces = flattenPiecesFromCrate(crate);
  const byKey = new Map(pieces.map((p, i) => [pieceKey(p, i), p]));
  const ordered = orderedKeys.map((k) => byKey.get(k)).filter(Boolean);
  for (const p of pieces) {
    const k = pieceKey(p, pieces.indexOf(p));
    if (!orderedKeys.includes(k)) ordered.push(p);
  }
  return editCrates.map((c) => (
    c.id === crateId ? recomputeCrate({ ...c, bundles: piecesToBundles(ordered) }) : c
  ));
}

export { flattenPiecesFromCrate, isIslandCrate };
