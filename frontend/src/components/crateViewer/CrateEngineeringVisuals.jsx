/**
 * Presentation layer — engineering-board SVG visuals for crate optimization viewer.
 * Logic-free: receives precomputed layers, pieces, dimensions, metrics.
 */
import React from 'react';
import { fmt } from '../DraftCrateWorkspace';
import { islandDepthStack, parseThicknessIn } from '../../utils/cratePhysicalLayout';
import { pieceKey } from '../../utils/crateOptimizationEngine';

const COS30 = 0.866;
const SIN30 = 0.5;
const WOOD = '#c4a574';
const WOOD_DARK = '#6b4423';
const WOOD_DEEP = '#4a2f18';
const FOAM = '#fef9c3';
const FOAM_EDGE = '#ca8a04';
const GRANITE_A = '#cbd5e1';
const GRANITE_B = '#94a3b8';
const GRANITE_EDGE = '#475569';
const BOARD_BG = '#d4d8dc';
const INK = '#1e293b';
const INK_MUTED = '#475569';

function pieceFaceDims(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 1;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short, thick: parseThicknessIn(piece.thickness) };
}

function iso(cx, cy, x, y, z, k) {
  return {
    x: cx + (x - z) * COS30 * k,
    y: cy - y * k + (x + z) * SIN30 * k,
  };
}

function drawBox(g, cx, cy, x, y, z, w, h, d, k, fill, stroke, label) {
  const p = [
    iso(cx, cy, x, y, z, k),
    iso(cx, cy, x + w, y, z, k),
    iso(cx, cy, x + w, y, z + d, k),
    iso(cx, cy, x, y, z + d, k),
    iso(cx, cy, x, y + h, z, k),
    iso(cx, cy, x + w, y + h, z, k),
    iso(cx, cy, x + w, y + h, z + d, k),
    iso(cx, cy, x, y + h, z + d, k),
  ];
  const face = (i0, i1, i2, i3, f, s) => (
    <polygon key={`${x}-${y}-${z}-${i0}`} points={`${p[i0].x},${p[i0].y} ${p[i1].x},${p[i1].y} ${p[i2].x},${p[i2].y} ${p[i3].x},${p[i3].y}`} fill={f} stroke={s} strokeWidth="0.8" />
  );
  g.push(face(0, 1, 5, 4, fill, stroke));
  g.push(face(1, 2, 6, 5, fill, stroke));
  g.push(face(4, 5, 6, 7, fill, stroke));
  if (label) {
    const c = { x: (p[4].x + p[6].x) / 2, y: (p[4].y + p[6].y) / 2 };
    g.push(
      <text key={`lbl-${label}`} x={c.x} y={c.y} textAnchor="middle" fontSize="9" fontWeight="700" fill={INK}>
        {label}
      </text>,
    );
  }
}

function DimArrow({ x1, y1, x2, y2, label, sub }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="1.2" markerEnd="url(#dimEnd)" markerStart="url(#dimStart)" />
      <rect x={mx - 70} y={my - 22} width={140} height={sub ? 28 : 16} fill="white" fillOpacity="0.94" stroke="#cbd5e1" rx="2" />
      <text x={mx} y={my - (sub ? 4 : 2)} textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>{label}</text>
      {sub && <text x={mx} y={my + 10} textAnchor="middle" fontSize="8" fill={INK_MUTED}>{sub}</text>}
    </g>
  );
}

/** Embedded metrics spec sheet (reference-style, on the board). */
export function BoardMetricsSpec({ preview, crateId, gapIn, island, stackSteps }) {
  const m = preview.metrics;
  const d = preview.dimensions;
  const met = m.weightOptimizationMet;

  return (
    <div className="pointer-events-none select-none rounded border-2 border-slate-400/80 bg-slate-100/95 p-3 shadow-lg backdrop-blur-sm text-[11px] leading-snug text-slate-800 font-mono min-w-[200px]">
      <div className="text-[9px] font-bold tracking-[0.2em] text-slate-500 border-b border-slate-300 pb-1 mb-2">
        OPTIMIZATION METRICS · {crateId}
      </div>
      <div className="space-y-1">
        <div><span className="text-slate-500">TOTAL PARTS</span> <b>{m.partCount}</b></div>
        <div><span className="text-slate-500">SLAB COUNT</span> <b>{m.slabCount}</b></div>
        <div><span className="text-slate-500">SLAB WEIGHT</span> <b>{fmt(m.slabWeightKg)} kg</b></div>
        <div><span className="text-slate-500">CRATE TARE</span> <b>{fmt(m.estimatedCrateWeightKg)} kg</b></div>
        <div className="border-t border-slate-300 pt-1">
          <span className="text-slate-500">TOTAL WEIGHT</span> <b className="text-sm">{fmt(m.totalCrateWeightKg)} kg</b>
        </div>
        <div>
          <span className="text-slate-500">UTILIZATION</span>{' '}
          <b className={m.utilizationPct > 100 ? 'text-red-700' : 'text-emerald-700'}>{fmt(m.utilizationPct)}%</b>
          <span className="text-slate-400"> / {fmt(m.targetWeightKg)} kg</span>
        </div>
        <div className={`mt-2 text-center py-1 font-bold text-xs tracking-wide ${met ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
          WEIGHT OPTIMIZATION: {met ? 'MET' : 'REVIEW'}
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-slate-300 space-y-0.5 text-[10px]">
        <div><span className="text-slate-500">INT</span> {fmt(d.internal_length)} × {fmt(d.internal_width)} × {fmt(d.internal_height)}″</div>
        <div><span className="text-slate-500">EXT</span> {fmt(d.external_length)} × {fmt(d.external_width)} × {fmt(d.external_height)}″</div>
        <div><span className="text-slate-500">STACK H</span> {fmt(d.internal_height)}″</div>
        {!island && <div><span className="text-slate-500">SPACER</span> {fmt(gapIn)}″ foam</div>}
        <div><span className="text-slate-500">FORKLIFT</span> 7″ clearance</div>
      </div>
      {!island && stackSteps?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-300">
          <div className="text-[9px] font-bold text-slate-500 mb-1">FACTORY STACK</div>
          {stackSteps.filter((s) => s.kind === 'layer').map((s) => (
            <div key={s.step} className={`text-[9px] font-semibold ${s.present ? 'text-slate-800' : 'text-slate-400'}`}>
              L{s.step} {s.title}{s.present && s.layer ? ` (${s.layer.pieces.length})` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Large hero engineering board — open-bay isometric with visible contents. */
export function EngineeringHeroBoard({ preview, layers, pieces, crateId, gapIn, island }) {
  const dims = preview.dimensions || {};
  const vbW = 1000;
  const vbH = 680;
  const cx = 340;
  const cy = 420;
  const k = island ? 2.8 : 2.4;

  const intL = dims.internal_length || 100;
  const intW = dims.internal_width || 14;
  const intH = dims.internal_height || 12;
  const forkH = 7;
  const palletH = 4;

  const content = [];

  // Floor / pallet
  const pal = [
    iso(cx, cy, 0, 0, 0, k),
    iso(cx, cy, intL + 8, 0, 0, k),
    iso(cx, cy, intL + 8, 0, intW + 4, k),
    iso(cx, cy, 0, 0, intW + 4, k),
  ];
  content.push(
    <polygon key="pallet" points={pal.map((p) => `${p.x},${p.y}`).join(' ')} fill={WOOD} stroke={WOOD_DARK} strokeWidth="2" />,
  );
  // Pallet runners
  for (let r = 0; r < 3; r += 1) {
    const z = (intW + 4) * (r + 0.5) / 3;
    drawBox(content, cx, cy, -2, -forkH, z - 1.5, intL + 12, forkH, 2.5, k, WOOD_DARK, WOOD_DEEP, null);
  }

  // Forklift tines hint
  content.push(
    <rect key="tine" x={pal[0].x - 30} y={pal[0].y + 8} width={intL * k * 0.35} height={forkH * k * 0.6} fill="#334155" opacity="0.85" rx="2" />,
  );

  const yBase = palletH;
  const stoneGrad = 'url(#graniteGrad)';

  if (island) {
    const ordered = islandDepthStack(pieces);
    let z = 2;
    const slabH = Math.min(55, (intH - palletH) * k * 0.85);
    ordered.forEach((p, i) => {
      const thick = Math.max(pieceFaceDims(p).thick * k * 2.2, 5);
      drawBox(
        content,
        cx,
        cy,
        8,
        yBase,
        z,
        intL * 0.88,
        slabH,
        thick,
        k,
        stoneGrad,
        GRANITE_EDGE,
        p.part_no || `#${i + 1}`,
      );
      z += thick / k + 0.4;
    });
    const stackCenter = iso(cx, cy, intL * 0.44, yBase + slabH * 0.5, intW * 0.5, k);
    content.push(
      <g key="stack-banner">
        <rect x={stackCenter.x - 72} y={stackCenter.y - 28} width={144} height={22} fill="white" fillOpacity="0.92" stroke={INK} strokeWidth="1.2" rx="2" />
        <text x={stackCenter.x} y={stackCenter.y - 13} textAnchor="middle" fontSize="11" fontWeight="800" fill={INK}>
          OPTIMIZED STACK: {ordered.length} SLABS
        </text>
      </g>,
    );
  } else {
    let y = yBase;
    layers.forEach((layer) => {
      if (layer.gapAfterIn > 0) {
        const gapH = Math.max(layer.gapAfterIn * k * 2.2, 3);
        drawBox(content, cx, cy, 6, y, 2, intL * 0.9, gapH, intW * 0.85, k, FOAM, FOAM_EDGE, null);
        y += layer.gapAfterIn * k * 0.9;
      }
      const layerH = Math.max(layer.heightIn * k * 2.8, 6);
      const n = layer.pieces.length || 1;
      const slotD = (intW * 0.85) / n;
      layer.pieces.forEach((p, i) => {
        const label = (p.part_no || '').slice(0, 10) || layer.label.slice(0, 8);
        drawBox(
          content,
          cx,
          cy,
          6,
          y,
          2 + i * slotD,
          intL * 0.88,
          layerH,
          slotD * 0.92,
          k,
          stoneGrad,
          GRANITE_EDGE,
          label,
        );
      });
      y += layerH / k;
    });
    const totalPieces = pieces.length;
    const sc = iso(cx, cy, intL * 0.42, yBase + (intH * 0.35) * k, intW * 0.45, k);
    content.push(
      <g key="content-banner">
        <rect x={sc.x - 80} y={sc.y - 12} width={160} height={20} fill="white" fillOpacity="0.93" stroke={INK} rx="2" />
        <text x={sc.x} y={sc.y + 2} textAnchor="middle" fontSize="10" fontWeight="800" fill={INK}>
          {totalPieces} PARTS IN CRATE
        </text>
      </g>,
    );
  }

  // Frame — corner posts & top rails
  const corners = [
    [0, 0, 0],
    [intL + 6, 0, 0],
    [intL + 6, 0, intW + 4],
    [0, 0, intW + 4],
  ];
  const topY = (island ? intH + palletH + 8 : intH + palletH + 6) * k;
  corners.forEach(([x, , z], i) => {
    const b = iso(cx, cy, x, yBase, z, k);
    const t = iso(cx, cy, x, yBase + topY / k, z, k);
    content.push(<line key={`post-${i}`} x1={b.x} y1={b.y} x2={t.x} y2={t.y} stroke={WOOD_DARK} strokeWidth="4" strokeLinecap="round" />);
  });
  // Diagonal brace (left face)
  const b1 = iso(cx, cy, 0, yBase, 0, k);
  const b2 = iso(cx, cy, 0, yBase + topY / k, intW + 4, k);
  content.push(<line key="brace" x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} stroke={WOOD_DEEP} strokeWidth="2" opacity="0.7" />);
  // Top frame
  corners.forEach(([x, , z], i) => {
    const next = corners[(i + 1) % 4];
    const a = iso(cx, cy, x, yBase + topY / k, z, k);
    const b = iso(cx, cy, next[0], yBase + topY / k, next[2], k);
    content.push(<line key={`rail-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={WOOD_DARK} strokeWidth="3" />);
  });

  const openLabel = iso(cx, cy, intL + 10, yBase + intH * 0.4, intW * 0.3, k);

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-full min-h-[520px]" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Engineering board ${crateId}`}>
      <defs>
        <marker id="dimEnd" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={INK} />
        </marker>
        <marker id="dimStart" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8 Z" fill={INK} />
        </marker>
        <linearGradient id="graniteGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="45%" stopColor={GRANITE_A} />
          <stop offset="100%" stopColor={GRANITE_B} />
        </linearGradient>
        <pattern id="woodPat" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={WOOD} />
          <path d="M0 6h12M6 0v12" stroke={WOOD_DARK} strokeWidth="0.5" opacity="0.35" />
        </pattern>
      </defs>
      <rect width={vbW} height={vbH} fill={BOARD_BG} />
      {/* board grid */}
      <path d={`M0 40 H${vbW} M40 0 V${vbH}`} stroke="#bcc3c9" strokeWidth="0.5" opacity="0.4" />

      <text x={vbW / 2} y={36} textAnchor="middle" fontSize="16" fontWeight="800" fill={INK} letterSpacing="0.14em">
        SMART CRATE PLANNING ENGINE
      </text>
      <text x={vbW / 2} y={56} textAnchor="middle" fontSize="12" fontWeight="600" fill={INK_MUTED} letterSpacing="0.08em">
        {island ? 'ISLAND OPTIMIZATION VIEW' : 'HORIZONTAL FLAT-LAY OPTIMIZATION VIEW'} · {crateId}
      </text>

      {content}

      <text x={openLabel.x} y={openLabel.y} fontSize="11" fontWeight="700" fill="#1d4ed8">
        LONG SIDE OPEN · LOAD AXIS {fmt(dims.internal_length)}″
      </text>

      <DimArrow x1={60} y1={vbH - 70} x2={60 + intL * k * 0.55} y2={vbH - 70} label={`PALLET LENGTH: ${fmt(dims.external_length)}″`} sub={`int ${fmt(dims.internal_length)}″`} />
      <DimArrow x1={vbW - 80} y1={120} x2={vbW - 80} y2={220} label={`EXT HEIGHT: ${fmt(dims.external_height)}″`} />
      <DimArrow x1={vbW - 200} y1={280} x2={vbW - 120} y2={320} label={`INT WIDTH: ${fmt(dims.internal_width)}″`} />
      <DimArrow x1={pal[0].x - 20} y1={pal[0].y + 20} x2={pal[0].x - 20} y2={pal[0].y - forkH * k} label="7″ FORKLIFT SPACE" />

      <text x={24} y={vbH - 16} fontSize="9" fill={INK_MUTED}>
        Scaled engineering schematic · spacer preview {fmt(gapIn)}″ · pieces shown at proportional thickness
      </text>
    </svg>
  );
}

/** Side cutaway — engineering section with piece labels. */
export function CutawayHeroBoard({ layers, pieces, island, footprint, gapIn }) {
  const vbW = 960;
  const vbH = 520;
  const pad = 48;
  const innerW = vbW - pad * 2 - 180;

  if (island) {
    const ordered = islandDepthStack(pieces);
    const totalD = ordered.reduce((s, p) => s + pieceFaceDims(p).thick, 0) + Math.max(0, ordered.length - 1) * 0.04;
    const scale = innerW / Math.max(totalD, 1);
    let x = pad + 40;
    const blocks = [];
    ordered.forEach((p, i) => {
      const w = Math.max(pieceFaceDims(p).thick * scale, 8);
      blocks.push(
        <g key={pieceKey(p, i)}>
          <rect x={x} y={100} width={w} height={280} fill="url(#graniteGrad)" stroke={GRANITE_EDGE} strokeWidth="1.5" />
          <rect x={x + 2} y={102} width={w - 4} height={8} fill="white" fillOpacity="0.35" />
          <text x={x + w / 2} y={92} textAnchor="middle" fontSize="9" fontWeight="700" fill={INK}>{p.part_no || `SLAB ${i + 1}`}</text>
          <text x={x + w / 2} y={400} textAnchor="middle" fontSize="9" fill={INK_MUTED}>{fmt(pieceFaceDims(p).thick)}″</text>
          <text x={x + w / 2} y={412} textAnchor="middle" fontSize="8" fill={INK_MUTED}>{fmt(pieceFaceDims(p).long)}″ L</text>
        </g>,
      );
      if (i < ordered.length - 1) {
        x += w + 2;
        blocks.push(<rect key={`film-${i}`} x={x} y={100} width={3} height={280} fill="#e0f2fe" stroke="#7dd3fc" />);
        x += 3;
      } else {
        x += w + 4;
      }
    });
    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full min-h-[400px]" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="graniteGrad" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor={GRANITE_B} />
          </linearGradient>
        </defs>
        <rect width={vbW} height={vbH} fill={BOARD_BG} />
        <text x={pad} y={36} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.1em">SIDE / CUTAWAY — DEPTH SECTION</text>
        <line x1={pad} y1={60} x2={vbW - pad} y2={60} stroke={INK} strokeWidth="1" />
        <rect x={pad} y={80} width={innerW + 60} height={320} fill="none" stroke={WOOD_DARK} strokeWidth="3" strokeDasharray="8 4" />
        {blocks}
        <DimArrow x1={pad} y1={440} x2={pad + innerW * 0.6} y2={440} label={`CASSETTE DEPTH: ${fmt(footprint.intW)}″`} />
        <text x={pad} y={480} fontSize="10" fill={INK_MUTED}>100µm poly film between polished faces · vertical edge stack</text>
      </svg>
    );
  }

  let y = vbH - pad - 60;
  const scaleY = 22;
  const blocks = [];
  [...layers].reverse().forEach((layer, idx) => {
    const gap = layer.gapAfterIn * scaleY;
    const h = Math.max(layer.heightIn * scaleY, 10);
    y -= gap;
    if (gap > 0) {
      blocks.push(
        <g key={`gap-${layer.id}`}>
          <rect x={pad + 30} y={y + h} width={innerW} height={gap} fill={FOAM} stroke={FOAM_EDGE} strokeWidth="1" strokeDasharray="5 3" />
          <text x={pad + innerW + 44} y={y + h + gap / 2 + 4} fontSize="10" fontWeight="700" fill={INK}>{fmt(layer.gapAfterIn)}″ FOAM</text>
        </g>,
      );
    }
    y -= h;
    const layerNum = layers.length - idx;
    blocks.push(
      <g key={layer.id}>
        <rect x={pad + 30} y={y} width={innerW} height={h} fill="url(#graniteGrad)" stroke={GRANITE_EDGE} strokeWidth="1.5" />
        {layer.pieces.map((p, i) => {
          const slotW = innerW / layer.pieces.length;
          return (
            <g key={pieceKey(p, i)}>
              <line x1={pad + 30 + i * slotW} y1={y} x2={pad + 30 + i * slotW} y2={y + h} stroke="white" strokeOpacity="0.5" />
              <text x={pad + 30 + i * slotW + slotW / 2} y={y + h / 2 + 3} textAnchor="middle" fontSize="8" fontWeight="600" fill={INK}>
                {p.part_no || '—'}
              </text>
            </g>
          );
        })}
        <text x={pad + innerW + 44} y={y + h / 2 + 4} fontSize="11" fontWeight="800" fill={INK}>
          L{layerNum} — {layer.label.toUpperCase()} · {fmt(layer.heightIn)}″
        </text>
      </g>,
    );
  });

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full min-h-[400px]" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="dimEnd" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={INK} />
        </marker>
        <marker id="dimStart" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8 Z" fill={INK} />
        </marker>
        <linearGradient id="graniteGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor={GRANITE_B} />
        </linearGradient>
      </defs>
      <rect width={vbW} height={vbH} fill={BOARD_BG} />
      <text x={pad} y={36} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.1em">SIDE / CUTAWAY — VERTICAL STACK SECTION</text>
      <line x1={pad + 20} y1={80} x2={pad + 20} y2={vbH - pad - 40} stroke={INK} strokeWidth="2" markerEnd="url(#dimEnd)" markerStart="url(#dimStart)" />
      <text x={pad} y={y + 20} fontSize="9" fill={INK_MUTED} transform={`rotate(-90 ${pad + 12} ${(80 + vbH - pad) / 2})`}>BOTTOM → TOP</text>
      {blocks}
      <DimArrow x1={pad} y1={vbH - 36} x2={pad + innerW * 0.5} y2={vbH - 36} label={`LENGTH (into page): ${fmt(footprint.intL)}″`} />
      <text x={pad + 30} y={68} fontSize="10" fill={INK_MUTED}>Spacer policy: {fmt(gapIn)}″ between layers</text>
    </svg>
  );
}

/** Factory stack board — exploded layers with dimension callouts. */
export function ExplodedFactoryBoard({ layers, pieces, island, gapIn, stackSteps, onReorderLayer }) {
  if (island) {
    const ordered = islandDepthStack(pieces);
    return (
      <div className="min-h-[400px] bg-[#d4d8dc] p-6">
        <h3 className="text-sm font-black tracking-[0.15em] text-slate-800 mb-4">EXPLODED DEPTH STACK · ISLAND CASSETTE</h3>
        <div className="flex flex-wrap gap-4 items-end justify-center">
          {ordered.map((p, i) => (
            <div key={pieceKey(p, i)} className="flex flex-col items-center">
              <div
                className="border-2 border-slate-600 bg-gradient-to-b from-slate-100 to-slate-400 shadow-md"
                style={{ width: 72, height: Math.max(pieceFaceDims(p).long * 0.9, 40) }}
              />
              <div className="mt-2 text-center text-[10px] font-bold text-slate-800">
                SLAB {i + 1}
                <div className="font-mono font-normal text-slate-600">{p.part_no}</div>
                <div>{fmt(pieceFaceDims(p).thick)}″ × {fmt(pieceFaceDims(p).long)}″</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[400px] bg-[#d4d8dc] p-6">
      <h3 className="text-sm font-black tracking-[0.15em] text-slate-800 mb-1">FACTORY STACK BOARD · EXPLODED VIEW</h3>
      <p className="text-[10px] text-slate-600 mb-5">Bottom → top · {fmt(gapIn)}″ foam between material layers</p>
      <div className="flex flex-col items-center gap-2 max-w-2xl mx-auto">
        {stackSteps.map((step) => {
          if (step.kind === 'spacer') {
            return (
              <div key={`sp-${step.step}`} className="w-full flex items-center gap-4">
                <div className="w-16 text-right text-[10px] font-black text-amber-800">L{step.step}</div>
                <div className="flex-1 h-8 border-2 border-dashed border-amber-500 bg-amber-100 flex items-center justify-center">
                  <span className="text-xs font-black tracking-wider text-amber-900">{step.title}</span>
                </div>
                <div className="w-20 text-[9px] text-slate-500 tabular-nums">{fmt(gapIn)}″ gap</div>
              </div>
            );
          }
          const layer = step.layer;
          if (!step.present || !layer) {
            return (
              <div key={step.title} className="w-full flex items-center gap-4 opacity-50">
                <div className="w-16 text-right text-[10px] font-black">L{step.step}</div>
                <div className="flex-1 h-14 border-2 border-dashed border-slate-400 bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                  {step.title} — EMPTY
                </div>
              </div>
            );
          }
          const idx = layers.findIndex((l) => l.id === layer.id);
          return (
            <div key={step.title} className="w-full flex items-start gap-4">
              <div className="w-16 text-right text-[10px] font-black text-slate-800 pt-3">L{step.step}</div>
              <div className="flex-1 border-2 border-slate-800 bg-white shadow-lg">
                <div className="bg-slate-800 text-white px-3 py-1.5 flex justify-between items-center">
                  <span className="text-xs font-black tracking-wide">{step.title}</span>
                  <span className="text-[10px] font-mono">{fmt(layer.heightIn)}″ · {layer.pieces.length} pc</span>
                  {onReorderLayer && idx >= 0 && (
                    <span className="flex gap-1 ml-2">
                      <button type="button" disabled={idx === 0} onClick={() => onReorderLayer(idx, -1)} className="bg-slate-600 px-1.5 rounded text-[10px] disabled:opacity-30">↑</button>
                      <button type="button" disabled={idx === layers.length - 1} onClick={() => onReorderLayer(idx, 1)} className="bg-slate-600 px-1.5 rounded text-[10px] disabled:opacity-30">↓</button>
                    </span>
                  )}
                </div>
                <div className="p-3 flex flex-wrap gap-2 justify-center bg-gradient-to-b from-slate-100 to-slate-300 min-h-[56px]">
                  {layer.pieces.map((p, i) => (
                    <div
                      key={pieceKey(p, i)}
                      className="border border-slate-500 bg-slate-200 px-2 py-2 text-center shadow-sm"
                      style={{ minWidth: 64, minHeight: Math.max(pieceFaceDims(p).thick * 14, 28) }}
                    >
                      <div className="text-[9px] font-bold text-slate-800">{p.part_no || '—'}</div>
                      <div className="text-[8px] text-slate-600">{fmt(p.length)}×{fmt(p.width)}″</div>
                      <div className="text-[8px] font-mono text-slate-500">{fmt(p.weight_kg)} kg</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-24 text-[9px] text-slate-600 pt-3 leading-tight">
                <div className="font-bold">THICKNESS</div>
                {fmt(layer.heightIn)}″ max
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
