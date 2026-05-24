import React, { useMemo, useState } from 'react';
import { fmt } from './DraftCrateWorkspace';
import {
  buildHorizontalStackLayers,
  crateFootprintFromPieces,
  flattenPiecesFromCrate,
  isIslandCrate,
  islandDepthStack,
  parseThicknessIn,
} from '../utils/cratePhysicalLayout';

const WOOD = '#92400e';
const WOOD_LIGHT = '#b45309';
const FOAM = '#f8fafc';
const FOAM_EDGE = '#cbd5e1';
const STONE = '#94a3b8';
const STONE_FACE = '#e2e8f0';
const STRAP = '#f1f5f9';
const PLASTIC = 'rgba(186, 230, 253, 0.35)';

const GAP_OPTIONS = [0.5, 1, 1.5, 2];

function pieceFaceDims(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 1;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short, thick: parseThicknessIn(piece.thickness) };
}

/** Front elevation — horizontal family (flat-lay stack seen through opening). */
function FrontViewHorizontal({ layers, footprint, crateId }) {
  const { intW, intH } = footprint;
  const vbW = 420;
  const pad = 28;
  const frameW = vbW - pad * 2;
  const palletH = 14;
  const lidH = 10;
  const innerH = frameW * 0.55;
  const scaleY = intH > 0 ? (innerH - palletH - lidH) / intH : 4;
  const scaleX = intW > 0 ? (frameW - 24) / intW : 4;
  const ox = pad + 12;
  const oy = pad + 16;
  let y = oy + innerH - palletH;

  const bands = [];
  for (const layer of layers) {
    y -= layer.gapAfterIn * scaleY;
    const h = Math.max(layer.heightIn * scaleY, 6);
    y -= h;
    bands.push({ layer, y, h });
  }

  return (
    <svg viewBox={`0 0 ${vbW} ${innerH + pad * 2 + 20}`} className="w-full max-h-[420px]" role="img" aria-label={`Crate ${crateId} front view`}>
      <defs>
        <pattern id="woodGrain" patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill={WOOD_LIGHT} />
          <path d="M0 4h8" stroke={WOOD} strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <linearGradient id="stoneGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      {/* A-frame / outer frame */}
      <rect x={pad} y={pad} width={frameW} height={innerH} fill="url(#woodGrain)" stroke={WOOD} strokeWidth="3" rx="4" />
      <path d={`M ${pad} ${pad} L ${pad + 10} ${pad + 8} L ${pad + frameW - 10} ${pad + 8} L ${pad + frameW} ${pad}`} fill={WOOD} opacity="0.9" />
      {/* Pallet */}
      <rect x={ox} y={oy + innerH - palletH} width={intW * scaleX} height={palletH} fill={WOOD} stroke={WOOD} strokeWidth="1" />
      {/* Foam liner sides */}
      <rect x={ox - 4} y={oy} width={4} height={innerH - palletH} fill={FOAM} stroke={FOAM_EDGE} />
      <rect x={ox + intW * scaleX} y={oy} width={4} height={innerH - palletH} fill={FOAM} stroke={FOAM_EDGE} />
      {bands.map(({ layer, y, h }) => (
        <g key={layer.id}>
          {layer.gapAfterIn > 0 && (
            <rect
              x={ox}
              y={y + h}
              width={intW * scaleX}
              height={layer.gapAfterIn * scaleY}
              fill={FOAM}
              stroke={FOAM_EDGE}
              strokeDasharray="2 2"
            />
          )}
          <rect x={ox} y={y} width={intW * scaleX} height={h} fill="url(#stoneGrad)" stroke={STONE} strokeWidth="1.5" rx="1" />
          <text x={ox + 4} y={y + h / 2 + 4} fontSize="9" fill="#334155" fontWeight="600">
            {layer.label}
          </text>
        </g>
      ))}
      {/* Plastic wrap overlay */}
      <rect x={pad + 4} y={pad + 4} width={frameW - 8} height={innerH - 8} fill={PLASTIC} stroke="none" pointerEvents="none" />
      {/* Straps */}
      <line x1={pad + frameW * 0.25} y1={pad} x2={pad + frameW * 0.25} y2={pad + innerH} stroke={STRAP} strokeWidth="4" />
      <line x1={pad + frameW * 0.75} y1={pad} x2={pad + frameW * 0.75} y2={pad + innerH} stroke={STRAP} strokeWidth="4" />
      <text x={pad} y={pad - 6} fontSize="10" fill="#64748b" fontWeight="600">
        Front view · opening {fmt(intW)}″ W × {fmt(intH)}″ H (scaled)
      </text>
    </svg>
  );
}

/** Front elevation — island vertical cassette (slab faces). */
function FrontViewIsland({ pieces, footprint, crateId }) {
  const ordered = islandDepthStack(pieces);
  const vbW = 420;
  const pad = 28;
  const frameW = vbW - pad * 2;
  const innerH = frameW * 0.55;
  const maxLong = Math.max(...ordered.map((p) => pieceFaceDims(p).long), 1);
  const totalDepth = ordered.reduce((s, p) => s + pieceFaceDims(p).thick, 0) + Math.max(0, ordered.length - 1) * 0.75;
  const scaleY = (innerH - 24) / maxLong;
  const scaleX = totalDepth > 0 ? (frameW - 40) / totalDepth : 8;
  const ox = pad + 20;
  const baseY = pad + innerH - 16;

  let x = ox;
  return (
    <svg viewBox={`0 0 ${vbW} ${innerH + pad * 2 + 20}`} className="w-full max-h-[420px]" role="img" aria-label={`Island crate ${crateId} front view`}>
      <rect x={pad} y={pad} width={frameW} height={innerH} fill="#fffbeb" stroke={WOOD} strokeWidth="3" rx="4" />
      <rect x={ox - 6} y={pad + 10} width={totalDepth * scaleX + 12} height={innerH - 20} fill={FOAM} stroke={FOAM_EDGE} opacity="0.9" />
      {ordered.map((p, i) => {
        const { long, thick } = pieceFaceDims(p);
        const w = thick * scaleX;
        const h = long * scaleY;
        const y = baseY - h;
        const el = (
          <g key={p.id ?? i}>
            <rect x={x} y={y} width={Math.max(w, 3)} height={h} fill={STONE_FACE} stroke={STONE} strokeWidth="1.2" />
            <text x={x + 2} y={y + 12} fontSize="7" fill="#475569">
              {(p.part_no || '').slice(0, 8)}
            </text>
          </g>
        );
        x += w + 0.75 * scaleX;
        return el;
      })}
      <rect x={pad + 4} y={pad + 4} width={frameW - 8} height={innerH - 8} fill={PLASTIC} stroke="none" />
      <text x={pad} y={pad - 6} fontSize="10" fill="#64748b" fontWeight="600">
        Island cassette · vertical slabs (front elevation, scaled)
      </text>
    </svg>
  );
}

/** Side cutaway — depth stack. */
function CutawayView({ layers, pieces, island, footprint }) {
  const vbW = 440;
  const vbH = 200;
  const pad = 16;
  if (island) {
    const ordered = islandDepthStack(pieces);
    const totalD = ordered.reduce((s, p) => s + pieceFaceDims(p).thick, 0);
    const scale = (vbW - pad * 2) / Math.max(totalD, 1);
    let x = pad;
    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full">
        <text x={pad} y={12} fontSize="10" fill="#64748b" fontWeight="600">Cutaway — depth (slabs on edge)</text>
        {ordered.map((p, i) => {
          const w = pieceFaceDims(p).thick * scale;
          const g = (
            <rect key={i} x={x} y={40} width={w} height={120} fill={STONE_FACE} stroke={STONE} />
          );
          x += w + 2;
          return g;
        })}
      </svg>
    );
  }

  let y = vbH - pad - 20;
  const scale = 8;
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full">
      <text x={pad} y={12} fontSize="10" fill="#64748b" fontWeight="600">Cutaway — vertical stack (bottom → top)</text>
      {[...layers].reverse().map((layer) => {
        const gap = layer.gapAfterIn * scale;
        const h = layer.heightIn * scale;
        y -= gap;
        y -= h;
        const ry = y;
        return (
          <g key={layer.id}>
            {gap > 0 && <rect x={pad} y={ry + h} width={200} height={gap} fill={FOAM} stroke={FOAM_EDGE} strokeDasharray="3 2" />}
            <rect x={pad} y={ry} width={200} height={h} fill={STONE_FACE} stroke={STONE} />
            <text x={pad + 210} y={ry + h / 2 + 4} fontSize="9" fill="#334155">{layer.label}</text>
          </g>
        );
      })}
      <text x={pad} y={vbH - 4} fontSize="9" fill="#94a3b8">Length axis into page ≈ {fmt(footprint.intL)}″</text>
    </svg>
  );
}

function ExplodedView({ layers, gapIn, onMoveLayer }) {
  return (
    <div className="space-y-3">
      {layers.map((layer, idx) => (
        <div
          key={layer.id}
          className="rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-[#0f172a]">Layer {idx + 1}: {layer.label}</div>
              <div className="text-[10px] text-[#64748b]">
                {layer.pieces.length} part(s) · thickness {fmt(layer.heightIn)}″
                {layer.gapAfterIn > 0 && ` · gap below ${fmt(layer.gapAfterIn)}″`}
              </div>
            </div>
            {onMoveLayer && (
              <div className="flex gap-1">
                <button type="button" disabled={idx === 0} onClick={() => onMoveLayer(idx, -1)} className="rounded border px-2 py-0.5 text-[10px] disabled:opacity-40">↑</button>
                <button type="button" disabled={idx === layers.length - 1} onClick={() => onMoveLayer(idx, 1)} className="rounded border px-2 py-0.5 text-[10px] disabled:opacity-40">↓</button>
              </div>
            )}
          </div>
          <ul className="mt-2 space-y-0.5 text-[10px] text-[#475569] max-h-24 overflow-y-auto">
            {layer.pieces.map((p, i) => (
              <li key={p.id ?? i}>
                {p.part || '—'} · {p.part_no || '—'} · {fmt(p.length)}×{fmt(p.width)}″ · {fmt(p.weight_kg)} kg
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[10px] text-[#94a3b8]">Spacer between layers: {fmt(gapIn)}″ foam (factory default 1″)</p>
    </div>
  );
}

/**
 * Warehouse-realistic crate viewer for draft saved crates.
 */
export default function CrateWarehouseViewer({
  crate,
  readOnly = true,
  onClose = null,
}) {
  const [mode, setMode] = useState('front');
  const [gapIn, setGapIn] = useState(1);
  const [layerOrder, setLayerOrder] = useState(null);

  const pieces = useMemo(() => flattenPiecesFromCrate(crate), [crate]);
  const island = isIslandCrate(crate);
  const footprint = useMemo(
    () => crateFootprintFromPieces(pieces, crate?.dimensions),
    [pieces, crate?.dimensions],
  );

  const baseLayers = useMemo(
    () => (island ? [] : buildHorizontalStackLayers(pieces, gapIn)),
    [pieces, gapIn, island],
  );

  const layers = layerOrder || baseLayers;

  const handleMoveLayer = (idx, dir) => {
    if (readOnly) return;
    const next = [...layers];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setLayerOrder(next);
  };

  if (!crate) return null;

  return (
    <div className="rounded-[24px] border border-[#dbe4f0] bg-[#f8fafc] shadow-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748b]">Visual crate viewer</div>
          <div className="text-lg font-semibold text-[#0f172a]">{crate.id}</div>
          <div className="text-xs text-[#64748b]">
            {fmt(crate.total_weight_kg)} kg · {crate.part_count} parts ·{' '}
            {island ? 'Island cassette' : 'Horizontal flat-lay'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!island && (
            <label className="flex items-center gap-2 text-xs text-[#475569]">
              Spacer
              <select
                value={gapIn}
                onChange={(e) => {
                  setGapIn(Number(e.target.value));
                  setLayerOrder(null);
                }}
                className="rounded-lg border border-[#e2e8f0] px-2 py-1 text-xs"
              >
                {GAP_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}″</option>
                ))}
              </select>
            </label>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-full border border-[#e2e8f0] bg-white px-4 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc]">
              Close
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-[#e2e8f0] bg-white px-4 pt-2">
        {[
          { id: 'front', label: 'Front view' },
          { id: 'cutaway', label: 'Side / cutaway' },
          { id: 'exploded', label: 'Exploded layers' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={`rounded-t-lg px-4 py-2 text-xs font-semibold transition-colors ${
              mode === t.id ? 'bg-[#eff6ff] text-[#1d4ed8] border border-b-0 border-[#bfdbfe]' : 'text-[#64748b] hover:bg-[#f8fafc]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 bg-white min-h-[280px]">
        {mode === 'front' && (
          island
            ? <FrontViewIsland pieces={pieces} footprint={footprint} crateId={crate.id} />
            : <FrontViewHorizontal layers={layers} footprint={footprint} crateId={crate.id} />
        )}
        {mode === 'cutaway' && (
          <CutawayView layers={layers} pieces={pieces} island={island} footprint={footprint} />
        )}
        {mode === 'exploded' && (
          island
            ? (
              <div className="text-sm text-[#64748b]">
                <p className="font-medium text-[#334155]">Island crates use vertical cassette depth stacking.</p>
                <ul className="mt-3 space-y-2 text-xs">
                  {islandDepthStack(pieces).map((p, i) => (
                    <li key={p.id ?? i} className="rounded-lg border border-[#e2e8f0] px-3 py-2">
                      Slab {i + 1}: {p.part} · {fmt(pieceFaceDims(p).thick)}″ thick · {fmt(pieceFaceDims(p).long)}″ long edge
                    </li>
                  ))}
                </ul>
              </div>
            )
            : <ExplodedView layers={layers} gapIn={gapIn} onMoveLayer={readOnly ? null : handleMoveLayer} />
        )}
      </div>

      <div className="border-t border-[#e2e8f0] bg-[#f8fafc] px-5 py-3 text-[10px] text-[#64748b]">
        Scaled schematic based on saved piece dimensions and factory stack order (tops → {gapIn}″ spacer → back splash → side splash).
        {!island && ' Length is driven by longest top — not splash run totals.'}
        {readOnly && ' Preview only — edit packing in Dispatch & build, then save plan.'}
      </div>
    </div>
  );
}
