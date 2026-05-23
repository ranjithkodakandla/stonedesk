import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from './DraftCrateWorkspace';
import {
  buildHorizontalStackLayers,
  crateFootprintFromPieces,
  islandDepthStack,
  parseThicknessIn,
} from '../utils/cratePhysicalLayout';
import {
  applyEditsToPlan,
  buildCanonicalStackSteps,
  cloneDraftCrates,
  deleteCrateFromPlan,
  flattenPiecesFromCrate,
  isCrateEmpty,
  isIslandCrate,
  listMovablePiecesFromOtherCrates,
  movePieceBetweenCrates,
  pieceKey,
  previewCrateFromEdits,
  removePieceFromCrate,
  reorderPiecesInCrate,
  validateEditPlan,
} from '../utils/crateOptimizationEngine';

const GAP_OPTIONS = [0.5, 1, 1.5, 2];
const WOOD = '#a16207';
const WOOD_DARK = '#78350f';
const FOAM = '#f1f5f9';
const FOAM_EDGE = '#94a3b8';
const STONE = '#64748b';
const STONE_LIGHT = '#e2e8f0';
const ACCENT = '#1d4ed8';

const STACK_LAYER_STYLE = {
  layer: 'bg-slate-800 text-white border-slate-900',
  spacer: 'bg-amber-100 text-amber-900 border-amber-300',
  empty: 'bg-slate-100 text-slate-400 border-dashed border-slate-300',
};

function pieceFaceDims(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 1;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short, thick: parseThicknessIn(piece.thickness) };
}

function DimLine({ x1, y1, x2, y2, label, offset = 0 }) {
  const mx = (x1 + x2) / 2 + offset;
  const my = (y1 + y2) / 2 + offset;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth="1" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <rect x={mx - 36} y={my - 8} width={72} height={14} fill="white" opacity="0.92" rx="2" />
      <text x={mx} y={my + 3} textAnchor="middle" fontSize="9" fill="#0f172a" fontWeight="600">{label}</text>
    </g>
  );
}

function StackOrderLegend({ stackSteps, compact = false }) {
  return (
    <div className={`rounded-xl border-2 border-[#0f172a] bg-white ${compact ? 'p-2' : 'p-3'} space-y-1.5`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#0f172a]">
        Factory stack order
      </div>
      {stackSteps.map((s) => (
        <div
          key={`${s.step}-${s.title}`}
          className={`flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 ${
            s.kind === 'spacer'
              ? STACK_LAYER_STYLE.spacer
              : s.present
                ? STACK_LAYER_STYLE.layer
                : STACK_LAYER_STYLE.empty
          }`}
        >
          <span className="text-[10px] font-black tabular-nums w-14 shrink-0">Layer {s.step}</span>
          <span className={`text-xs font-bold tracking-wide ${s.present ? '' : 'opacity-60'}`}>
            — {s.title}
            {!s.present && s.kind === 'layer' ? ' (empty)' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConstraintValidationPanel({ validation }) {
  if (!validation.errors.length && !validation.warnings.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
        All constraints satisfied — safe to apply (review warnings if any).
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {validation.errors.length > 0 && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-red-800 mb-1.5">
            Blocking errors — Apply disabled
          </div>
          <ul className="space-y-1 text-[11px] text-red-900">
            {validation.errors.map((e) => <li key={e}>• {e}</li>)}
          </ul>
        </div>
      )}
      {validation.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-900 mb-1.5">
            Warnings — Apply allowed
          </div>
          <ul className="space-y-1 text-[11px] text-amber-950">
            {validation.warnings.map((w) => <li key={w}>• {w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyCrateModal({ crateId, onDelete, onCancel }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-md w-full rounded-2xl border-2 border-[#f59e0b] bg-white p-6 shadow-2xl" role="dialog" aria-labelledby="empty-crate-title">
        <h3 id="empty-crate-title" className="text-lg font-bold text-[#0f172a]">Crate {crateId} is empty</h3>
        <p className="mt-2 text-sm text-[#475569]">
          All parts were removed from this crate. Empty crates are not kept in the saved plan.
          Delete the crate or cancel to restore the previous contents.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Delete Crate
          </button>
        </div>
      </div>
    </div>
  );
}

/** Engineering isometric crate — schematic, not photorealistic. */
function EngineeringMainView({ preview, layers, pieces, crateId, gapIn, stackSteps }) {
  const dims = preview.dimensions || {};
  const island = preview.island;
  const vbW = 520;
  const vbH = 340;
  const ox = 80;
  const oy = 200;
  const scale = island ? 1.15 : 0.85;
  const intL = (dims.internal_length || 48) * scale;
  const intW = (dims.internal_width || 14) * scale;
  const intH = (dims.internal_height || 40) * scale;
  const extL = (dims.external_length || intL + 8) * scale;
  const fork = 7 * scale;

  const iso = (x, y, z) => ({
    x: ox + (x - z) * 0.866,
    y: oy - y + (x + z) * 0.5,
  });

  const p000 = iso(0, 0, 0);
  const pL00 = iso(intL, 0, 0);
  const p0W0 = iso(0, intW, 0);
  const p0H0 = iso(0, 0, intH);
  const pLW0 = iso(intL, intW, 0);
  const pLWH = iso(intL, intW, intH);
  const p0WH = iso(0, intW, intH);
  const pL0H = iso(intL, 0, intH);

  const slabNodes = [];
  if (island) {
    const ordered = islandDepthStack(pieces);
    let z = 2;
    for (const p of ordered) {
      const { long, thick } = pieceFaceDims(p);
      const slabH = long * scale * 0.35;
      const slabT = thick * scale * 2.2;
      const a = iso(4, 2, z);
      const b = iso(4 + slabT, 2, z);
      const c = iso(4 + slabT, 2 + intW * 0.7, z);
      const d = iso(4, 2 + intW * 0.7, z);
      slabNodes.push(
        <polygon
          key={pieceKey(p)}
          points={`${a.x},${a.y - slabH} ${b.x},${b.y - slabH} ${c.x},${c.y - slabH} ${d.x},${d.y - slabH}`}
          fill={STONE_LIGHT}
          stroke={STONE}
          strokeWidth="1"
        />,
      );
      z += slabT + 0.5;
    }
  } else {
    let stackY = 6;
    for (const layer of layers) {
      stackY += layer.gapAfterIn * scale;
      const layerH = Math.max(layer.heightIn * scale * 2.5, 8);
      const a = iso(6, stackY, 4);
      const b = iso(6 + intL * 0.85, stackY, 4);
      const c = iso(6 + intL * 0.85, stackY + layerH, 4);
      const d = iso(6, stackY + layerH, 4);
      slabNodes.push(
        <g key={layer.id}>
          <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`} fill={STONE_LIGHT} stroke={STONE} strokeWidth="1" />
          <text x={(a.x + c.x) / 2} y={(a.y + c.y) / 2} fontSize="8" fill="#334155" textAnchor="middle">{layer.label}</text>
        </g>,
      );
      stackY += layerH;
    }
  }

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-full min-h-[300px]" role="img" aria-label={`Engineering view ${crateId}`}>
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#334155" />
        </marker>
        <pattern id="palletPat" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={WOOD} />
          <path d="M0 3h6M3 0v6" stroke={WOOD_DARK} strokeWidth="0.4" opacity="0.5" />
        </pattern>
      </defs>
      <text x={12} y={18} fontSize="11" fill="#64748b" fontWeight="700" letterSpacing="0.12em">
        SMART CRATE PLANNING · {crateId}
      </text>
      <text x={12} y={32} fontSize="9" fill="#94a3b8">
        {island ? 'Island cassette optimization view' : 'Horizontal flat-lay optimization view'}
      </text>

      {/* Pallet base */}
      <polygon
        points={`${p000.x},${p000.y} ${pL00.x},${pL00.y} ${pLW0.x},${pLW0.y} ${p0W0.x},${p0W0.y}`}
        fill="url(#palletPat)"
        stroke={WOOD_DARK}
        strokeWidth="1.5"
      />
      {/* Forklift clearance band */}
      <polygon
        points={`${p000.x},${p000.y} ${pL00.x},${pL00.y} ${pL0H.x},${pL0H.y} ${p0H0.x},${p0H0.y}`}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1"
        strokeDasharray="4 3"
        opacity="0.7"
      />
      <text x={pL0H.x - 40} y={pL0H.y + 14} fontSize="8" fill="#b45309">{fmt(7)}″ forklift space</text>

      {/* Crate frame edges */}
      <polygon points={`${p0H0.x},${p0H0.y} ${pL0H.x},${pL0H.y} ${pLWH.x},${pLWH.y} ${p0WH.x},${p0WH.y}`} fill="none" stroke={WOOD_DARK} strokeWidth="2.5" />
      <line x1={p000.x} y1={p000.y} x2={p0H0.x} y2={p0H0.y} stroke={WOOD_DARK} strokeWidth="2" />
      <line x1={pL00.x} y1={pL00.y} x2={pL0H.x} y2={pL0H.y} stroke={WOOD_DARK} strokeWidth="2" />
      <line x1={p0W0.x} y1={p0W0.y} x2={p0WH.x} y2={p0WH.y} stroke={WOOD_DARK} strokeWidth="2" />
      <line x1={pLW0.x} y1={pLW0.y} x2={pLWH.x} y2={pLWH.y} stroke={WOOD_DARK} strokeWidth="2" />
      {/* Open long side indicator */}
      <text x={pL0H.x + 8} y={pL0H.y - 8} fontSize="8" fill={ACCENT} fontWeight="600">
        Long side open · {fmt(dims.internal_length)}″ load axis
      </text>

      {slabNodes}

      <DimLine x1={12} y1={vbH - 48} x2={12 + extL * 0.5} y2={vbH - 48} label={`Ext L ${fmt(dims.external_length)}″`} />
      <DimLine x1={vbW - 120} y1={56} x2={vbW - 40} y2={90} label={`Int W ${fmt(dims.internal_width)}″`} offset={-6} />
      <DimLine x1={vbW - 200} y1={120} x2={vbW - 200} y2={60} label={`H ${fmt(dims.external_height)}″`} />

      <text x={12} y={vbH - 12} fontSize="8" fill="#94a3b8">
        Scaled schematic · spacer preview {fmt(gapIn)}″ · not photorealistic
      </text>
      {!island && stackSteps?.length > 0 && (
        <foreignObject x={vbW - 168} y={44} width={156} height={200}>
          <div xmlns="http://www.w3.org/1999/xhtml">
            <StackOrderLegend stackSteps={stackSteps} compact />
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function CutawayEngineeringView({ layers, pieces, island, footprint }) {
  const vbW = 480;
  const vbH = 220;
  const pad = 20;
  if (island) {
    const ordered = islandDepthStack(pieces);
    const totalD = ordered.reduce((s, p) => s + pieceFaceDims(p).thick, 0);
    const scale = (vbW - pad * 2) / Math.max(totalD, 1);
    let x = pad;
    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full">
        <text x={pad} y={16} fontSize="10" fill="#64748b" fontWeight="700">SIDE / CUTAWAY — depth & layering</text>
        {ordered.map((p, i) => {
          const w = Math.max(pieceFaceDims(p).thick * scale, 4);
          const g = (
            <g key={pieceKey(p, i)}>
              <rect x={x} y={48} width={w} height={130} fill={STONE_LIGHT} stroke={STONE} />
              <text x={x + 2} y={44} fontSize="7" fill="#475569" transform={`rotate(-45 ${x} 44)`}>
                {(p.part_no || p.part || '').slice(0, 12)}
              </text>
              <text x={x + w / 2} y={190} textAnchor="middle" fontSize="8" fill="#64748b">{fmt(pieceFaceDims(p).thick)}″</text>
            </g>
          );
          x += w + 3;
          return g;
        })}
        <text x={pad} y={210} fontSize="9" fill="#94a3b8">Poly film between faces · depth {fmt(footprint.intW)}″</text>
      </svg>
    );
  }

  let y = vbH - pad - 24;
  const scale = 10;
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full">
      <text x={pad} y={16} fontSize="10" fill="#64748b" fontWeight="700">SIDE / CUTAWAY — stack bottom → top</text>
      {[...layers].reverse().map((layer, idx) => {
        const gap = layer.gapAfterIn * scale;
        const h = Math.max(layer.heightIn * scale, 6);
        y -= gap;
        y -= h;
        const ry = y;
        return (
          <g key={layer.id}>
            {gap > 0 && (
              <rect x={pad} y={ry + h} width={240} height={gap} fill={FOAM} stroke={FOAM_EDGE} strokeDasharray="4 2" />
            )}
            <rect x={pad} y={ry} width={240} height={h} fill={STONE_LIGHT} stroke={STONE} />
            <text x={pad + 250} y={ry + h / 2 + 4} fontSize="9" fill="#0f172a" fontWeight="600">
              L{layers.length - idx}: {layer.label} · {fmt(layer.heightIn)}″
            </text>
          </g>
        );
      })}
      <text x={pad} y={vbH - 6} fontSize="9" fill="#94a3b8">Length into page ≈ {fmt(footprint.intL)}″</text>
    </svg>
  );
}

function ExplodedStackView({ layers, pieces, island, gapIn, stackSteps, onReorderLayer }) {
  if (island) {
    const ordered = islandDepthStack(pieces);
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#334155]">Exploded depth stack (front → back)</p>
        {ordered.map((p, i) => (
          <div key={pieceKey(p, i)} className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2">
            <span className="text-[10px] font-bold text-[#64748b] w-14">Slab {i + 1}</span>
            <div className="flex-1 text-xs text-[#334155]">
              {p.part || '—'} · {p.part_no || '—'} · {fmt(pieceFaceDims(p).thick)}″ thick · {fmt(pieceFaceDims(p).long)}″ long
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StackOrderLegend stackSteps={stackSteps} />
      {stackSteps.map((step) => {
        if (step.kind === 'spacer') {
          return (
            <div key={`spacer-${step.step}`} className={`rounded-lg border-2 px-3 py-3 text-center ${STACK_LAYER_STYLE.spacer}`}>
              <span className="text-sm font-black tracking-wider">Layer {step.step} — {step.title}</span>
            </div>
          );
        }
        const layer = step.layer;
        const idx = layer ? layers.findIndex((l) => l.id === layer.id) : -1;
        if (!step.present || !layer) {
          return (
            <div key={step.title} className={`rounded-xl border-2 px-3 py-4 ${STACK_LAYER_STYLE.empty}`}>
              <div className="text-sm font-black tracking-wide">Layer {step.step} — {step.title} (empty)</div>
            </div>
          );
        }
        return (
          <div key={step.title} className="rounded-xl border-2 border-[#0f172a] bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-black tracking-wide text-[#0f172a]">
                  Layer {step.step} — {step.title}
                </div>
                <div className="text-[10px] text-[#64748b] mt-0.5">
                  {layer.pieces.length} part(s) · {fmt(layer.heightIn)}″ thickness
                </div>
              </div>
              {onReorderLayer && idx >= 0 && (
                <div className="flex gap-1">
                  <button type="button" disabled={idx === 0} onClick={() => onReorderLayer(idx, -1)} className="rounded border px-2 py-0.5 text-[10px] disabled:opacity-40">↑</button>
                  <button type="button" disabled={idx === layers.length - 1} onClick={() => onReorderLayer(idx, 1)} className="rounded border px-2 py-0.5 text-[10px] disabled:opacity-40">↓</button>
                </div>
              )}
            </div>
            <ul className="mt-2 space-y-1 text-[10px] text-[#475569]">
              {layer.pieces.map((p, i) => (
                <li key={pieceKey(p, i)} className="font-mono">
                  {p.part_no || '—'} · {p.part} · {fmt(p.length)}×{fmt(p.width)}″ · {fmt(p.weight_kg)} kg
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MetricsPanel({ preview, crateId }) {
  const m = preview.metrics;
  const dims = preview.dimensions;
  const met = m.weightOptimizationMet;

  return (
    <div className="rounded-xl border border-[#dbe4f0] bg-white p-4 shadow-sm space-y-3 text-xs">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748b] font-semibold">Optimization metrics</div>
      <div className="font-mono text-sm font-bold text-[#0f172a]">{crateId}</div>
      <dl className="space-y-1.5 text-[#334155]">
        <div className="flex justify-between"><dt>Total parts</dt><dd className="font-semibold tabular-nums">{m.partCount}</dd></div>
        <div className="flex justify-between"><dt>Slab / top count</dt><dd className="font-semibold tabular-nums">{m.slabCount}</dd></div>
        <div className="flex justify-between"><dt>Slab weight</dt><dd className="font-semibold tabular-nums">{fmt(m.slabWeightKg)} kg</dd></div>
        <div className="flex justify-between"><dt>Est. crate tare</dt><dd className="font-semibold tabular-nums">{fmt(m.estimatedCrateWeightKg)} kg</dd></div>
        <div className="flex justify-between border-t border-[#f1f5f9] pt-2"><dt>Total crate weight</dt><dd className="font-bold tabular-nums">{fmt(m.totalCrateWeightKg)} kg</dd></div>
        <div className="flex justify-between"><dt>Target</dt><dd className="tabular-nums">{fmt(m.targetWeightKg)} kg</dd></div>
        <div className="flex justify-between"><dt>Utilization</dt><dd className="font-semibold tabular-nums">{fmt(m.utilizationPct)}%</dd></div>
      </dl>
      <div className={`rounded-lg px-3 py-2 text-center font-bold text-sm ${met ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
        Weight optimization: {met ? 'MET' : 'REVIEW'}
      </div>
      <div className="text-[10px] text-[#64748b] space-y-0.5">
        <div>Int {fmt(dims.internal_length)} × {fmt(dims.internal_width)} × {fmt(dims.internal_height)}″</div>
        <div>Ext {fmt(dims.external_length)} × {fmt(dims.external_width)} × {fmt(dims.external_height)}″</div>
      </div>
    </div>
  );
}

function PackingNotesPanel({ notes, warnings }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[#64748b] font-semibold mb-2">Packing notes</div>
        <ul className="space-y-1 text-[11px] text-[#475569] list-disc pl-4">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </div>
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-800 font-semibold mb-2">Warnings</div>
          <ul className="space-y-1 text-[11px] text-amber-900">
            {warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function PartsEditor({
  pieces,
  editCrates,
  activeCrateId,
  onRemove,
  onMoveToCrate,
  onAddFromPool,
  onReorderPiece,
  addPool,
}) {
  const otherCrates = editCrates.filter((c) => c.id !== activeCrateId);

  return (
    <div className="rounded-xl border border-[#dbe4f0] bg-white p-3 space-y-2 max-h-[420px] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-[#64748b] font-semibold">Crate contents (editable)</div>
      {pieces.length === 0 && (
        <p className="text-xs text-[#94a3b8]">No parts in this crate.</p>
      )}
      {pieces.map((p, i) => {
        const k = pieceKey(p, i);
        return (
          <div
            key={k}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', k)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const fromK = e.dataTransfer.getData('text/plain');
              if (fromK && fromK !== k) onReorderPiece(fromK, k);
            }}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1.5 text-[11px]"
          >
            <span className="cursor-grab text-[#94a3b8]" title="Drag to reorder">⋮⋮</span>
            <span className="flex-1 min-w-[120px] text-[#0f172a] font-medium truncate">
              {p.part_no || '—'} · {p.part}
            </span>
            <span className="text-[#64748b] tabular-nums">{fmt(p.weight_kg)} kg</span>
            <button type="button" onClick={() => onRemove(k)} className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-100">
              −
            </button>
            {otherCrates.length > 0 && (
              <select
                className="rounded border border-[#e2e8f0] text-[10px] py-0.5 max-w-[100px]"
                defaultValue=""
                onChange={(e) => {
                  const toId = e.target.value;
                  if (toId) onMoveToCrate(k, toId);
                  e.target.value = '';
                }}
              >
                <option value="">Move to…</option>
                {otherCrates.map((c) => (
                  <option key={c.id} value={c.id}>{c.id}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {addPool.length > 0 && (
        <div className="pt-2 border-t border-[#f1f5f9]">
          <label className="text-[10px] text-[#64748b] font-semibold">Add part from another crate</label>
          <select
            className="mt-1 w-full rounded-lg border border-[#e2e8f0] text-xs py-1.5"
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                const [fromId, key] = val.split('::');
                onAddFromPool(fromId, key);
                e.target.value = '';
              }
            }}
          >
            <option value="">+ Select part…</option>
            {addPool.map((p, i) => {
              const k = pieceKey(p, i);
              return (
                <option key={k} value={`${p._fromCrateId}::${k}`}>
                  {p._fromCrateId}: {p.part_no || p.part}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}

/**
 * Interactive engineering crate optimization viewer (Phase 1).
 * Preview edits locally; persist only via Apply to Plan.
 */
export default function CrateOptimizationViewer({
  crate,
  allCrates = [],
  targetWeightKg = 1900,
  onClose = null,
  onApplyPlan = null,
  onCrateDeleted = null,
  busy = false,
}) {
  const [mode, setMode] = useState('engineering');
  const [gapIn, setGapIn] = useState(1);
  const [editCrates, setEditCrates] = useState(() => cloneDraftCrates(allCrates.length ? allCrates : [crate]));
  const [layerOrderByCrateId, setLayerOrderByCrateId] = useState({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingEmpty, setPendingEmpty] = useState(null);
  const baselineRef = useRef({ crates: cloneDraftCrates(allCrates.length ? allCrates : [crate]), gapIn: 1 });

  const layerOrder = layerOrderByCrateId[crate?.id] ?? null;

  useEffect(() => {
    const baseline = cloneDraftCrates(allCrates.length ? allCrates : [crate]);
    baselineRef.current = { crates: baseline, gapIn: 1 };
    setEditCrates(baseline);
    setLayerOrderByCrateId({});
    setGapIn(1);
    setDirty(false);
    setMessage('');
    setPendingEmpty(null);
  }, [crate?.id]);

  const activeCrate = useMemo(
    () => editCrates.find((c) => c.id === crate?.id) || crate,
    [editCrates, crate],
  );

  const pieces = useMemo(() => flattenPiecesFromCrate(activeCrate), [activeCrate]);
  const island = isIslandCrate(activeCrate);

  const preview = useMemo(
    () => previewCrateFromEdits(activeCrate, pieces, gapIn, targetWeightKg),
    [activeCrate, pieces, gapIn, targetWeightKg],
  );

  const baseLayers = useMemo(
    () => (island ? [] : buildHorizontalStackLayers(pieces, gapIn)),
    [pieces, gapIn, island],
  );
  const layers = layerOrder || baseLayers;

  const stackSteps = useMemo(
    () => (island ? [] : buildCanonicalStackSteps(layers, gapIn)),
    [layers, gapIn, island],
  );

  const validation = useMemo(
    () => validateEditPlan(editCrates, targetWeightKg, {
      layerOrderByCrateId,
      gapInByCrateId: { [crate?.id]: gapIn },
    }),
    [editCrates, targetWeightKg, layerOrderByCrateId, crate?.id, gapIn],
  );

  const footprint = useMemo(
    () => crateFootprintFromPieces(pieces, preview.dimensions),
    [pieces, preview.dimensions],
  );

  const addPool = useMemo(
    () => listMovablePiecesFromOtherCrates(editCrates, crate?.id),
    [editCrates, crate?.id],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const handleRemove = (key) => {
    const prev = editCrates;
    const { crates: next, becameEmpty } = removePieceFromCrate(prev, crate.id, key);
    if (becameEmpty) {
      setPendingEmpty({ crateId: crate.id, rollback: prev });
    }
    setEditCrates(next);
    markDirty();
    setMessage(becameEmpty ? 'Crate is empty — confirm delete or cancel.' : 'Part removed (preview).');
  };

  const handleMoveToCrate = (key, toId) => {
    const prev = editCrates;
    const res = movePieceBetweenCrates(editCrates, crate.id, toId, key);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    if (res.sourceEmpty) {
      setPendingEmpty({ crateId: crate.id, rollback: prev });
    }
    setEditCrates(res.crates);
    markDirty();
    setMessage(res.sourceEmpty ? 'Crate is empty — confirm delete or cancel.' : `Moved to ${toId} (preview).`);
  };

  const handleAddFromPool = (fromId, key) => {
    const res = movePieceBetweenCrates(editCrates, fromId, crate.id, key);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    if (res.sourceEmpty && fromId !== crate.id) {
      setMessage(`Part added — source crate ${fromId} is now empty (delete or restore from that crate).`);
    } else {
      setMessage('Part added (preview).');
    }
    setEditCrates(res.crates);
    markDirty();
  };

  const handleReorderPiece = (fromKey, toKey) => {
    const keys = pieces.map((p, i) => pieceKey(p, i));
    const fi = keys.indexOf(fromKey);
    const ti = keys.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    const next = [...keys];
    const [item] = next.splice(fi, 1);
    next.splice(ti, 0, item);
    setEditCrates((prev) => reorderPiecesInCrate(prev, crate.id, next));
    markDirty();
  };

  const handleMoveLayer = (idx, dir) => {
    const next = [...layers];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setLayerOrderByCrateId((prev) => ({ ...prev, [crate.id]: next }));
    markDirty();
    setMessage('Layer order changed — factory stack order must remain Tops → Back → Side.');
  };

  const handleEmptyDelete = () => {
    const id = pendingEmpty?.crateId || crate.id;
    const next = deleteCrateFromPlan(editCrates, id);
    setEditCrates(next);
    setPendingEmpty(null);
    markDirty();
    setMessage(`Crate ${id} marked for removal — apply to persist.`);
    if (id === crate.id && onCrateDeleted) onCrateDeleted(id);
  };

  const handleEmptyCancel = () => {
    if (pendingEmpty?.rollback) {
      setEditCrates(pendingEmpty.rollback);
    }
    setPendingEmpty(null);
    setMessage('Restored previous crate contents.');
  };

  const handleApply = async () => {
    if (!onApplyPlan || !validation.canApply || pendingEmpty) return;
    const applied = applyEditsToPlan(editCrates);
    const ok = await onApplyPlan(applied);
    if (ok !== false) {
      baselineRef.current = { crates: cloneDraftCrates(applied), gapIn };
      setDirty(false);
      setMessage('Changes applied to saved plan.');
    }
  };

  const handleDiscard = () => {
    const { crates: baseline, gapIn: baselineGap } = baselineRef.current;
    setEditCrates(cloneDraftCrates(baseline));
    setLayerOrderByCrateId({});
    setGapIn(baselineGap);
    setPendingEmpty(null);
    setDirty(false);
    setMessage('Edits discarded — restored snapshot from when viewer opened.');
  };

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm(
        'You have unsaved preview edits. Close without applying? The saved plan will not change.',
      );
      if (!ok) return;
    }
    onClose?.();
  };

  const canApply = dirty && validation.canApply && !pendingEmpty && !busy && onApplyPlan;

  if (!crate) return null;

  return (
    <div className="rounded-[24px] border-2 border-[#bfdbfe] bg-[#f0f9ff] shadow-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#93c5fd] bg-white px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#1d4ed8] font-semibold">
            Interactive crate optimization
          </div>
          <div className="text-xl font-bold text-[#0f172a]">{crate.id}</div>
          <div className="text-xs text-[#64748b]">
            {preview.metrics.partCount} parts · {fmt(preview.metrics.totalCrateWeightKg)} kg total ·{' '}
            {island ? 'Island cassette' : 'Horizontal flat-lay'}
            {dirty && <span className="ml-2 text-amber-600 font-semibold">· Unsaved preview</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!island && (
            <label className="flex items-center gap-2 text-xs text-[#475569] bg-[#f8fafc] rounded-lg px-2 py-1 border border-[#e2e8f0]">
              Spacer override
              <select
                value={gapIn}
                onChange={(e) => {
                  setGapIn(Number(e.target.value));
                  setLayerOrder(null);
                  markDirty();
                }}
                className="rounded border border-[#e2e8f0] px-2 py-0.5 text-xs font-semibold"
              >
                {GAP_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}″</option>
                ))}
              </select>
            </label>
          )}
          {onClose && (
            <button type="button" onClick={handleClose} className="rounded-full border border-[#e2e8f0] bg-white px-4 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc]">
              Close
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(220px,280px)_1fr_minmax(200px,240px)] gap-0 border-b border-[#dbe4f0]">
        <div className="p-4 border-r border-[#e2e8f0] bg-[#f8fafc]">
          <PartsEditor
            pieces={pieces}
            editCrates={editCrates}
            activeCrateId={crate.id}
            onRemove={handleRemove}
            onMoveToCrate={handleMoveToCrate}
            onAddFromPool={handleAddFromPool}
            onReorderPiece={handleReorderPiece}
            addPool={addPool}
          />
        </div>

        <div className="bg-white min-h-[360px]">
          <div className="flex gap-1 border-b border-[#e2e8f0] px-3 pt-2 bg-[#f8fafc]">
            {[
              { id: 'engineering', label: 'Engineering view' },
              { id: 'cutaway', label: 'Side / cutaway' },
              { id: 'exploded', label: 'Exploded stack' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                className={`rounded-t-lg px-3 py-2 text-[11px] font-semibold ${
                  mode === t.id ? 'bg-white text-[#1d4ed8] border border-b-0 border-[#bfdbfe]' : 'text-[#64748b]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {mode === 'engineering' && (
              <EngineeringMainView
                preview={preview}
                layers={layers}
                pieces={pieces}
                crateId={crate.id}
                gapIn={gapIn}
                stackSteps={stackSteps}
              />
            )}
            {mode === 'cutaway' && (
              <CutawayEngineeringView layers={layers} pieces={pieces} island={island} footprint={footprint} />
            )}
            {mode === 'exploded' && (
              <ExplodedStackView
                layers={layers}
                pieces={pieces}
                island={island}
                gapIn={gapIn}
                stackSteps={stackSteps}
                onReorderLayer={island ? null : handleMoveLayer}
              />
            )}
          </div>
        </div>

        <div className="p-4 border-l border-[#e2e8f0] bg-[#f8fafc] space-y-3">
          <ConstraintValidationPanel validation={validation} />
          <MetricsPanel preview={preview} crateId={crate.id} />
          <PackingNotesPanel notes={preview.packingNotes} warnings={preview.warnings} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe4f0] bg-white px-5 py-3">
        <p className="text-[10px] text-[#64748b] max-w-xl">
          {message || 'Live preview — dimensions and weight recalculate on every edit. Spacer changes are visual overrides until you apply.'}
          {' '}
          Optimizer output is unchanged until <strong>Apply to Plan</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={handleDiscard}
            className="rounded-full border border-[#e2e8f0] px-4 py-1.5 text-xs font-semibold text-[#475569] disabled:opacity-40"
          >
            Discard edits
          </button>
          <button
            type="button"
            disabled={!canApply}
            title={
              !validation.canApply
                ? 'Resolve blocking errors before applying'
                : pendingEmpty
                  ? 'Confirm empty crate action first'
                  : ''
            }
            onClick={handleApply}
            className="rounded-full border border-[#1d4ed8] bg-[#1d4ed8] px-5 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-40"
          >
            Apply to Plan
          </button>
        </div>
      </div>

      {pendingEmpty && (
        <EmptyCrateModal
          crateId={pendingEmpty.crateId}
          onDelete={handleEmptyDelete}
          onCancel={handleEmptyCancel}
        />
      )}
    </div>
  );
}
