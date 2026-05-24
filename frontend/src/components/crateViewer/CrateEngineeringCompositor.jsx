/**
 * ONE SVG engineering compositor — single poster board (Figures A / B / C).
 * Presentation only. All metrics, insets, and crate geometry live on this canvas.
 */
import React from 'react';
import { fmt } from '../DraftCrateWorkspace';
import { islandDepthStack, parseThicknessIn } from '../../utils/cratePhysicalLayout';
import { pieceKey } from '../../utils/crateOptimizationEngine';

const VB_W = 1200;
const VB_H = 920;
const BOARD = '#c8ccd0';
const INK = '#111';
const INK2 = '#3d3d3d';
const GREY_PANEL = '#aeb3b8';
const WOOD = '#b8956a';
const WOOD_D = '#4a3018';
const FOAM = '#fde68a';
const FOAM_EDGE = '#b45309';
const GRANITE = 'url(#granite)';
const GRANITE_TOP = 'url(#graniteTop)';
const COS30 = 0.866;
const SIN30 = 0.5;

function pieceFace(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 1;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short, thick: parseThicknessIn(piece.thickness) };
}

function iso(cx, cy, x, y, z, k) {
  return { x: cx + (x - z) * COS30 * k, y: cy - y * k + (x + z) * SIN30 * k };
}

function dimArrow(x1, y1, x2, y2, label, sub, key, w = 200) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const h = sub ? 32 : 18;
  return (
    <g key={key}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="1.2" markerEnd="url(#arrE)" markerStart="url(#arrS)" />
      <rect x={mx - w / 2} y={my - h / 2 - 2} width={w} height={h} fill="#e8ebee" fillOpacity="0.96" stroke="#555" strokeWidth="0.8" />
      <text x={mx} y={my + (sub ? -3 : 4)} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={INK}>{label}</text>
      {sub && <text x={mx} y={my + 12} textAnchor="middle" fontSize="7.5" fill={INK2}>{sub}</text>}
    </g>
  );
}

function leaderCallout(x, y, lx, ly, lines, key) {
  return (
    <g key={key}>
      <line x1={lx} y1={ly} x2={x} y2={y} stroke={INK} strokeWidth="0.8" />
      <circle cx={lx} cy={ly} r={3} fill={INK} />
      <rect x={lx - 4} y={ly - 38} width={118} height={lines.length * 11 + 8} fill="#fff" fillOpacity="0.95" stroke={INK} strokeWidth="0.8" />
      {lines.map((ln, i) => (
        <text key={ln} x={lx + 4} y={ly - 28 + i * 11} fontSize="7.5" fontWeight={i === 0 ? '700' : '400'} fill={INK}>{ln}</text>
      ))}
    </g>
  );
}

/** Isometric box — top + front + side faces with optional label + sub on top face. */
function drawIsoBox(g, cx, cy, x, y, z, w, h, d, k, opts = {}) {
  const { fill = GRANITE, stroke = '#334155', label, sub, foam = false } = opts;
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
  const poly = (idx, f, s, sw, id, op = 1) => (
    <polygon key={id} points={idx.map((i) => `${p[i].x},${p[i].y}`).join(' ')} fill={f} fillOpacity={op} stroke={s} strokeWidth={sw} />
  );
  const foamFill = foam ? 'url(#foamHatch)' : fill;
  g.push(poly([0, 1, 5, 4], foamFill, foam ? FOAM_EDGE : stroke, foam ? 1 : 0.9, `fr-${x}-${y}`));
  g.push(poly([1, 2, 6, 5], foam ? '#fcd34d' : '#64748b', stroke, 0.8, `sd-${x}-${y}`, foam ? 0.85 : 0.55));
  g.push(poly([4, 5, 6, 7], foamFill, foam ? FOAM_EDGE : stroke, foam ? 1.1 : 1, `tp-${x}-${y}`));
  if (label) {
    const c = { x: (p[4].x + p[6].x) / 2, y: (p[4].y + p[6].y) / 2 };
    g.push(<text key={`lb-${label}`} x={c.x} y={c.y - (sub ? 2 : 0)} textAnchor="middle" fontSize="9" fontWeight="800" fill={foam ? '#78350f' : INK}>{label}</text>);
    if (sub) g.push(<text key={`sub-${label}`} x={c.x} y={c.y + 9} textAnchor="middle" fontSize="7" fill={INK2}>{sub}</text>);
  }
}

function MetricsPanelSvg({ preview, crateId, gapIn, island, stackSteps, layers }) {
  const m = preview.metrics;
  const d = preview.dimensions;
  const met = m.weightOptimizationMet;
  const x = 838;
  const y = 68;
  const w = 332;
  const h = 318;
  const avgKg = m.slabCount > 0 ? m.slabWeightKg / m.slabCount : 0;

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={GREY_PANEL} fillOpacity="0.94" stroke="#555" strokeWidth="1.8" />
      <text x={x + 10} y={y + 16} fontSize="10" fontWeight="800" fill={INK} letterSpacing="0.08em">OPTIMIZATION DATA</text>
      <text x={x + w - 10} y={y + 16} textAnchor="end" fontSize="10" fontWeight="800" fill={INK}>{crateId}</text>
      <line x1={x + 6} y1={y + 22} x2={x + w - 6} y2={y + 22} stroke="#555" strokeWidth="1" />

      <text x={x + 10} y={y + 38} fontSize="9" fontFamily="monospace" fill={INK}>{island ? 'ISLAND DIMS' : 'CRATE DIMS'}: {fmt(d.internal_length)}×{fmt(d.internal_width)}×{fmt(d.internal_height)}″</text>
      <text x={x + 10} y={y + 52} fontSize="9" fontFamily="monospace" fill={INK}>TOTAL PARTS: {m.partCount}    SLABS/TOPS: {m.slabCount}</text>
      <text x={x + 10} y={y + 68} fontSize="9" fontFamily="monospace" fill={INK}>TOTAL SLAB WEIGHT:</text>
      <text x={x + 14} y={y + 80} fontSize="8" fontFamily="monospace" fill={INK2}>({m.slabCount} × ~{fmt(avgKg)} kg) ≈ {fmt(m.slabWeightKg)} kg</text>
      <text x={x + 10} y={y + 96} fontSize="9" fontFamily="monospace" fill={INK}>EST. CRATE TARE: {fmt(m.estimatedCrateWeightKg)} kg</text>
      <text x={x + 10} y={y + 112} fontSize="9.5" fontFamily="monospace" fontWeight="700" fill={INK}>TOTAL CRATE WEIGHT: ~{fmt(m.totalCrateWeightKg)} kg</text>
      <text x={x + 10} y={y + 128} fontSize="9" fontFamily="monospace" fill={INK}>UTILIZATION: {fmt(m.utilizationPct)}% (of {fmt(m.targetWeightKg)} kg max)</text>

      <rect x={x + 10} y={y + 136} width={w - 20} height={22} fill={met ? '#166534' : '#92400e'} stroke={INK} strokeWidth="0.8" />
      <text x={x + w / 2} y={y + 151} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">WEIGHT OPTIMIZATION: {met ? 'MET' : 'REVIEW'}</text>

      <text x={x + 10} y={y + 172} fontSize="8.5" fontFamily="monospace" fill={INK2}>INT {fmt(d.internal_length)} × {fmt(d.internal_width)} × {fmt(d.internal_height)}″</text>
      <text x={x + 10} y={y + 184} fontSize="8.5" fontFamily="monospace" fill={INK2}>EXT {fmt(d.external_length)} × {fmt(d.external_width)} × {fmt(d.external_height)}″</text>
      <text x={x + 10} y={y + 196} fontSize="8.5" fontFamily="monospace" fill={INK2}>STACK HEIGHT: {fmt(d.internal_height)}″</text>
      <text x={x + 10} y={y + 208} fontSize="8.5" fontFamily="monospace" fill={INK2}>{island ? 'SEPARATOR: 100µm poly film' : `SPACER: ${fmt(gapIn)}″ foam between layers`}</text>
      <text x={x + 10} y={y + 220} fontSize="8.5" fontFamily="monospace" fill={INK2}>FORKLIFT: 7″ clearance · long side open load</text>

      {!island && layers?.length > 0 && (
        <g>
          <text x={x + 10} y={y + 238} fontSize="8" fontWeight="700" fill={INK}>FACTORY STACK:</text>
          {layers.map((layer, i) => (
            <text key={layer.id} x={x + 14} y={y + 252 + i * 11} fontSize="7.5" fontFamily="monospace" fill={INK2}>
              L{i * 2 + 1} {layer.label.toUpperCase()} ({layer.pieces.length} pc · {fmt(layer.heightIn)}″)
            </text>
          ))}
        </g>
      )}
      {island && stackSteps?.length === 0 && (
        <text x={x + 10} y={y + 238} fontSize="8" fontFamily="monospace" fill={INK2}>Vertical edge stack · island-only cassette</text>
      )}
    </g>
  );
}

function HeroCrateFigure({ preview, layers, pieces, gapIn, island, dims }) {
  const cx = 300;
  const cy = 530;
  const k = island ? 3.5 : 3.15;
  const intL = dims.internal_length || 100;
  const intW = dims.internal_width || 14;
  const intH = dims.internal_height || 12;
  const forkH = 7;
  const palletH = 4;
  const nodes = [];

  const pal = [iso(cx, cy, 0, 0, 0, k), iso(cx, cy, intL + 10, 0, 0, k), iso(cx, cy, intL + 10, 0, intW + 6, k), iso(cx, cy, 0, 0, intW + 6, k)];
  nodes.push(<polygon key="pal" points={pal.map((p) => `${p.x},${p.y}`).join(' ')} fill="url(#woodPat)" stroke={WOOD_D} strokeWidth="2.5" />);
  for (let r = 0; r < 3; r += 1) {
    const z = (intW + 6) * (r + 0.5) / 3;
    drawIsoBox(nodes, cx, cy, -3, -forkH, z - 2, intL + 14, forkH, 3, k, { fill: WOOD_D, stroke: '#2d1810' });
  }
  nodes.push(
    <g key="fork">
      <rect x={pal[0].x - 40} y={pal[0].y + 4} width={intL * k * 0.4} height={forkH * k * 0.5} fill="#1e293b" rx="1" />
      <text x={pal[0].x - 44} y={pal[0].y + forkH * k * 0.35} fontSize="16" fill="#64748b">⎍</text>
    </g>,
  );

  const y0 = palletH;
  if (island) {
    const ordered = islandDepthStack(pieces);
    let z = 3;
    const slabH = Math.min(64, intH * k * 0.52);
    ordered.forEach((p, i) => {
      const pf = pieceFace(p);
      const thick = Math.max(pf.thick * k * 2.5, 6);
      drawIsoBox(nodes, cx, cy, 10, y0, z, intL * 0.9, slabH, thick, k, {
        label: p.part_no || `SL${i + 1}`,
        sub: `${fmt(pf.thick)}″ · ${fmt(pf.long)}″ L`,
      });
      z += thick / k + 0.3;
    });
    const sc = iso(cx, cy, intL * 0.42, y0 + slabH * 0.42, intW * 0.48, k);
    nodes.push(
      <g key="banner">
        <rect x={sc.x - 92} y={sc.y - 34} width={184} height={26} fill="#fff" fillOpacity="0.95" stroke={INK} strokeWidth="1.5" />
        <text x={sc.x} y={sc.y - 17} textAnchor="middle" fontSize="12" fontWeight="800" fill={INK}>OPTIMIZED STACK: {ordered.length} SLABS</text>
      </g>,
    );
    const callPt = iso(cx, cy, intL * 0.12, y0 + 18, intW * 0.15, k);
    nodes.push(leaderCallout(callPt.x, callPt.y, callPt.x - 70, callPt.y - 50, ['NO SEPARATORS', '100µm POLY FILM', 'polished faces'], 'poly'));
  } else {
    let y = y0;
    let layerIdx = 0;
    layers.forEach((layer) => {
      if (layer.gapAfterIn > 0) {
        const gh = Math.max(layer.gapAfterIn * k * 2.5, 5);
        drawIsoBox(nodes, cx, cy, 8, y, 3, intL * 0.92, gh, intW * 0.88, k, {
          foam: true,
          label: `${fmt(layer.gapAfterIn)}″ FOAM`,
          sub: 'spacer layer',
        });
        y += layer.gapAfterIn * k * 0.92;
      }
      const lh = Math.max(layer.heightIn * k * 3.2, 9);
      const n = Math.max(layer.pieces.length, 1);
      const slot = (intW * 0.88) / n;
      const layerTag = layer.type === 'main' ? 'TOPS' : layer.type === 'back_splash' ? 'BACK SPLASH' : layer.type === 'side_splash' ? 'SIDE SPLASH' : layer.label.toUpperCase();
      layer.pieces.forEach((p, i) => {
        const pf = pieceFace(p);
        drawIsoBox(nodes, cx, cy, 8, y, 3 + i * slot, intL * 0.9, lh, slot * 0.92, k, {
          label: p.part_no || '—',
          sub: `${fmt(pf.thick)}″ · ${fmt(pf.long)}×${fmt(pf.short)}″`,
        });
      });
      const lc = iso(cx, cy, intL * 0.02, y + lh * 0.35 / k, intW * 0.95, k);
      nodes.push(
        <text key={`lt-${layer.id}`} x={lc.x - 8} y={lc.y} fontSize="8" fontWeight="800" fill="#1e40af" transform={`rotate(-12 ${lc.x - 8} ${lc.y})`}>
          L{layerIdx * 2 + 1} {layerTag}
        </text>,
      );
      y += lh / k;
      layerIdx += 1;
    });
    const bc = iso(cx, cy, intL * 0.4, y0 + intH * 0.25, intW * 0.4, k);
    nodes.push(
      <g key="parts-banner">
        <rect x={bc.x - 70} y={bc.y - 10} width={140} height={18} fill="#fff" fillOpacity="0.92" stroke={INK} />
        <text x={bc.x} y={bc.y + 3} textAnchor="middle" fontSize="9" fontWeight="800">{pieces.length} PARTS · FLAT-LAY STACK</text>
      </g>,
    );
  }

  const corners = [[0, 0, 0], [intL + 8, 0, 0], [intL + 8, 0, intW + 6], [0, 0, intW + 6]];
  const topY = (intH + palletH + 10) * k;
  corners.forEach(([x, , z], i) => {
    const b = iso(cx, cy, x, y0, z, k);
    const t = iso(cx, cy, x, y0 + topY / k, z, k);
    nodes.push(<line key={`post-${i}`} x1={b.x} y1={b.y} x2={t.x} y2={t.y} stroke={WOOD_D} strokeWidth="5.5" strokeLinecap="round" />);
  });
  corners.forEach(([x, , z], i) => {
    const n = corners[(i + 1) % 4];
    const a = iso(cx, cy, x, y0 + topY / k, z, k);
    const b = iso(cx, cy, n[0], y0 + topY / k, n[2], k);
    nodes.push(<line key={`rail-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={WOOD_D} strokeWidth="4" />);
  });
  const b1 = iso(cx, cy, 0, y0, 0, k);
  const b2 = iso(cx, cy, 0, y0 + topY / k, intW + 6, k);
  nodes.push(<line key="brace" x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} stroke={WOOD_D} strokeWidth="2.5" opacity="0.8" />);
  nodes.push(<line key="brace2" x1={iso(cx, cy, intL + 8, y0, intW + 6, k).x} y1={iso(cx, cy, intL + 8, y0, intW + 6, k).y} x2={iso(cx, cy, intL + 8, y0 + topY / k, 0, k).x} y2={iso(cx, cy, intL + 8, y0 + topY / k, 0, k).y} stroke={WOOD_D} strokeWidth="2" opacity="0.65" />);

  const open = iso(cx, cy, intL + 14, y0 + intH * 0.32, intW * 0.32, k);
  return (
    <g>
      {nodes}
      <text x={open.x} y={open.y} fontSize="10.5" fontWeight="800" fill="#1d4ed8">THE LONG {fmt(dims.internal_length)}″ SIDE COMPLETELY OPEN · LOAD AXIS →</text>
      {dimArrow(36, VB_H - 128, 36 + intL * k * 0.6, VB_H - 128, `PALLET LENGTH: ${fmt(dims.external_length)}″`, `(${fmt(dims.internal_length)}″ slab + end clearance)`, 'dL', 240)}
      {dimArrow(748, 118, 748, 268, `EXTERNAL CRATE HEIGHT: ${fmt(dims.external_height)}″`, `stack ${fmt(dims.internal_height)}″ + frame`, 'dH', 220)}
      {dimArrow(580, 318, 680, 358, `INTERNAL WIDTH: ${fmt(dims.internal_width)}″`, island ? `${pieces.length} slabs depth` : 'short edge + pad', 'dW', 210)}
      {dimArrow(pal[0].x - 28, pal[0].y + 14, pal[0].x - 28, pal[0].y - forkH * k, '7″ FORKLIFT SPACE', 'mandatory tine clearance', 'dF', 180)}
      {dimArrow(520, 88, 620, 88, `STACK HEIGHT: ${fmt(dims.internal_height)}″`, 'internal material stack', 'dS', 190)}
      {!island && dimArrow(180, 200, 180, 320, `LAYER BUILD-UP`, `tops→${fmt(gapIn)}″→back→side`, 'dB', 160)}
    </g>
  );
}

function BottomInsets({ dims, island, pieceCount, layers, gapIn }) {
  const y = 742;
  return (
    <g>
      <rect x={28} y={y} width={268} height={152} fill="#dddfe3" stroke="#555" strokeWidth="1.2" />
      <text x={40} y={y + 16} fontSize="9.5" fontWeight="800" fill={INK}>PALLET BASE DETAIL</text>
      <rect x={52} y={y + 32} width={210} height={24} fill="url(#woodPat)" stroke={WOOD_D} />
      {[72, 142, 212].map((rx) => (
        <rect key={rx} x={rx} y={y + 62} width={32} height={58} fill={WOOD_D} stroke="#2d1810" strokeWidth="0.8" />
      ))}
      {dimArrow(52, y + 132, 252, y + 132, `LENGTH: ${fmt(dims.external_length)}″`, 'deck + 3 runners', 'pL', 180)}

      <rect x={312} y={y} width={300} height={152} fill="#dddfe3" stroke="#555" strokeWidth="1.2" />
      <text x={324} y={y + 16} fontSize="9.5" fontWeight="800" fill={INK}>OPERATIONAL NOTES</text>
      <text x={324} y={y + 36} fontSize="8.5" fill={INK2}>• Long side open — load / unload axis</text>
      <text x={324} y={y + 50} fontSize="8.5" fill={INK2}>• 7″ forklift clearance under pallet</text>
      <text x={324} y={y + 64} fontSize="8.5" fill={INK2}>{island ? '• Island slabs on edge · poly film between faces' : `• Flat-lay: Tops → ${fmt(gapIn)}″ foam → Back → Side`}</text>
      <text x={324} y={y + 78} fontSize="8.5" fill={INK2}>• Keep family units together · no cross-class merge</text>
      <text x={324} y={y + 96} fontSize="9" fontWeight="700" fill={INK}>PARTS IN CRATE: {pieceCount}</text>
      {!island && layers?.map((l, i) => (
        <text key={l.id} x={324} y={y + 112 + i * 11} fontSize="7.5" fontFamily="monospace" fill={INK2}>{l.label}: {l.pieces.length} pc</text>
      ))}

      <rect x={628} y={y} width={544} height={152} fill="#dddfe3" stroke="#555" strokeWidth="1.2" />
      <text x={640} y={y + 16} fontSize="9.5" fontWeight="800" fill={INK}>SECONDARY DETAIL · STACK SUMMARY</text>
      <text x={640} y={y + 38} fontSize="8.5" fontFamily="monospace" fill={INK2}>INT VOL {fmt(dims.internal_length)} × {fmt(dims.internal_width)} × {fmt(dims.internal_height)}″</text>
      <text x={640} y={y + 52} fontSize="8.5" fontFamily="monospace" fill={INK2}>EXT {fmt(dims.external_length)} × {fmt(dims.external_width)} × {fmt(dims.external_height)}″</text>
      <text x={640} y={y + 70} fontSize="9" fontWeight="700" fill={INK}>{island ? `Vertical cassette · ${pieceCount} slabs` : `Horizontal crate · ${pieceCount} parts`}</text>
      <g transform={`translate(900, ${y + 28})`}>
        <rect x={0} y={0} width={120} height={72} fill="none" stroke={WOOD_D} strokeWidth="1.5" />
        <rect x={8} y={48} width={104} height={8} fill={WOOD} stroke={WOOD_D} />
        {!island && (
          <>
            <rect x={12} y={38} width={96} height={6} fill="#94a3b8" opacity="0.7" />
            <rect x={12} y={30} width={96} height={4} fill={FOAM} stroke={FOAM_EDGE} />
            <rect x={12} y={22} width={96} height={4} fill="#64748b" opacity="0.6" />
            <rect x={12} y={16} width={40} height={4} fill="#64748b" opacity="0.5" />
          </>
        )}
        {island && [12, 28, 44, 60, 76].map((sx, i) => (
          <rect key={sx} x={sx} y={14} width={10} height={30} fill="#94a3b8" stroke="#475569" opacity={0.85 - i * 0.05} />
        ))}
        <text x={60} y={68} textAnchor="middle" fontSize="7" fill={INK2}>mini stack ref</text>
      </g>
    </g>
  );
}

function FigureSection({ layers, pieces, island, footprint, gapIn, dims }) {
  const pad = 72;
  const innerW = 540;
  const frameY = 152;
  const frameH = 380;
  if (island) {
    const ordered = islandDepthStack(pieces);
    let x = pad + 48;
    const blocks = [];
    ordered.forEach((p, i) => {
      const w = Math.max(pieceFace(p).thick * 30, 11);
      blocks.push(
        <g key={pieceKey(p, i)}>
          <rect x={x} y={frameY + 40} width={w} height={frameH - 60} fill={GRANITE} stroke="#334155" strokeWidth="1.5" />
          <rect x={x + 1} y={frameY + 41} width={w - 2} height={8} fill="#f1f5f9" opacity="0.5" />
          <text x={x + w / 2} y={frameY + 28} textAnchor="middle" fontSize="9" fontWeight="700">{p.part_no || `SLAB ${i + 1}`}</text>
          <text x={x + w / 2} y={frameY + frameH + 14} textAnchor="middle" fontSize="8">{fmt(pieceFace(p).thick)}″</text>
        </g>,
      );
      if (i < ordered.length - 1) {
        x += w + 2;
        blocks.push(<rect key={`f-${i}`} x={x} y={frameY + 40} width={3} height={frameH - 60} fill="#bae6fd" stroke="#38bdf8" />);
        x += 3;
      } else x += w + 4;
    });
    return (
      <g>
        <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE B — DEPTH SECTION</text>
        <rect x={pad} y={frameY} width={innerW + 90} height={frameH} fill="none" stroke={WOOD_D} strokeWidth="2.5" strokeDasharray="10 5" />
        {blocks}
        {dimArrow(pad, frameY + frameH + 36, pad + innerW * 0.55, frameY + frameH + 36, `CASSETTE DEPTH: ${fmt(footprint.intW)}″`, `${ordered.length} slabs + film`, 'sD', 210)}
        {dimArrow(pad + innerW + 100, frameY + 40, pad + innerW + 100, frameY + frameH, `HEIGHT: ${fmt(dims.internal_height)}″`, null, 'sH', 170)}
      </g>
    );
  }
  let y = frameY + frameH - 40;
  const sy = 26;
  const blocks = [];
  [...layers].reverse().forEach((layer, idx) => {
    const gap = layer.gapAfterIn * sy;
    const h = Math.max(layer.heightIn * sy, 14);
    y -= gap;
    if (gap > 0) {
      blocks.push(<rect key={`g-${layer.id}`} x={pad + 44} y={y + h} width={innerW} height={gap} fill="url(#foamHatch)" stroke={FOAM_EDGE} strokeWidth="1" />);
      blocks.push(<text key={`gt-${layer.id}`} x={pad + innerW + 58} y={y + h + gap / 2 + 4} fontSize="9" fontWeight="700">{fmt(layer.gapAfterIn)}″ FOAM</text>);
    }
    y -= h;
    blocks.push(
      <g key={layer.id}>
        <rect x={pad + 44} y={y} width={innerW} height={h} fill={GRANITE} stroke="#334155" strokeWidth="1.5" />
        {layer.pieces.map((p, i) => {
          const sw = innerW / layer.pieces.length;
          const pf = pieceFace(p);
          return (
            <g key={pieceKey(p, i)}>
              <line x1={pad + 44 + i * sw} y1={y} x2={pad + 44 + i * sw} y2={y + h} stroke="#fff" strokeOpacity="0.45" />
              <text x={pad + 44 + i * sw + sw / 2} y={y + h / 2 - 2} textAnchor="middle" fontSize="9" fontWeight="700">{p.part_no}</text>
              <text x={pad + 44 + i * sw + sw / 2} y={y + h / 2 + 9} textAnchor="middle" fontSize="7">{fmt(pf.thick)}″</text>
            </g>
          );
        })}
        <text x={pad + innerW + 58} y={y + h / 2 + 4} fontSize="10" fontWeight="800">L{layers.length - idx} {layer.label.toUpperCase()}</text>
      </g>,
    );
  });
  return (
    <g>
      <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE B — VERTICAL STACK SECTION</text>
      <line x1={pad + 24} y1={frameY} x2={pad + 24} y2={frameY + frameH} stroke={INK} strokeWidth="2" markerEnd="url(#arrE)" markerStart="url(#arrS)" />
      <text x={pad + 10} y={frameY + frameH / 2} fontSize="9" fill={INK2} transform={`rotate(-90 ${pad + 10} ${frameY + frameH / 2})`}>BOTTOM → TOP</text>
      {blocks}
      {dimArrow(pad, frameY + frameH + 36, pad + innerW * 0.5, frameY + frameH + 36, `LENGTH: ${fmt(footprint.intL)}″`, `${fmt(gapIn)}″ spacer policy`, 'sL', 210)}
    </g>
  );
}

function FigureExploded({ layers, stackSteps, gapIn, island, pieces, onReorderLayer, dims }) {
  const pad = 88;
  let y = 152;
  if (island) {
    const ordered = islandDepthStack(pieces);
    return (
      <g>
        <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE C — EXPLODED DEPTH STACK</text>
        {ordered.map((p, i) => {
          const pf = pieceFace(p);
          const h = Math.max(pf.long * 0.52, 38);
          const g = (
            <g key={pieceKey(p, i)}>
              <text x={pad + 4} y={y + h / 2 + 4} fontSize="10" fontWeight="800">SLAB {i + 1}</text>
              <rect x={pad + 56} y={y} width={500} height={h} fill={GRANITE} stroke="#334155" strokeWidth="2" />
              <text x={pad + 306} y={y + h / 2 - 2} textAnchor="middle" fontSize="10" fontWeight="700">{p.part_no}</text>
              <text x={pad + 306} y={y + h / 2 + 10} textAnchor="middle" fontSize="8">{fmt(pf.thick)}″ thick · {fmt(pf.long)}″ long edge</text>
              {dimArrow(pad + 570, y + 4, pad + 570, y + h - 4, `${fmt(pf.thick)}″`, null, `ed-${i}`, 80)}
            </g>
          );
          y += h + 18;
          return g;
        })}
      </g>
    );
  }
  const nodes = [<text key="t" x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE C — EXPLODED FACTORY STACK</text>];
  stackSteps.forEach((step) => {
    if (step.kind === 'spacer') {
      nodes.push(
        <g key={`sp-${step.step}`}>
          <text x={pad + 4} y={y + 14} fontSize="10" fontWeight="800">L{step.step}</text>
          <rect x={pad + 48} y={y} width={508} height={24} fill="url(#foamHatch)" stroke={FOAM_EDGE} strokeWidth="1.2" strokeDasharray="6 3" />
          <text x={pad + 302} y={y + 16} textAnchor="middle" fontSize="10" fontWeight="800">{step.title}</text>
          <text x={pad + 570} y={y + 16} fontSize="8">{fmt(gapIn)}″ gap</text>
        </g>,
      );
      y += 36;
      return;
    }
    const layer = step.layer;
    if (!step.present || !layer) {
      nodes.push(<text key={step.title} x={pad + 48} y={y + 16} fontSize="9" fill="#888">L{step.step} {step.title} — EMPTY</text>);
      y += 30;
      return;
    }
    const idx = layers.findIndex((l) => l.id === layer.id);
    const lh = Math.max(layer.heightIn * 20, 32);
    nodes.push(
      <g key={step.title}>
        <text x={pad + 4} y={y + lh / 2 + 4} fontSize="10" fontWeight="800">L{step.step}</text>
        <rect x={pad + 48} y={y} width={508} height={lh} fill={GRANITE} stroke={INK} strokeWidth="1.5" />
        {layer.pieces.map((p, i) => {
          const sw = 508 / layer.pieces.length;
          const pf = pieceFace(p);
          return (
            <g key={pieceKey(p, i)}>
              <line x1={pad + 48 + i * sw} y1={y} x2={pad + 48 + i * sw} y2={y + lh} stroke="#fff" strokeOpacity="0.4" />
              <text x={pad + 48 + i * sw + sw / 2} y={y + lh / 2 - 1} textAnchor="middle" fontSize="9" fontWeight="700">{p.part_no}</text>
              <text x={pad + 48 + i * sw + sw / 2} y={y + lh / 2 + 10} textAnchor="middle" fontSize="7">{fmt(pf.length)}×{fmt(pf.width)}″ · {fmt(pf.thick)}″</text>
            </g>
          );
        })}
        <text x={pad + 568} y={y + lh / 2 + 4} fontSize="9" fontWeight="700">{step.title}</text>
        <text x={pad + 568} y={y + lh / 2 + 16} fontSize="7">{fmt(layer.heightIn)}″ max</text>
        {onReorderLayer && idx >= 0 && (
          <g style={{ cursor: 'pointer' }}>
            <text x={pad + 568} y={y - 4} fontSize="9" fill="#1e40af" onClick={() => idx > 0 && onReorderLayer(idx, -1)}>[↑]</text>
            <text x={pad + 588} y={y - 4} fontSize="9" fill="#1e40af" onClick={() => idx < layers.length - 1 && onReorderLayer(idx, 1)}>[↓]</text>
          </g>
        )}
      </g>,
    );
    y += lh + 16;
  });
  nodes.push(<text key="note" x={pad} y={y + 16} fontSize="8.5" fill={INK2}>Exploded factory stack · {fmt(gapIn)}″ foam · bottom → top · ext H {fmt(dims.external_height)}″</text>);
  return <g>{nodes}</g>;
}

function ConstraintStripSvg({ validation }) {
  if (!validation.errors.length && !validation.warnings.length) return null;
  const y = 702;
  const msgs = [...validation.errors, ...validation.warnings].slice(0, 2);
  return (
    <g>
      <rect x={28} y={y} width={792} height={26} fill={validation.errors.length ? '#7f1d1d' : '#78350f'} fillOpacity="0.92" stroke={INK} strokeWidth="0.6" />
      <text x={40} y={y + 17} fontSize="8.5" fontWeight="700" fill="white">
        {validation.errors.length ? 'BLOCKING — APPLY DISABLED: ' : 'WARNING — APPLY ALLOWED: '}{msgs.join(' · ')}
      </text>
    </g>
  );
}

export default function CrateEngineeringCompositor({
  figure = 'A',
  preview,
  layers,
  pieces,
  crateId,
  gapIn,
  island,
  footprint,
  stackSteps,
  validation,
  onReorderLayer,
}) {
  const dims = preview.dimensions || {};
  const subtitle = island ? 'ISLAND OPTIMIZATION VIEW' : 'HORIZONTAL FLAT-LAY OPTIMIZATION VIEW';

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="w-full block min-h-[min(92vh,920px)]"
      style={{ background: BOARD }}
      role="img"
      aria-label={`Crate engineering board ${crateId} figure ${figure}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker id="arrE" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={INK} /></marker>
        <marker id="arrS" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 Z" fill={INK} /></marker>
        <linearGradient id="granite" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stopColor="#e2e8f0" /><stop offset="100%" stopColor="#64748b" /></linearGradient>
        <linearGradient id="graniteTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#f8fafc" /><stop offset="100%" stopColor="#94a3b8" /></linearGradient>
        <pattern id="woodPat" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill={WOOD} /><path d="M0 7h14M7 0v14" stroke={WOOD_D} strokeWidth="0.4" opacity="0.35" /></pattern>
        <pattern id="foamHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill={FOAM} /><line x1="0" y1="0" x2="0" y2="8" stroke={FOAM_EDGE} strokeWidth="1.5" /></pattern>
      </defs>
      <rect width={VB_W} height={VB_H} fill={BOARD} />
      <path d="M0 64 H1200 M64 0 V920" stroke="#a8adb2" strokeWidth="0.5" opacity="0.45" />

      <text x={VB_W / 2} y={28} textAnchor="middle" fontSize="17" fontWeight="800" fill={INK} letterSpacing="0.14em">SMART CRATE PLANNING ENGINE</text>
      <text x={VB_W / 2} y={48} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={INK2} letterSpacing="0.08em">{subtitle} · {crateId}</text>
      <text x={40} y={48} fontSize="10" fontWeight="800" fill={INK}>FIG {figure}</text>

      {figure === 'A' && <HeroCrateFigure preview={preview} layers={layers} pieces={pieces} gapIn={gapIn} island={island} dims={dims} />}
      {figure === 'B' && <FigureSection layers={layers} pieces={pieces} island={island} footprint={footprint} gapIn={gapIn} dims={dims} />}
      {figure === 'C' && <FigureExploded layers={layers} stackSteps={stackSteps} gapIn={gapIn} island={island} pieces={pieces} onReorderLayer={onReorderLayer} dims={dims} />}

      <MetricsPanelSvg preview={preview} crateId={crateId} gapIn={gapIn} island={island} stackSteps={stackSteps} layers={layers} />
      {figure === 'A' && <BottomInsets dims={dims} island={island} pieceCount={pieces.length} layers={layers} gapIn={gapIn} />}
      <ConstraintStripSvg validation={validation} />
    </svg>
  );
}
