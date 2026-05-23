/**
 * Physical layout helpers for warehouse-style crate visualization.
 * Aligns with crateEstimator horizontal stack + island cassette models.
 */
import { round2 } from './plannerUtils';

const THICKNESS_IN = {
  '2CM': 0.79, '3CM': 1.18, '4CM': 1.57, '2.0CM': 0.79, '3.0CM': 1.18, Mixed: 0.98,
};

export function parseThicknessIn(t) {
  if (!t) return 1.18;
  const key = String(t).trim().toUpperCase().replace(' ', '');
  if (THICKNESS_IN[key] != null) return THICKNESS_IN[key];
  if (THICKNESS_IN[String(t).trim()] != null) return THICKNESS_IN[String(t).trim()];
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 1.18;
}

export function isBackSplashPiece(piece) {
  return /back.?splash/i.test(piece?.part || '');
}

export function isSideSplashPiece(piece) {
  return /side.?splash/i.test(piece?.part || '');
}

export function isMainTopPiece(piece) {
  return !isBackSplashPiece(piece) && !isSideSplashPiece(piece);
}

/** Flatten all pieces from draft crate bundles (internal grouping only). */
export function flattenPiecesFromCrate(crate) {
  const pieces = [];
  for (const group of crate?.bundles || []) {
    for (const p of group.pieces || []) {
      pieces.push({ ...p, _unit_id: group.unit_id, _family_id: group.family_id });
    }
  }
  return pieces;
}

export function isIslandCrate(crate) {
  return crate?.crate_class === 'island_vertical';
}

/**
 * Build bottom→top layers for kitchen/vanity horizontal crates.
 * @returns {{ id, type, label, pieces, heightIn, gapAfterIn }[]}
 */
export function buildHorizontalStackLayers(pieces, gapIn = 1) {
  const mains = pieces.filter(isMainTopPiece);
  const backs = pieces.filter(isBackSplashPiece);
  const sides = pieces.filter(isSideSplashPiece);
  const layers = [];

  const pushLayer = (id, type, label, pts, heightIn) => {
    if (!pts.length && heightIn <= 0) return;
    layers.push({
      id,
      type,
      label,
      pieces: pts,
      heightIn: round2(heightIn || Math.max(...pts.map((p) => parseThicknessIn(p.thickness)), 0)),
      gapAfterIn: 0,
    });
  };

  if (mains.length) {
    pushLayer(
      'tops',
      'main',
      'Tops',
      mains,
      Math.max(...mains.map((p) => parseThicknessIn(p.thickness))),
    );
  }
  if (backs.length) {
    if (layers.length) layers[layers.length - 1].gapAfterIn = gapIn;
    pushLayer(
      'back',
      'back_splash',
      'Back splash',
      backs,
      Math.max(...backs.map((p) => parseThicknessIn(p.thickness))),
    );
  }
  if (sides.length) {
    if (layers.length) layers[layers.length - 1].gapAfterIn = gapIn;
    pushLayer(
      'side',
      'side_splash',
      'Side splash',
      sides,
      Math.max(...sides.map((p) => parseThicknessIn(p.thickness))),
    );
  }

  return layers;
}

/** Crate footprint from pieces (length = longest top long edge). */
export function crateFootprintFromPieces(pieces, crateDims) {
  let maxLong = 0;
  let maxShort = 0;
  for (const p of pieces) {
    const L = parseFloat(p.length) || 0;
    const W = parseFloat(p.width) || 0;
    maxLong = Math.max(maxLong, Math.max(L, W));
    maxShort = Math.max(maxShort, L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W));
  }
  const intL = crateDims?.internal_length || maxLong + 6;
  const intW = crateDims?.internal_width || maxShort + 6;
  const intH = crateDims?.internal_height || 0;
  return { intL: round2(intL), intW: round2(intW), intH: round2(intH) };
}

/** Island: pieces ordered for depth stack (thickness along depth axis). */
export function islandDepthStack(pieces) {
  return [...pieces].sort((a, b) => {
    const ta = parseThicknessIn(a.thickness);
    const tb = parseThicknessIn(b.thickness);
    if (a.role === 'main' && b.role !== 'main') return -1;
    if (b.role === 'main' && a.role !== 'main') return 1;
    return tb - ta;
  });
}
