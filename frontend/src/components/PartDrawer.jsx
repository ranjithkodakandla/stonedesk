import React, { useState, useEffect, useRef } from 'react';
import { edgeAreaFromMap } from './PiecesGrid';

const EDGE_OPTIONS = ['none', 'polished', 'flat_chamfer', 'cut', 'manual'];
const EDGE_LABELS = { none: '—', polished: 'Pencil Round', flat_chamfer: 'Flat Chamfer 1mm', cut: 'Cut', manual: 'Manual' };
const EDGE_COLORS = {
  none: 'bg-slate-100 text-slate-400 border-slate-200',
  polished: 'bg-blue-100 text-blue-700 border-blue-300',
  flat_chamfer: 'bg-cyan-100 text-cyan-700 border-cyan-300',
  cut: 'bg-amber-100 text-amber-700 border-amber-300',
  manual: 'bg-emerald-100 text-emerald-700 border-emerald-300',
};

const SINK_TYPE_OPTIONS = ['No Sink', 'Single Bowl', 'Double Bowl'];
const HOLE_COUNT_OPTIONS = ['-', '0', '1', '2', '3', '4', '5', '6', '7', '8'];

const DEFAULT_EDGE_MAP = { top: 'none', bottom: 'none', left: 'none', right: 'none' };
const DEFAULT_RADIUS_CORNERS = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };
const DEFAULT_RADIUS_CORNER_VALUES = {};
// Click-to-place groove points: up to this many per piece, each placed on a
// dotted guide line that runs around the sink at a single shared distance
// from its edge, and stored as {x, y} offsets from the sink's center point
// (same model tap holes already use, and what the technical-drawing
// renderer already expects).
const MAX_GROOVE_POSITIONS = 8;
const DEFAULT_GROOVE_DISTANCE_IN = 2.5;

// {edge, along, distance} -> {x, y} offset from the sink's center. `along` is
// the position along that edge, `distance` how far out from it (inches).
const computeGrooveXY = (edge, along, distance, sinkLen, sinkWid) => {
  const halfLen = sinkLen / 2;
  const halfWid = sinkWid / 2;
  const d = Number(distance) || 0;
  if (edge === 'top') return { x: along, y: Number((-halfWid - d).toFixed(3)) };
  if (edge === 'bottom') return { x: along, y: Number((halfWid + d).toFixed(3)) };
  if (edge === 'left') return { x: Number((-halfLen - d).toFixed(3)), y: along };
  return { x: Number((halfLen + d).toFixed(3)), y: along }; // 'right'
};
const DEFAULT_RADIUS_CORNER_EXPLICIT = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };

// Fallback used only if the fabrication-defaults setting hasn't loaded yet.
// The authoritative value comes from GET /api/settings/fabrication-defaults.
export const FALLBACK_DEFAULT_CORNER_RADIUS_IN = 0.125;

// Each edge touches exactly two corners of a rectangular countertop.
export const EDGE_TO_CORNERS = {
  top: ['top_left', 'top_right'],
  bottom: ['bottom_left', 'bottom_right'],
  left: ['top_left', 'bottom_left'],
  right: ['top_right', 'bottom_right'],
};

// The inverse: each corner is physically formed by exactly two adjacent
// edges meeting there.
export const CORNER_TO_EDGES = {
  top_left: ['top', 'left'],
  top_right: ['top', 'right'],
  bottom_left: ['bottom', 'left'],
  bottom_right: ['bottom', 'right'],
};

// A corner auto-rounds only when BOTH edges that meet there are polished —
// selecting just one of its two edges must not round it, since the corner
// doesn't exist as a distinct feature until the two edges forming it both
// get worked. Recomputed fresh from the whole edge map on every edge
// change (so switching an edge back off un-rounds a corner that's no
// longer at the intersection of two selected edges, same as switching it
// on rounds one that newly is) — except for a corner the user has already
// configured by hand (radiusCornerExplicit), which this never touches.
export const deriveCornersFromEdgeMap = (edgeMap, radiusCorners, radiusCornerExplicit) => {
  const next = { ...radiusCorners };
  Object.entries(CORNER_TO_EDGES).forEach(([corner, edges]) => {
    if (radiusCornerExplicit?.[corner]) return;
    next[corner] = edges.every((side) => edgeMap?.[side] && edgeMap[side] !== 'none');
  });
  return next;
};

// Effective radius shown/used for a corner: an explicit per-corner override
// wins; otherwise the piece's legacy shared radius_value (old data); otherwise
// the configured app default. Never one global radius silently applied over
// an explicit override.
export const effectiveCornerRadius = (corner, radiusCornerValues, legacyRadiusValue, defaultRadiusIn) => {
  const override = Number(radiusCornerValues?.[corner]);
  if (Number.isFinite(override) && override > 0) return override;
  const legacy = Number(legacyRadiusValue);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return defaultRadiusIn ?? FALLBACK_DEFAULT_CORNER_RADIUS_IN;
};

// Count implied by a "-"/"0"/"1".."8" select value — "-" and "0" both mean "no holes/grooves".
const countFromOption = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Pad/truncate an array of {x,y} (or plain string) entries to exactly `n` items.
const resizeArray = (arr, n, factory) => {
  const base = Array.isArray(arr) ? arr.slice(0, n) : [];
  while (base.length < n) base.push(factory());
  return base;
};

// Groove entries from an earlier version of this UI may carry {x, y} only,
// or their own per-entry `distance` — both are folded onto the single shared
// distance (`groove_dimension`) going forward: infer which sink edge each
// one is nearest, keep its position along that edge, and recompute x/y at
// the current shared distance so every groove sits on the same dotted line.
const migrateGroovePositions = (positions, r, distance) => {
  if (!Array.isArray(positions)) return [];
  const sinkLen = Number(r.sink_length) || Math.max((Number(r.length) || 0) * 0.3, 1);
  const sinkWid = Number(r.sink_width) || Math.max((Number(r.width) || 0) * 0.5, 1);
  const halfLen = sinkLen / 2;
  const halfWid = sinkWid / 2;
  return positions.map((p) => {
    const x = Number(p?.x) || 0;
    const y = Number(p?.y) || 0;
    let edge = p?.edge;
    if (edge !== 'top' && edge !== 'bottom' && edge !== 'left' && edge !== 'right') {
      const marginH = halfLen - Math.abs(x);
      const marginV = halfWid - Math.abs(y);
      edge = Math.abs(marginH) <= Math.abs(marginV) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'top' : 'bottom');
    }
    const along = (edge === 'top' || edge === 'bottom') ? x : y;
    return { edge, ...computeGrooveXY(edge, along, distance, sinkLen, sinkWid) };
  });
};

const Section = ({ id, title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
        <span>{title}</span>
        <span className="text-slate-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 space-y-0">{children}</div>}
    </div>
  );
};

const PartDrawer = ({ row, destinations, onUpdate, onClose, scrollTo, defaultCornerRadiusIn }) => {
  const bodyRef = useRef(null);
  const defaultRadius = defaultCornerRadiusIn ?? FALLBACK_DEFAULT_CORNER_RADIUS_IN;

  const hydrate = (r) => {
    const grooveDistance = Number(r.groove_dimension) > 0 ? r.groove_dimension : DEFAULT_GROOVE_DISTANCE_IN;
    const edgeMap = (r.edge_map && Object.keys(r.edge_map).length) ? r.edge_map : { ...DEFAULT_EDGE_MAP };
    const radiusCornerExplicit = (r.radius_corner_explicit && Object.keys(r.radius_corner_explicit).length) ? r.radius_corner_explicit : { ...DEFAULT_RADIUS_CORNER_EXPLICIT };
    const radiusCorners = (r.radius_corners && Object.keys(r.radius_corners).length) ? r.radius_corners : { ...DEFAULT_RADIUS_CORNERS };
    return {
      ...r,
      edge_map: edgeMap,
      // Recomputed on load too, not just on the next click — a piece saved
      // before this fix (or edited outside this drawer) can have edges
      // configured without its intersection corners rounded yet.
      radius_corners: deriveCornersFromEdgeMap(edgeMap, radiusCorners, radiusCornerExplicit),
      radius_corner_values: (r.radius_corner_values && Object.keys(r.radius_corner_values).length) ? r.radius_corner_values : { ...DEFAULT_RADIUS_CORNER_VALUES },
      radius_corner_explicit: radiusCornerExplicit,
      radius_value: r.radius_value ?? '',
      shape_type: r.shape_type ?? '',
      edge_polish_manual: r.edge_polish_manual ?? '',
      dest_qty_overrides: r.dest_qty_overrides ?? {},
      sink_numbers: Array.isArray(r.sink_numbers) ? r.sink_numbers : [],
      tap_hole_diameter: r.tap_hole_diameter ?? '',
      tap_hole_positions: Array.isArray(r.tap_hole_positions) ? r.tap_hole_positions : [],
      groove_dimension: grooveDistance,
      groove_positions: migrateGroovePositions(r.groove_positions, r, grooveDistance),
    };
  };

  const [local, setLocal] = useState(() => hydrate(row));

  useEffect(() => {
    setLocal(hydrate(row));
    if (scrollTo && bodyRef.current) {
      setTimeout(() => {
        const el = bodyRef.current?.querySelector(`#section-${scrollTo}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [row._id, scrollTo]);

  const push = (next) => { setLocal(next); };
  const set = (k, v) => push({ ...local, [k]: v });
  const setEdge = (side, v) => {
    const newEdgeMap = { ...local.edge_map, [side]: v };
    const newRadiusCorners = deriveCornersFromEdgeMap(newEdgeMap, local.radius_corners, local.radius_corner_explicit);
    push({ ...local, edge_map: newEdgeMap, edge_area: edgeAreaFromMap(newEdgeMap), radius_corners: newRadiusCorners });
  };
  // User-driven corner selection always marks the corner explicit, so a
  // later edge change never overrides what was deliberately chosen here —
  // whether that's checking a corner the auto-logic left alone, or
  // unchecking one the auto-logic had just set.
  const setCorner = (c, v) => push({
    ...local,
    radius_corners: { ...local.radius_corners, [c]: v },
    radius_corner_explicit: { ...local.radius_corner_explicit, [c]: true },
  });
  const setCornerRadius = (c, v) => push({
    ...local,
    radius_corner_values: { ...local.radius_corner_values, [c]: v === '' ? undefined : Number(v) },
    radius_corner_explicit: { ...local.radius_corner_explicit, [c]: true },
  });
  const setDestQty = (key, v) => {
    const overrides = { ...local.dest_qty_overrides };
    if (v === '' || v == null) delete overrides[key];
    else overrides[key] = Number(v);
    push({ ...local, dest_qty_overrides: overrides });
  };

  // ── Sink type + per-bowl sink number ─────────────────────────────────────
  const setSinkType = (v) => {
    const n = v === 'Double Bowl' ? 2 : v === 'Single Bowl' ? 1 : 0;
    push({ ...local, sink_type: v, sink_numbers: resizeArray(local.sink_numbers, n, () => '') });
  };
  const setSinkNumber = (idx, v) => {
    const next = [...local.sink_numbers];
    next[idx] = v;
    push({ ...local, sink_numbers: next });
  };

  // ── Tap holes: count + shared diameter + per-hole X/Y offset from sink center ──
  const setTapHoleCount = (v) => {
    const n = countFromOption(v);
    push({ ...local, tap_holes: v, tap_hole_positions: resizeArray(local.tap_hole_positions, n, () => ({ x: '', y: '' })) });
  };
  const setTapHolePos = (idx, axis, v) => {
    const next = local.tap_hole_positions.map((p, i) => (i === idx ? { ...p, [axis]: v } : p));
    push({ ...local, tap_hole_positions: next });
  };

  // ── Sink grooves: one shared "distance from sink edge" draws a dotted
  // guide line all the way around the sink; clicking anywhere on it drops a
  // groove there (snapped onto the line), up to MAX_GROOVE_POSITIONS. Each
  // groove is stored as {x, y, edge}: x/y is the groove center as an offset
  // from the sink's center (the same model tap holes already use and what
  // the technical-drawing renderer expects), edge is which sink side it's
  // measured from. Changing the shared distance recomputes every groove's
  // x/y from its edge + along-edge position, so the whole line (and
  // everything placed on it) moves together.
  const grooveXYFor = (edge, along, distance) => computeGrooveXY(edge, along, distance, sinkLenIn, sinkWidIn);

  const addGroovePosition = (edge, along) => {
    if (local.groove_positions.length >= MAX_GROOVE_POSITIONS) return;
    const entry = { edge, ...grooveXYFor(edge, along, local.groove_dimension) };
    const next = [...local.groove_positions, entry];
    push({ ...local, groove_positions: next, grooves: String(next.length) });
  };
  const removeGroovePosition = (idx) => {
    const next = local.groove_positions.filter((_, i) => i !== idx);
    push({ ...local, groove_positions: next, grooves: next.length > 0 ? String(next.length) : '-' });
  };
  const setGrooveDistance = (v) => {
    const next = local.groove_positions.map((p) => {
      const along = (p.edge === 'top' || p.edge === 'bottom') ? p.x : p.y;
      return { edge: p.edge, ...grooveXYFor(p.edge, along, v) };
    });
    push({ ...local, groove_dimension: v, groove_positions: next });
  };

  const em = local.edge_map || DEFAULT_EDGE_MAP;
  const rc = local.radius_corners || DEFAULT_RADIUS_CORNERS;
  const activeSides = Object.values(em).filter(v => v !== 'none').length;
  const activeCorners = Object.values(rc).filter(Boolean).length;
  const L = Number(local.length) || 0;
  const W = Number(local.width) || 0;
  const hasSink = local.sink_type && local.sink_type !== 'No Sink';
  const tapHoleCount = countFromOption(local.tap_holes);
  const sinkLenIn = Number(local.sink_length) || Math.max(L * 0.3, 1);
  const sinkWidIn = Number(local.sink_width) || Math.max(W * 0.5, 1);

  const EdgeBtn = ({ side, label }) => {
    const val = em[side] || 'none';
    const cycle = () => setEdge(side, EDGE_OPTIONS[(EDGE_OPTIONS.indexOf(val) + 1) % EDGE_OPTIONS.length]);
    return (
      <button type="button" onClick={cycle}
        className={`text-[11px] font-medium border rounded-md px-3 py-2 transition-all select-none text-center ${EDGE_COLORS[val]}`}>
        <div className="text-[9px] font-normal opacity-70">{label}</div>
        <div className="font-bold">{EDGE_LABELS[val]}</div>
      </button>
    );
  };

  const CornerChk = ({ corner, label }) => {
    const checked = rc[corner] || false;
    const radius = effectiveCornerRadius(corner, local.radius_corner_values, local.radius_value, defaultRadius);
    return (
      <div className={`rounded-lg border transition-all px-3 py-2.5 ${checked ? 'bg-violet-50 border-violet-300' : 'bg-white border-slate-200'}`}>
        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
          <input type="checkbox" checked={checked} onChange={e => setCorner(corner, e.target.checked)}
            className="accent-violet-600 w-3.5 h-3.5" />
          <span className={checked ? 'text-violet-700' : 'text-slate-500'}>{label}</span>
        </label>
        {checked && (
          <div className="flex items-center gap-1.5 mt-1.5 pl-5">
            <input type="number" step="0.0625" min="0"
              value={local.radius_corner_values?.[corner] ?? ''}
              onChange={e => setCornerRadius(corner, e.target.value)}
              placeholder={radius.toFixed(3)}
              className="w-16 text-[11px] border border-slate-200 rounded px-1.5 py-1" />
            <span className="text-[10px] text-slate-400">in{!local.radius_corner_values?.[corner] ? ' (default)' : ''}</span>
          </div>
        )}
      </div>
    );
  };

  const GROOVE_SVG_W = 260;
  const GROOVE_SVG_H = 160;
  // The sink rect and the dotted guide line both have to fit, so scale is
  // based on the guide line's (bigger) outer extent, not just the sink.
  const GROOVE_FIT_FRACTION = 0.8;
  const grooveDistanceIn = Number(local.groove_dimension) || 0;
  const grooveOuterLenIn = sinkLenIn + grooveDistanceIn * 2;
  const grooveOuterWidIn = sinkWidIn + grooveDistanceIn * 2;
  const grooveScale = Math.min(
    (GROOVE_SVG_W * GROOVE_FIT_FRACTION) / grooveOuterLenIn,
    (GROOVE_SVG_H * GROOVE_FIT_FRACTION) / grooveOuterWidIn,
  );
  const grooveCx = GROOVE_SVG_W / 2;
  const grooveCy = GROOVE_SVG_H / 2;
  const grooveRectX = grooveCx - (sinkLenIn * grooveScale) / 2;
  const grooveRectY = grooveCy - (sinkWidIn * grooveScale) / 2;
  const grooveRectW = sinkLenIn * grooveScale;
  const grooveRectH = sinkWidIn * grooveScale;
  const grooveOuterX = grooveCx - (grooveOuterLenIn * grooveScale) / 2;
  const grooveOuterY = grooveCy - (grooveOuterWidIn * grooveScale) / 2;
  const grooveOuterW = grooveOuterLenIn * grooveScale;
  const grooveOuterH = grooveOuterWidIn * grooveScale;

  // Click anywhere -> snap onto the dotted guide line (the sink rect expanded
  // by the shared distance on every side) at the nearest point to the click.
  const handleGrooveDiagramClick = (e) => {
    if (local.groove_positions.length >= MAX_GROOVE_POSITIONS) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * GROOVE_SVG_W;
    const py = ((e.clientY - rect.top) / rect.height) * GROOVE_SVG_H;
    const halfLen = grooveOuterLenIn / 2;
    const halfWid = grooveOuterWidIn / 2;
    const ox = (px - grooveCx) / grooveScale;
    const oy = (py - grooveCy) / grooveScale;
    const ratioH = Math.abs(ox) / halfLen;
    const ratioV = Math.abs(oy) / halfWid;
    if (ratioH >= ratioV) {
      const edge = ox < 0 ? 'left' : 'right';
      const along = Math.max(-halfWid, Math.min(halfWid, oy));
      addGroovePosition(edge, Number(along.toFixed(3)));
    } else {
      const edge = oy < 0 ? 'top' : 'bottom';
      const along = Math.max(-halfLen, Math.min(halfLen, ox));
      addGroovePosition(edge, Number(along.toFixed(3)));
    }
  };

  const GrooveSinkDiagram = () => (
    <svg
      viewBox={`0 0 ${GROOVE_SVG_W} ${GROOVE_SVG_H}`}
      className="w-full border border-slate-200 rounded-lg bg-slate-50 cursor-crosshair"
      style={{ height: GROOVE_SVG_H }}
      onClick={handleGrooveDiagramClick}
    >
      <rect x={grooveOuterX} y={grooveOuterY} width={grooveOuterW} height={grooveOuterH}
        fill="none" stroke="#7c3aed" strokeWidth="1.25" strokeDasharray="4 3" />
      <rect x={grooveRectX} y={grooveRectY} width={grooveRectW} height={grooveRectH}
        fill="#fff" stroke="#94a3b8" strokeWidth="1.5" rx="3" />
      <text x={grooveCx} y={grooveCy + 3} textAnchor="middle" fontSize="9" fill="#cbd5e1">
        Sink ({sinkLenIn.toFixed(1)}" × {sinkWidIn.toFixed(1)}")
      </text>
      {local.groove_positions.map((pos, i) => (
        <circle key={i}
          cx={grooveCx + Number(pos.x || 0) * grooveScale}
          cy={grooveCy + Number(pos.y || 0) * grooveScale}
          r="4.5" fill="#7c3aed" stroke="#fff" strokeWidth="1"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); removeGroovePosition(i); }}
        />
      ))}
    </svg>
  );

  const validDests = (destinations || []).filter(d => d.building || d.floor || d.flat);
  const handleSave = () => {
    onUpdate?.(local);
    onClose?.();
  };

  // This drawer renders inside the Drawing Workspace's <form>, so Enter in a
  // plain input would otherwise submit that form (triggering Save Drawing)
  // rather than just moving on — intercept it and tab to the next field
  // instead. Textareas (Notes) and buttons/selects keep their own Enter
  // behavior.
  const handleDrawerKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const focusable = Array.from(
      e.currentTarget.querySelectorAll('input, select, textarea, button')
    ).filter((el) => !el.disabled && el.tabIndex !== -1);
    const idx = focusable.indexOf(e.target);
    focusable[idx + 1]?.focus();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col"
        onClick={e => e.stopPropagation()} onKeyDown={handleDrawerKeyDown}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">Part Details</span>
              {local.part_no && (
                <span className="font-mono text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{local.part_no}</span>
              )}
            </div>
            {local.part && <div className="text-xs text-slate-500 mt-0.5">{local.part}</div>}
            <div className="text-[10px] text-slate-400 mt-1">Matrix family review updates this same part row.</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors text-base">
            ✕
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">

          {/* Section 1 — Sink */}
          <Section id="section-sink" title="Sink">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-text">Sink Type</label>
                <select value={local.sink_type || 'No Sink'} onChange={e => setSinkType(e.target.value)} className="input-field">
                  {SINK_TYPE_OPTIONS.map(v => <option key={v}>{v}</option>)}
                </select>
              </div>

              {hasSink && (
                <div className="col-span-2 grid grid-cols-2 gap-3">
                  {local.sink_numbers.map((num, i) => (
                    <div key={i}>
                      <label className="label-text">
                        Sink Number{local.sink_type === 'Double Bowl' ? ` (Bowl ${i + 1})` : ''}
                      </label>
                      <input value={num || ''} onChange={e => setSinkNumber(i, e.target.value)}
                        className="input-field" placeholder="e.g., S-101" />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="label-text">Sink Cutouts #</label>
                <select value={local.sink_cut || '-'} onChange={e => set('sink_cut', e.target.value)} className="input-field">
                  {['-','0','1','2','3'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>

              {hasSink && (
                <>
                  <div className="col-span-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                    Sink position — used to place the sink cutout on the process label drawing.
                  </div>
                  <div>
                    <label className="label-text">Distance from left (in)</label>
                    <input type="number" step="0.125" min="0" value={local.sink_offset_left ?? ''}
                      onChange={e => set('sink_offset_left', e.target.value)} className="input-field" placeholder="e.g., 12.5" />
                  </div>
                  <div>
                    <label className="label-text">Distance from right (in)</label>
                    <input type="number" step="0.125" min="0" value={local.sink_offset_right ?? ''}
                      onChange={e => set('sink_offset_right', e.target.value)} className="input-field" placeholder="e.g., 12.5" />
                  </div>
                  <div>
                    <label className="label-text">Sink length (in) <span className="text-slate-400">(optional)</span></label>
                    <input type="number" step="0.125" min="0" value={local.sink_length ?? ''}
                      onChange={e => set('sink_length', e.target.value)} className="input-field" placeholder="Optional" />
                  </div>
                  <div>
                    <label className="label-text">Sink width (in) <span className="text-slate-400">(optional)</span></label>
                    <input type="number" step="0.125" min="0" value={local.sink_width ?? ''}
                      onChange={e => set('sink_width', e.target.value)} className="input-field" placeholder="Optional" />
                  </div>
                </>
              )}
            </div>
          </Section>

          {/* Section 2 — Tap Holes */}
          <Section id="section-tap-holes" title="Tap Holes" defaultOpen={false}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Tap Holes #</label>
                  <select value={local.tap_holes || '-'} onChange={e => setTapHoleCount(e.target.value)} className="input-field">
                    {HOLE_COUNT_OPTIONS.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                {tapHoleCount > 0 && (
                  <div>
                    <label className="label-text">Hole Diameter (in)</label>
                    <input type="number" step="0.0625" min="0" value={local.tap_hole_diameter || ''}
                      onChange={e => set('tap_hole_diameter', e.target.value)} className="input-field" placeholder="e.g., 1.375" />
                  </div>
                )}
              </div>
              {tapHoleCount > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    Offset of each hole from the sink's center point (X = along length, Y = along width).
                  </p>
                  {local.tap_hole_positions.map((pos, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-xs font-medium text-slate-600">Hole {i + 1}</span>
                      <input type="number" step="0.0625" value={pos.x ?? ''}
                        onChange={e => setTapHolePos(i, 'x', e.target.value)}
                        className="input-field" placeholder="X offset" />
                      <input type="number" step="0.0625" value={pos.y ?? ''}
                        onChange={e => setTapHolePos(i, 'y', e.target.value)}
                        className="input-field" placeholder="Y offset" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* Section 3 — Sink Grooves */}
          <Section id="section-grooves" title="Sink Grooves" defaultOpen={false}>
            {!hasSink ? (
              <p className="text-[11px] text-slate-500">Select a sink type above first.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label-text">Distance from sink edge (in)</label>
                  <input type="number" step="0.0625" min="0" value={local.groove_dimension ?? ''}
                    onChange={e => setGrooveDistance(e.target.value)} className="input-field" placeholder="e.g., 2.5" />
                </div>
                <p className="text-[11px] text-slate-500">
                  Click anywhere on the dotted line to drop a groove there — up to {MAX_GROOVE_POSITIONS}.
                  Double-click a point to remove it. Changing the distance above moves the line (and every groove on it).
                  {local.groove_positions.length > 0 && ` ${local.groove_positions.length} placed.`}
                </p>
                <GrooveSinkDiagram />
              </div>
            )}
          </Section>

          {/* Section 4 — Outline Shape (the piece's overall outline — separate
              from Sink Type above, which only describes the sink/bowl) */}
          <Section id="section-shape" title="Outline Shape">
            <div>
              <label className="label-text">Outline Shape</label>
              <select value={local.shape_type || ''} onChange={e => set('shape_type', e.target.value)} className="input-field">
                <option value="">Rectangle (default)</option>
                <option>L-Shape</option>
                <option>U-Shape</option>
                <option>Ogee</option>
                <option>Custom</option>
              </select>
            </div>
          </Section>

          {/* Section 5 — Edge Polish */}
          <Section id="section-edge" title="Edge Polish">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Edge Type</label>
                  <select value={local.edge || 'None'} onChange={e => set('edge', e.target.value)} className="input-field">
                    <option>None</option>
                    <option>Machine</option>
                    <option>Manual</option>
                    <option>Both</option>
                  </select>
                </div>
                <div>
                  <label className="label-text">Sides</label>
                  <select value={local.edge_area || ''} onChange={e => set('edge_area', e.target.value)} className="input-field">
                    <option value="">—</option>
                    <option>4 Sides</option>
                    <option>3 Sides</option>
                    <option>2 Sides</option>
                    <option>1 Side</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label-text">Manual Polish Note</label>
                <input value={local.edge_polish_manual || ''} onChange={e => set('edge_polish_manual', e.target.value)}
                  className="input-field" placeholder="e.g., Ogee profile on front edge" />
              </div>
            </div>
          </Section>

          {/* Section 6 — Edge Dimensions */}
          <Section id="section-edge-dims" title="Edge Dimensions">
            <p className="text-[11px] text-slate-500 mb-4">Click a side to cycle: — → Pencil Round → Flat Chamfer 1mm → Cut → Manual → —<br />Top/Bottom = Length side. Left/Right = Width side.</p>
            <div className="flex flex-col items-center gap-2">
              <EdgeBtn side="top" label={`Top  (L${L > 0 ? ` = ${L.toFixed(1)}"` : ''})`} />
              <div className="flex items-stretch gap-2 w-full">
                <EdgeBtn side="left" label={`Left  (W${W > 0 ? ` = ${W.toFixed(1)}"` : ''})`} />
                <div className="flex-1 min-h-[64px] rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400 font-mono">
                  {L > 0 && W > 0 ? `${L.toFixed(1)}" × ${W.toFixed(1)}"` : 'PIECE'}
                </div>
                <EdgeBtn side="right" label={`Right  (W${W > 0 ? ` = ${W.toFixed(1)}"` : ''})`} />
              </div>
              <EdgeBtn side="bottom" label={`Bottom  (L${L > 0 ? ` = ${L.toFixed(1)}"` : ''})`} />
            </div>
            {activeSides > 0 && (
              <p className="mt-3 text-xs text-blue-600 font-medium">{activeSides} side{activeSides !== 1 ? 's' : ''} configured</p>
            )}
          </Section>

          {/* Section 7 — Radius / Corners */}
          <Section id="section-radius" title="Radius / Corners">
            <div className="space-y-4">
              <p className="text-[11px] text-slate-500">
                A corner auto-rounds at the default radius (R{defaultRadius.toFixed(3)}") once both
                edges meeting there are polished — selecting just one of its two edges doesn't round
                it. Each corner below can be overridden independently, and a corner you've configured
                by hand is never changed by edge selections.
              </p>
              <div>
                <label className="label-text block mb-2">Corners{activeCorners > 0 ? ` (${activeCorners} selected)` : ''}</label>
                <div className="grid grid-cols-2 gap-2">
                  <CornerChk corner="top_left"     label="↖ Top Left" />
                  <CornerChk corner="top_right"    label="↗ Top Right" />
                  <CornerChk corner="bottom_left"  label="↙ Bottom Left" />
                  <CornerChk corner="bottom_right" label="↘ Bottom Right" />
                </div>
              </div>
            </div>
          </Section>

          {/* Destination Qty Overrides */}
          {validDests.length > 0 && (
            <Section id="section-dest" title="Matrix Family / Destination Review" defaultOpen={false}>
              <p className="text-[11px] text-slate-500 mb-3">
                Override qty per destination. Leave blank to use default qty
                <span className="font-bold text-slate-700"> ({local.qty ?? 1})</span>.
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {validDests.map(dest => {
                  const key = [dest.building, dest.floor, dest.flat].filter(Boolean).join('/');
                  const label = [
                    dest.building && `Bldg ${dest.building}`,
                    dest.floor    && `Fl ${dest.floor}`,
                    dest.flat     && `Flat ${dest.flat}`,
                  ].filter(Boolean).join(' · ');
                  const override = (local.dest_qty_overrides || {})[key];
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 flex-1 truncate">{label}</span>
                      <input type="number" min="0" value={override ?? ''}
                        onChange={e => setDestQty(key, e.target.value)}
                        className="input-field w-16 text-center text-xs py-1"
                        placeholder={local.qty ?? 1} />
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Notes */}
          <Section id="section-notes" title="Notes">
            <textarea value={local.notes || ''} onChange={e => set('notes', e.target.value)}
              className="input-field resize-none w-full" rows={3}
              placeholder="Special instructions, part notes..." />
          </Section>

        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            Changes are applied when you click Save.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-primary bg-white text-slate-700 border border-slate-200 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} className="btn-primary">
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PartDrawer;
