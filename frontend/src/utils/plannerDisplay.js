import { getPieceWeight, placementDimensionsForDraft } from './plannerUtils';

export function inferCrateClass(crate) {
  if (crate.planner_v3_crate_class) return crate.planner_v3_crate_class;
  const m = (crate.name || '').match(/^\[([ABCD])\]/);
  return m ? m[1] : null;
}

export function inferOrientation(crate) {
  if (crate.planner_v3_orientation) return crate.planner_v3_orientation;
  return null;
}

export function computedCrateWeightKg(crate, piecesInCrate, project) {
  const w = Number(crate.weight ?? crate.total_weight_kg ?? crate.gross_weight);
  if (w > 0) return w;
  if (!piecesInCrate?.length) return 0;
  return piecesInCrate.reduce((s, p) => s + getPieceWeight(p, project), 0);
}

export function splashLayerLabel(crate) {
  if (Array.isArray(crate.planner_v3_splash_layers) && crate.planner_v3_splash_layers.length) {
    return `${crate.planner_v3_splash_layers.length} layer(s)`;
  }
  const n = (crate.splash_layer_piece_ids || []).length;
  return n ? `${n} splash pcs` : '—';
}

/** Merge stored layout with live crate dimensions for 3D (handles pre-enrichment documents). */
/** Concatenate enriched layouts from planner_v3_containers for crate-detail / 3D lookup. */
export function normalizeAllPlacementsFor3D(containers, crates) {
  if (!Array.isArray(containers) || !containers.length || !crates?.length) return [];
  const merged = [];
  for (const cont of containers) {
    merged.push(...normalizePlacementsFor3D(cont, crates));
  }
  return merged;
}

export function normalizePlacementsFor3D(layout, crates) {
  if (!layout?.placements?.length || !crates?.length) return [];
  const byId = Object.fromEntries(crates.map((c) => [c.crate_id, c]));
  const byDispatch = [...crates].sort((a, b) => (a.dispatch_order || 0) - (b.dispatch_order || 0));

  return layout.placements
    .map((p) => {
      let crate = p.crate_id ? byId[p.crate_id] : null;
      if (!crate && typeof p.crate_index === 'number') {
        crate = byDispatch[p.crate_index] ?? null;
      }
      if (!crate) return null;

      const floorL = Number(p.floor_l || crate.external_length || 48);
      const floorW = Number(p.floor_w || crate.external_width || 40);
      const heightIn = Number(
        p.height_in != null ? p.height_in : crate.external_height || 36,
      );
      const elevationIn = Number(p.elevation_in != null ? p.elevation_in : 0);

      return {
        ...p,
        crate_id: p.crate_id || crate.crate_id,
        crate_db_id: crate.id,
        crate_class: p.crate_class || inferCrateClass(crate),
        orientation: p.orientation || inferOrientation(crate),
        floor_l: floorL,
        floor_w: floorW,
        height_in: heightIn,
        elevation_in: elevationIn,
        weight_kg: computedCrateWeightKg(crate, [], null),
      };
    })
    .filter(Boolean);
}

/** 2D floor overlap (container floor X / Y — same as planner canvas). */
export function overlapFloor2d(a, b) {
  const ax = Number(a.x);
  const ay = Number(a.y);
  const al = Number(a.floor_l);
  const aw = Number(a.floor_w);
  const bx = Number(b.x);
  const by = Number(b.y);
  const bl = Number(b.floor_l);
  const bw = Number(b.floor_w);
  return !(ax + al <= bx || bx + bl <= ax || ay + aw <= by || by + bw <= ay);
}

/** Stack elevations from floor overlap + stack_level (matches manual container stacking). */
export function assignPlacementElevations3D(items) {
  const list = [...items].sort((a, b) => (a.stack_level || 0) - (b.stack_level || 0));
  for (const p of list) {
    const sl = Number(p.stack_level || 0);
    if (sl <= 0) {
      p.elevation_in = 0;
      continue;
    }
    let el = 0;
    for (const q of list) {
      if (q === p) continue;
      if (Number(q.stack_level || 0) >= sl) continue;
      if (!overlapFloor2d(p, q)) continue;
      el = Math.max(el, (Number(q.elevation_in) || 0) + (Number(q.height_in) || 0));
    }
    p.elevation_in = el;
  }
  return list;
}

/**
 * Live 3D positions from the editable container plan (syncs with 2D drag).
 * Heights prefer solver `planner_v3_layout` when crate_id matches; elevations from stack_level + overlap.
 */
export function buildPlacements3DFromManual(containerDraft, crates, project, v3Layout) {
  if (!containerDraft?.placements?.length || !crates?.length) return [];
  const crateByCode = Object.fromEntries(crates.map((c) => [c.crate_id, c]));
  const v3ByCrate = Object.fromEntries(
    (v3Layout?.placements || [])
      .filter((p) => p.crate_id)
      .map((p) => [p.crate_id, p]),
  );

  const sorted = [...containerDraft.placements].sort(
    (a, b) => Number(a.loading_order || 0) - Number(b.loading_order || 0),
  );

  const raw = [];
  for (const mp of sorted) {
    const c = crateByCode[mp.crate_id];
    if (!c) continue;
    const dims = placementDimensionsForDraft(c, mp.rotated);
    const v3p = v3ByCrate[c.crate_id];
    const heightIn = Number(
      v3p?.height_in != null ? v3p.height_in : c.external_height || 40,
    );
    raw.push({
      crate_id: c.crate_id,
      crate_db_id: c.id,
      x: Number(mp.x || 0),
      y: Number(mp.y || 0),
      floor_l: Number(dims.length || 0),
      floor_w: Number(dims.width || 0),
      stack_level: Number(mp.stack_level ?? 0),
      height_in: heightIn,
      rotated: Boolean(mp.rotated),
      crate_class: inferCrateClass(c),
      orientation: inferOrientation(c),
      weight_kg: computedCrateWeightKg(c, [], project),
      loading_order: Number(mp.loading_order || 0),
    });
  }

  assignPlacementElevations3D(raw);
  return raw;
}

/** Infer island zone depth (in) from A-type footprint when layout metadata missing. */
export function inferIslandZoneDepthIn(placements, gapIn = 6) {
  const islands = (placements || []).filter((p) => p.crate_class === 'A');
  if (!islands.length) return 0;
  const depth = Math.max(...islands.map((p) => Number(p.x) + Number(p.floor_l)));
  return Math.min(depth + gapIn, Number.MAX_SAFE_INTEGER);
}
