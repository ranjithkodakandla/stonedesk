import React, { Suspense, useEffect, useState } from 'react';
import axios from 'axios';

const Crate3DPacking = React.lazy(() => import('./planner3d/Crate3DPacking'));

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// A cross-section (end view) of the crate, matching how the factory
// actually packs it: pieces stand upright, leaning side by side, wrapped in
// foam — see the supplied Kitchen And Range Tops drawing and the factory
// photos (vertically packed slabs with foam separation). Looking at the
// crate from the end, each packing "row" is one upright slab (or two short
// pieces sharing a slab's footprint); slabs sit side by side across the
// crate's internal width, with foam top and bottom. This is NOT a plan/
// elevation of the piece lying flat — that would misrepresent how the
// crate is actually loaded.
//
// Every dimension drawn here comes straight from
// GET /projects/{id}/crates/{id}/packing-schedule, derived from the
// crate's actual persisted piece assignment — if this view is wrong, the
// underlying plan is wrong; there is no separate snapshot to go stale.
const LAYER_LABELS = { main: 'Countertop' };
export const layerLabel = (layer) => LAYER_LABELS[layer] || (layer.startsWith('splash_') ? `Splash (layer ${layer.split('_')[1]})` : layer);

export const fmtDim = (d) => {
  const l = d.length != null ? `${Number(d.length).toFixed(1)}"` : '—';
  const w = d.width != null ? `${Number(d.width).toFixed(1)}"` : '—';
  const t = d.thickness || '';
  return `${l} × ${w}${t ? ` × ${t}` : ''}`;
};

const FOAM_IN = 1; // top/bottom foam, matches the supplied packing drawing
const ROW_GAP_IN = 0.75; // foam separator between adjacent slabs
const MIN_SLOT_PX = 26; // a 1.18"-thick slab would be unreadably thin at true scale
const LAYER_FILL = { main: '#bfdbfe', splash: '#fde68a' };

const layerFill = (layer) => (layer === 'main' ? LAYER_FILL.main : LAYER_FILL.splash);

// Pure layout calculation — exported so it can be unit-tested without a DOM.
export const buildCrossSectionLayout = (rows, internalWidthIn, internalHeightIn, scalePxPerIn) => {
  const totalWidthIn = internalWidthIn || (
    rows.reduce((s, r) => s + (r.slot_thickness_in || 0), 0) + Math.max(0, rows.length - 1) * ROW_GAP_IN + 4
  );
  const totalHeightIn = internalHeightIn || (
    Math.max(0, ...rows.map((r) => r.standing_height_in || 0)) + 2 * FOAM_IN
  );

  let cursorIn = 0;
  const slabs = rows.map((row) => {
    const thicknessIn = row.slot_thickness_in || 0;
    const slotWidthPx = Math.max(thicknessIn * scalePxPerIn, MIN_SLOT_PX);
    const heightIn = row.standing_height_in || 0;
    const slab = {
      row: row.row,
      layer: row.layer,
      xPx: cursorIn * scalePxPerIn,
      widthPx: slotWidthPx,
      heightPx: heightIn * scalePxPerIn,
      // Bottom-aligned on the floor just above the bottom foam band.
      yPx: (totalHeightIn - FOAM_IN - heightIn) * scalePxPerIn,
      label: row.dimensions.map((d) => `${Number(d.length).toFixed(0)}"`).join('+'),
      title: row.dimensions.map((d) => `${d.part_no || d.piece_id}: ${fmtDim(d)}`).join(' / '),
    };
    cursorIn += thicknessIn + ROW_GAP_IN;
    return slab;
  });

  return {
    totalWidthPx: Math.max(cursorIn - ROW_GAP_IN, totalWidthIn) * scalePxPerIn,
    totalHeightPx: totalHeightIn * scalePxPerIn,
    foamPx: FOAM_IN * scalePxPerIn,
    slabs,
  };
};

const CrossSection = ({ rows, internalWidthIn, internalHeightIn }) => {
  const totalWidthInGuess = internalWidthIn || rows.reduce((s, r) => s + (r.slot_thickness_in || 0), 0) + rows.length * ROW_GAP_IN + 4;
  const scale = Math.max(4, Math.min(14, 640 / Math.max(1, totalWidthInGuess)));
  const layout = buildCrossSectionLayout(rows, internalWidthIn, internalHeightIn, scale);
  const pad = 36;

  return (
    <svg width={layout.totalWidthPx + pad * 2} height={layout.totalHeightPx + pad * 2 + 20} className="max-w-full">
      <g transform={`translate(${pad}, ${pad})`}>
        {/* Crate outline */}
        <rect x={0} y={0} width={layout.totalWidthPx} height={layout.totalHeightPx} fill="none" stroke="#1e293b" strokeWidth={2} />
        {/* Foam bands */}
        <rect x={0} y={0} width={layout.totalWidthPx} height={layout.foamPx} fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="3 2" />
        <rect x={0} y={layout.totalHeightPx - layout.foamPx} width={layout.totalWidthPx} height={layout.foamPx} fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="3 2" />
        <text x={4} y={layout.foamPx / 2 + 4} fontSize={9} fill="#94a3b8">Top foam</text>
        <text x={4} y={layout.totalHeightPx - layout.foamPx / 2 + 4} fontSize={9} fill="#94a3b8">Bottom foam</text>

        {/* Slabs — each a standing, foam-wrapped piece (or pair sharing a slot) */}
        {layout.slabs.map((slab) => (
          <g key={slab.row}>
            <rect
              x={slab.xPx} y={slab.yPx} width={slab.widthPx} height={slab.heightPx}
              fill={layerFill(slab.layer)} stroke="#1d4ed8" strokeWidth={1}
            >
              <title>{`Row ${slab.row}: ${slab.title}`}</title>
            </rect>
            <text
              x={slab.xPx + slab.widthPx / 2} y={slab.yPx - 6}
              fontSize={9} fill="#1e3a8a" textAnchor="middle"
              transform={`rotate(-90, ${slab.xPx + slab.widthPx / 2}, ${slab.yPx - 6})`}
            >
              {slab.label}
            </text>
            <text x={slab.xPx + slab.widthPx / 2} y={layout.totalHeightPx + 14} fontSize={9} fill="#64748b" textAnchor="middle">
              R{slab.row}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
};

const CratePackingSchedule = ({ projectId, crateId, crateLabel, material, stoneColor }) => {
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !crateId) { setSchedule(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios.get(`${API_BASE}/projects/${projectId}/crates/${crateId}/packing-schedule`)
      .then((res) => { if (!cancelled) setSchedule(res.data); })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.detail || 'Failed to load packing schedule.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, crateId]);

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading packing schedule…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;
  if (!schedule || !schedule.rows?.length) return <div className="p-4 text-sm text-slate-400">No packing schedule for this crate yet.</div>;

  const {
    rows, unassigned_piece_ids: unassigned,
    internal_length: internalLengthIn, internal_width: internalWidthIn, internal_height: internalHeightIn,
  } = schedule;

  return (
    <div className="space-y-4">
      {/* Real 3D scene — same row data, stone/wood materials driven by the
          project's own material + color (never an AI-generated image). */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b] mb-3">
          Crate {crateLabel || schedule.crate_id} — 3D ({material || 'Granite'}{stoneColor ? ` · ${stoneColor}` : ''})
        </div>
        <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading 3D preview…</div>}>
          <Crate3DPacking
            rows={rows}
            internalLength={internalLengthIn}
            internalWidth={internalWidthIn}
            internalHeight={internalHeightIn}
            material={material}
            stoneColor={stoneColor}
          />
        </Suspense>
      </div>

      {/* Cross-section: how the pieces actually stand inside the crate. */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 overflow-x-auto">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b] mb-3">
          Crate {crateLabel || schedule.crate_id} — cross-section (end view)
        </div>
        <CrossSection rows={rows} internalWidthIn={internalWidthIn} internalHeightIn={internalHeightIn} />
      </div>

      {/* Schedule table: Row / Layer / Piece / Dimensions / Qty / Sequence. */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#e2e8f0] text-[#64748b]">
              <th className="py-2 px-3">Row</th>
              <th className="py-2 px-3">Layer</th>
              <th className="py-2 px-3">Piece(s)</th>
              <th className="py-2 px-3">Dimensions</th>
              <th className="py-2 px-3">Qty</th>
              <th className="py-2 px-3">Sequence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row} className="border-b border-[#f1f5f9]">
                <td className="py-2 px-3 font-mono">{row.row}</td>
                <td className="py-2 px-3">{layerLabel(row.layer)}</td>
                <td className="py-2 px-3 font-mono">{row.dimensions.map((d) => d.part_no || d.piece_id).join(', ')}</td>
                <td className="py-2 px-3">{row.dimensions.map((d) => fmtDim(d)).join(' + ')}</td>
                <td className="py-2 px-3">{row.quantity}</td>
                <td className="py-2 px-3">{row.sequence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unassigned?.length > 0 && (
        <p className="text-xs text-amber-600">
          {unassigned.length} piece{unassigned.length === 1 ? '' : 's'} referenced by this crate could not be found and are not shown above — regenerate the plan.
        </p>
      )}
    </div>
  );
};

export default CratePackingSchedule;
