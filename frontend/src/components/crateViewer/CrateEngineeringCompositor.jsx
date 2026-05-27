/**
 * ONE SVG engineering compositor — single poster board (Figures A / B / C).
 * Presentation only. Leaning-supported load geometry for all categories.
 */
import React from 'react';
import { fmt } from '../DraftCrateWorkspace';
import { islandDepthStack, parseThicknessIn } from '../../utils/cratePhysicalLayout';
import { pieceKey } from '../../utils/crateOptimizationEngine';
import {
  LEAN_DEG,
  LEAN_TAN,
  iso,
  packingPattern,
  patternBanner,
  patternSubtitle,
  drawLeaningSlab,
  drawFoamSheet,
  drawLeanSectionPanel,
} from './leanSceneHelpers';

const VB_W = 1200;
const VB_H = 920;
const BOARD = '#c8ccd0';
const INK = '#111';
const INK2 = '#444';
const GREY_PANEL = '#aeb3b8';
const WOOD = '#b8956a';
const WOOD_D = '#4a3018';
const FOAM = '#fde68a';
const FOAM_EDGE = '#b45309';
const GRANITE = 'url(#granite)';

function pieceFace(piece) {
  const L = parseFloat(piece.length) || 0;
  const W = parseFloat(piece.width) || 0;
  const long = Math.max(L, W) || 1;
  const short = L > 0 && W > 0 ? Math.min(L, W) : long;
  return { long, short, thick: parseThicknessIn(piece.thickness) };
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
      <rect x={lx - 4} y={ly - 38} width={128} height={lines.length * 11 + 8} fill="#fff" fillOpacity="0.95" stroke={INK} strokeWidth="0.8" />
      {lines.map((ln, i) => (
        <text key={ln} x={lx + 4} y={ly - 28 + i * 11} fontSize="7.5" fontWeight={i === 0 ? '700' : '400'} fill={INK}>{ln}</text>
      ))}
    </g>
  );
}

function drawPalletAndForklift(nodes, cx, cy, k, intL, intW, forkH) {
  const pal = [iso(cx, cy, 0, 0, 0, k), iso(cx, cy, intL + 10, 0, 0, k), iso(cx, cy, intL + 10, 0, intW + 6, k), iso(cx, cy, 0, 0, intW + 6, k)];
  nodes.push(<polygon key="pal" points={pal.map((p) => `${p.x},${p.y}`).join(' ')} fill="url(#woodPat)" stroke={WOOD_D} strokeWidth="2.5" />);
  for (let r = 0; r < 3; r += 1) {
    const z = (intW + 6) * (r + 0.5) / 3;
    drawLeaningSlab(nodes, cx, cy, k, -3, -forkH, z - 2, intL + 14, forkH, 3, { fill: WOOD_D, stroke: '#2d1810', keyPrefix: `run-${r}` });
  }
  nodes.push(
    <g key="fork">
      <rect x={pal[0].x - 40} y={pal[0].y + 4} width={intL * k * 0.4} height={forkH * k * 0.5} fill="#1e293b" rx="1" />
    </g>,
  );
  return pal;
}

/** Shared physical world: pallet, foam bed, A-frame, rear support, perimeter foam. */
function drawSupportedLeanFoundation(nodes, cx, cy, k, intL, intW, intH, y0) {
  drawLeaningSlab(nodes, cx, cy, k, 8, y0 - 0.4, 2, intL * 0.9, 1.4, intW * 0.88, {
    foam: true,
    label: null,
    keyPrefix: 'foam-bed',
    opacity: 0.9,
  });

  const rearZ = intW * 0.88;
  const rb = iso(cx, cy, 6, y0, rearZ, k);
  const rt = iso(cx, cy, 6, y0 + intH * 0.82, rearZ, k);
  const re = iso(cx, cy, intL * 0.92, y0, rearZ, k);
  const rte = iso(cx, cy, intL * 0.92, y0 + intH * 0.82, rearZ, k);
  nodes.push(<line key="rear-support" x1={rb.x} y1={rb.y} x2={rt.x} y2={rt.y} stroke={WOOD_D} strokeWidth="5" strokeLinecap="round" />);
  nodes.push(<line key="rear-support-r" x1={re.x} y1={re.y} x2={rte.x} y2={rte.y} stroke={WOOD_D} strokeWidth="5" strokeLinecap="round" />);
  nodes.push(<line key="rear-rail" x1={rt.x} y1={rt.y} x2={rte.x} y2={rte.y} stroke={WOOD_D} strokeWidth="3.5" />);

  [[8, 0], [intL * 0.9, 0]].forEach(([ax, az], i) => {
    const foot = iso(cx, cy, ax, y0, az, k);
    const head = iso(cx, cy, ax, y0 + intH * 0.88, rearZ * 0.55, k);
    nodes.push(<line key={`brace-${i}`} x1={foot.x} y1={foot.y} x2={head.x} y2={head.y} stroke={WOOD_D} strokeWidth="4" />);
    const mid = iso(cx, cy, ax + intL * 0.06, y0 + intH * 0.42, rearZ * 0.35, k);
    nodes.push(<line key={`diag-${i}`} x1={foot.x} y1={foot.y} x2={mid.x} y2={mid.y} stroke={WOOD_D} strokeWidth="2.5" opacity="0.85" />);
    nodes.push(<line key={`diag2-${i}`} x1={head.x} y1={head.y} x2={mid.x} y2={mid.y} stroke={WOOD_D} strokeWidth="2" opacity="0.7" />);
  });

  drawLeaningSlab(nodes, cx, cy, k, 6, y0, 0.5, 1.8, intH * 0.78, 1.2, { foam: true, keyPrefix: 'side-foam-l', opacity: 0.75 });
  drawLeaningSlab(nodes, cx, cy, k, intL * 0.88, y0, rearZ - 1, 1.8, intH * 0.78, 1.2, { foam: true, keyPrefix: 'side-foam-r', opacity: 0.75 });
}

function drawCrateFrame(nodes, cx, cy, k, intL, intW, intH, y0, palletH) {
  const corners = [[0, 0, 0], [intL + 8, 0, 0], [intL + 8, 0, intW + 6], [0, 0, intW + 6]];
  const topY = (intH + palletH + 8) * k;
  corners.forEach(([x, , z], i) => {
    const b = iso(cx, cy, x, y0, z, k);
    const t = iso(cx, cy, x, y0 + topY / k, z, k);
    nodes.push(<line key={`post-${i}`} x1={b.x} y1={b.y} x2={t.x} y2={t.y} stroke={WOOD_D} strokeWidth="5" strokeLinecap="round" />);
  });
  corners.forEach(([x, , z], i) => {
    const n = corners[(i + 1) % 4];
    const a = iso(cx, cy, x, y0 + topY / k, z, k);
    const b = iso(cx, cy, n[0], y0 + topY / k, n[2], k);
    nodes.push(<line key={`rail-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={WOOD_D} strokeWidth="3.5" />);
  });
}

function renderIslandLeanLoad(nodes, cx, cy, k, intL, intW, intH, y0, pieces) {
  const ordered = islandDepthStack(pieces);
  let z = 5;
  const slabW = intL * 0.86;
  const slabH = intH * 0.88;

  ordered.forEach((p, i) => {
    const pf = pieceFace(p);
    if (i > 0) {
      drawLeaningSlab(nodes, cx, cy, k, 10, y0, z, slabW, slabH * 0.95, 0.35, {
        fill: 'rgba(186,230,253,0.55)',
        stroke: '#38bdf8',
        label: 'POLY',
        sub: '100µm film',
        keyPrefix: `film-${i}`,
      });
      z += 0.5;
    }
    const thickZ = Math.max(pf.thick * k * 2.2, 2.5);
    drawLeaningSlab(nodes, cx, cy, k, 10, y0, z, slabW, slabH, thickZ, {
      label: p.part_no || `SL${i + 1}`,
      sub: `${fmt(pf.thick)}″ · ${fmt(pf.long)}″ L`,
      keyPrefix: `isl-${i}`,
    });
    z += thickZ + 0.35;
  });
}

function renderFamilyLeanLoad(nodes, cx, cy, k, intL, intW, intH, y0, gapIn, layers) {
  const baseX = 10;
  const slabW = intL * 0.86;
  const mainSlabH = intH * 0.88;
  let zCursor = 5;

  layers.forEach((layer) => {
    if (layer.gapAfterIn > 0) {
      const foamDepth = Math.max(layer.gapAfterIn * 1.15, 0.85);
      drawFoamSheet(nodes, cx, cy, k, baseX, y0, zCursor, slabW, mainSlabH * 0.16, foamDepth, layer.gapAfterIn, `foam-${layer.id}`);
      zCursor += foamDepth + 0.3;
    }

    const isMain = layer.type === 'main';
    const n = Math.max(layer.pieces.length, 1);

    if (isMain) {
      layer.pieces.forEach((p, i) => {
        const pf = pieceFace(p);
        const thickZ = Math.max(pf.thick * 2.6, 1.05);
        const z = zCursor + i * (thickZ + gapIn * 0.85);
        drawLeaningSlab(nodes, cx, cy, k, baseX, y0, z, slabW, mainSlabH, thickZ, {
          label: p.part_no || '—',
          sub: `${fmt(pf.short)}″ H × ${fmt(pf.long)}″ L`,
          keyPrefix: `${layer.id}-${i}`,
        });
      });
      const topDepth = layer.pieces.reduce((sum, p, i) => {
        const t = Math.max(pieceFace(p).thick * 2.6, 1.05);
        return sum + t + (i > 0 ? gapIn * 0.85 : 0);
      }, 0);
      zCursor += topDepth + 0.4;
    } else {
      layer.pieces.forEach((p, i) => {
        const pf = pieceFace(p);
        const thickZ = Math.max(pf.thick * 2.4, 0.85);
        drawLeaningSlab(nodes, cx, cy, k, baseX + i * 2, y0, zCursor, slabW * 0.9, mainSlabH * 0.52, thickZ, {
          label: p.part_no || '—',
          sub: `${fmt(pf.thick)}″ · ${layer.label}`,
          keyPrefix: `${layer.id}-${i}`,
        });
      });
      zCursor += Math.max(pieceFace(layer.pieces[0]).thick * 2.4, 0.85) + 0.5;
    }
  });
}

function MetricsPanelSvg({ preview, crateId, gapIn, pattern, stackSteps, layers }) {
  const m = preview.metrics;
  const d = preview.dimensions;
  const met = m.weightOptimizationMet;
  const x = 838;
  const y = 68;
  const w = 332;
  const h = 318;
  const avgKg = m.slabCount > 0 ? m.slabWeightKg / m.slabCount : 0;
  const isIsland = pattern === 'island';

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={GREY_PANEL} fillOpacity="0.94" stroke="#555" strokeWidth="1.8" />
      <text x={x + 10} y={y + 16} fontSize="10" fontWeight="800" fill={INK} letterSpacing="0.08em">OPTIMIZATION DATA</text>
      <text x={x + w - 10} y={y + 16} textAnchor="end" fontSize="10" fontWeight="800" fill={INK}>{crateId}</text>
      <line x1={x + 6} y1={y + 22} x2={x + w - 6} y2={y + 22} stroke="#555" strokeWidth="1" />
      <text x={x + 10} y={y + 38} fontSize="9" fontFamily="monospace" fill={INK}>{isIsland ? 'ISLAND DIMS' : 'CRATE DIMS'}: {fmt(d.internal_length)}×{fmt(d.internal_width)}×{fmt(d.internal_height)}″</text>
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
      <text x={x + 10} y={y + 196} fontSize="8.5" fontFamily="monospace" fill={INK2}>LOAD HEIGHT: {fmt(d.internal_height)}″ · LEAN ~{LEAN_DEG}°</text>
      <text x={x + 10} y={y + 208} fontSize="8.5" fontFamily="monospace" fill={INK2}>{isIsland ? 'SEPARATOR: 100µm poly film' : `SPACER: ${fmt(gapIn)}″ foam between groups`}</text>
      <text x={x + 10} y={y + 220} fontSize="8.5" fontFamily="monospace" fill={INK2}>FORKLIFT: 7″ clearance · A-frame supported load</text>
      {!isIsland && layers?.length > 0 && (
        <g>
          <text x={x + 10} y={y + 238} fontSize="8" fontWeight="700" fill={INK}>FACTORY BUILD ORDER:</text>
          {layers.map((layer, i) => (
            <text key={layer.id} x={x + 14} y={y + 252 + i * 11} fontSize="7.5" fontFamily="monospace" fill={INK2}>
              L{i * 2 + 1} {layer.label.toUpperCase()} ({layer.pieces.length} pc · {fmt(layer.heightIn)}″)
            </text>
          ))}
        </g>
      )}
      {isIsland && (
        <text x={x + 10} y={y + 238} fontSize="8" fontFamily="monospace" fill={INK2}>Leaning supported cassette · poly film between faces</text>
      )}
    </g>
  );
}

function HeroCrateFigure({ layers, pieces, gapIn, pattern, dims }) {
  const cx = 300;
  const cy = 530;
  const k = pattern === 'island' ? 3.4 : 3.05;
  const intL = dims.internal_length || 100;
  const intW = dims.internal_width || 14;
  const intH = dims.internal_height || 12;
  const forkH = 7;
  const palletH = 4;
  const y0 = palletH;
  const nodes = [];

  const pal = drawPalletAndForklift(nodes, cx, cy, k, intL, intW, forkH);
  drawSupportedLeanFoundation(nodes, cx, cy, k, intL, intW, intH, y0);

  if (pattern === 'island') {
    renderIslandLeanLoad(nodes, cx, cy, k, intL, intW, intH, y0, pieces);
  } else {
    renderFamilyLeanLoad(nodes, cx, cy, k, intL, intW, intH, y0, gapIn, layers);
  }

  drawCrateFrame(nodes, cx, cy, k, intL, intW, intH, y0, palletH);

  const bc = iso(cx, cy, intL * 0.38, y0 + intH * 0.35, intW * 0.35, k);
  nodes.push(
    <g key="banner">
      <rect x={bc.x - 98} y={bc.y - 12} width={196} height={20} fill="#fff" fillOpacity="0.93" stroke={INK} />
      <text x={bc.x} y={bc.y + 2} textAnchor="middle" fontSize="9" fontWeight="800">{patternBanner(pattern, pieces.length)}</text>
    </g>,
  );

  const leanPt = iso(cx, cy, intL * 0.08, y0 + intH * 0.55, intW * 0.2, k);
  nodes.push(leaderCallout(leanPt.x, leanPt.y, leanPt.x - 62, leanPt.y - 48, [`${LEAN_DEG}° LEAN`, 'into A-frame support', 'bottom foam contact'], 'lean'));

  if (pattern === 'island') {
    const callPt = iso(cx, cy, intL * 0.12, y0 + 20, intW * 0.12, k);
    nodes.push(leaderCallout(callPt.x, callPt.y, callPt.x - 72, callPt.y - 52, ['NO FOAM SEPARATORS', '100µm POLY FILM', 'polished faces'], 'poly'));
  }

  const open = iso(cx, cy, intL + 14, y0 + intH * 0.3, intW * 0.28, k);
  return (
    <g>
      {nodes}
      <text x={open.x} y={open.y} fontSize="10.5" fontWeight="800" fill="#1d4ed8">LONG {fmt(dims.internal_length)}″ SIDE OPEN · LEANING LOAD AXIS →</text>
      {dimArrow(36, VB_H - 128, 36 + intL * k * 0.6, VB_H - 128, `PALLET LENGTH: ${fmt(dims.external_length)}″`, `supported load · ${fmt(dims.internal_length)}″`, 'dL', 240)}
      {dimArrow(748, 118, 748, 268, `EXTERNAL CRATE HEIGHT: ${fmt(dims.external_height)}″`, `lean load + A-frame`, 'dH', 220)}
      {dimArrow(580, 318, 680, 358, `INTERNAL WIDTH: ${fmt(dims.internal_width)}″`, pattern === 'island' ? 'cassette depth' : 'tops + splash depth', 'dW', 210)}
      {dimArrow(pal[0].x - 28, pal[0].y + 14, pal[0].x - 28, pal[0].y - forkH * k, '7″ FORKLIFT SPACE', 'mandatory tine clearance', 'dF', 180)}
      {dimArrow(500, 88, 600, 88, `LOAD HEIGHT: ${fmt(dims.internal_height)}″`, `${LEAN_DEG}° lean into rear support`, 'dS', 210)}
    </g>
  );
}

function BottomInsets({ dims, pattern, pieceCount, layers, gapIn }) {
  const y = 742;
  const isIsland = pattern === 'island';
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
      <text x={324} y={y + 36} fontSize="8.5" fill={INK2}>• All stone leans into A-frame · never unsupported</text>
      <text x={324} y={y + 50} fontSize="8.5" fill={INK2}>• 7″ forklift clearance · bottom foam bed</text>
      <text x={324} y={y + 64} fontSize="8.5" fill={INK2}>
        {isIsland ? '• Island cassette · poly film between slab faces' : `• Family load: Tops → ${fmt(gapIn)}″ foam → Back → Side (same lean)`}
      </text>
      <text x={324} y={y + 78} fontSize="8.5" fill={INK2}>• Perimeter foam + rear support contact</text>
      <text x={324} y={y + 96} fontSize="9" fontWeight="700" fill={INK}>PARTS IN CRATE: {pieceCount}</text>
      {!isIsland && layers?.map((l, i) => (
        <text key={l.id} x={324} y={y + 112 + i * 11} fontSize="7.5" fontFamily="monospace" fill={INK2}>{l.label}: {l.pieces.length} pc</text>
      ))}

      <rect x={628} y={y} width={544} height={152} fill="#dddfe3" stroke="#555" strokeWidth="1.2" />
      <text x={640} y={y + 16} fontSize="9.5" fontWeight="800" fill={INK}>SECONDARY DETAIL · LEAN LOAD SUMMARY</text>
      <text x={640} y={y + 38} fontSize="8.5" fontFamily="monospace" fill={INK2}>INT {fmt(dims.internal_length)} × {fmt(dims.internal_width)} × {fmt(dims.internal_height)}″</text>
      <text x={640} y={y + 52} fontSize="8.5" fontFamily="monospace" fill={INK2}>EXT {fmt(dims.external_length)} × {fmt(dims.external_width)} × {fmt(dims.external_height)}″</text>
      <text x={640} y={y + 70} fontSize="9" fontWeight="700" fill={INK}>{patternBanner(pattern, pieceCount)}</text>
      <g transform={`translate(900, ${y + 24})`}>
        <rect x={0} y={0} width={120} height={76} fill="none" stroke={WOOD_D} strokeWidth="1.5" />
        <rect x={8} y={58} width={104} height={8} fill={WOOD} stroke={WOOD_D} />
        <line x1={12} y1={58} x2={28} y2={18} stroke={WOOD_D} strokeWidth="2" />
        <line x1={108} y1={58} x2={92} y2={18} stroke={WOOD_D} strokeWidth="2" />
        <polygon points="24,52 36,20 44,52" fill="#94a3b8" stroke="#475569" opacity="0.85" />
        <polygon points="52,52 64,22 72,52" fill="#64748b" stroke="#475569" opacity="0.75" />
        <rect x={78} y={28} width={6} height={24} fill={FOAM} stroke={FOAM_EDGE} />
        <text x={60} y={72} textAnchor="middle" fontSize="7" fill={INK2}>lean ref ~{LEAN_DEG}°</text>
      </g>
    </g>
  );
}

function FigureSection({ layers, pieces, pattern, footprint, gapIn, dims }) {
  const pad = 72;
  const innerW = 520;
  const frameY = 148;
  const frameH = 400;
  const baseY = frameY + frameH - 36;
  const blocks = [];

  blocks.push(
    <g key="aframe">
      <line x1={pad + 40} y1={baseY} x2={pad + 40} y2={frameY + 30} stroke={WOOD_D} strokeWidth="4" />
      <line x1={pad + innerW + 40} y1={baseY} x2={pad + innerW + 40} y2={frameY + 30} stroke={WOOD_D} strokeWidth="4" />
      <line x1={pad + 40} y1={baseY} x2={pad + 70} y2={frameY + 80} stroke={WOOD_D} strokeWidth="2.5" />
      <line x1={pad + innerW + 40} y1={baseY} x2={pad + innerW + 10} y2={frameY + 80} stroke={WOOD_D} strokeWidth="2.5" />
      <rect x={pad + 36} y={baseY} width={innerW + 8} height={8} fill={FOAM} stroke={FOAM_EDGE} />
      <line x1={pad + innerW + 58} y1={frameY + 100} x2={pad + innerW + 58} y2={baseY - 20} stroke={WOOD_D} strokeWidth="3" strokeDasharray="4 3" />
      <text x={pad + innerW + 66} y={frameY + 200} fontSize="8" fill={INK2}>rear support</text>
    </g>,
  );

  if (pattern === 'island') {
    const ordered = islandDepthStack(pieces);
    let zOff = 0;
    ordered.forEach((p, i) => {
      const pf = pieceFace(p);
      const thick = Math.max(pf.thick * 28, 10);
      const h = frameH - 90;
      if (i > 0) {
        drawLeanSectionPanel(blocks, pad + 52 + zOff, baseY, zOff, 4, h * 0.92, 4, { foam: false, fill: 'rgba(186,230,253,0.6)', stroke: '#38bdf8', label: 'film', key: `film-${i}` });
        zOff += 5;
      }
      drawLeanSectionPanel(blocks, pad + 52 + zOff, baseY, zOff, thick, h, thick, { label: p.part_no || `SL${i + 1}`, key: `isl-${i}` });
      zOff += thick + 4;
    });
    return (
      <g>
        <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE B — LEANING CASSETTE · DEPTH SECTION</text>
        <text x={pad} y={134} fontSize="9" fill={INK2}>{LEAN_DEG}° lean · support contact · foam bed · poly film between slabs</text>
        {blocks}
        {dimArrow(pad, frameY + frameH + 36, pad + innerW * 0.55, frameY + frameH + 36, `CASSETTE DEPTH: ${fmt(footprint.intW)}″`, `${ordered.length} leaning slabs`, 'sD', 220)}
      </g>
    );
  }

  let zOff = 0;
  const leanH = Math.min((dims.internal_height || 35) * 3.8, frameH - 88);
  layers.forEach((layer) => {
    if (layer.gapAfterIn > 0) {
      drawLeanSectionPanel(blocks, pad + 52 + zOff, baseY, zOff, Math.max(layer.gapAfterIn * 22, 8), leanH * 0.14, 8, {
        foam: true,
        label: `${fmt(layer.gapAfterIn)}″`,
        key: `fg-${layer.id}`,
      });
      zOff += Math.max(layer.gapAfterIn * 22, 8) + 3;
    }
    const isMain = layer.type === 'main';
    const n = Math.max(layer.pieces.length, 1);
    const slot = (innerW - 40) / n;
    layer.pieces.forEach((p, i) => {
      const pf = pieceFace(p);
      const thick = isMain ? Math.max(slot * 0.85, 14) : Math.max(pf.thick * 24, 6);
      const h = isMain ? leanH : leanH * 0.5;
      drawLeanSectionPanel(blocks, pad + 52 + zOff + i * slot, baseY, zOff, thick, h, thick, {
        label: p.part_no,
        key: `${layer.id}-${i}`,
      });
    });
    zOff += isMain ? n * slot * 0.95 : slot + 8;
  });

  return (
    <g>
      <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">FIGURE B — LEANING FAMILY LOAD · DEPTH SECTION</text>
      <text x={pad} y={134} fontSize="9" fill={INK2}>{LEAN_DEG}° lean · tops forward · splashes behind · same support direction</text>
      {blocks}
      {dimArrow(pad + 24, frameY + 50, pad + 24, baseY - 10, `LEAN ${LEAN_DEG}°`, 'into rear support', 'sL', 120)}
      {dimArrow(pad, frameY + frameH + 36, pad + innerW * 0.5, frameY + frameH + 36, `DEPTH: ${fmt(footprint.intW)}″`, `${fmt(gapIn)}″ foam between groups`, 'sD', 210)}
    </g>
  );
}

function FigureExploded({ layers, stackSteps, gapIn, pattern, pieces, onReorderLayer, dims }) {
  const pad = 88;
  let y = 168;
  const isIsland = pattern === 'island';

  const header = (
    <g key="hdr">
      <text x={pad} y={118} fontSize="14" fontWeight="800" fill={INK} letterSpacing="0.06em">
        {isIsland ? 'FIGURE C — BUILD SEQUENCE · ISLAND CASSETTE' : 'FIGURE C — FACTORY BUILD SEQUENCE'}
      </text>
      <text x={pad} y={136} fontSize="9" fontWeight="700" fill="#b45309">SEQUENCE VIEW — NOT PHYSICAL ELEVATION</text>
      <text x={pad} y={150} fontSize="8.5" fill={INK2}>Assembly order for factory stacking · see FIG A/B for warehouse load geometry</text>
    </g>
  );

  if (isIsland) {
    const ordered = islandDepthStack(pieces);
    return (
      <g>
        {header}
        {ordered.map((p, i) => {
          const pf = pieceFace(p);
          const h = Math.max(pf.long * 0.48, 36);
          const row = (
            <g key={pieceKey(p, i)}>
              <text x={pad + 4} y={y + h / 2 + 4} fontSize="10" fontWeight="800">SLAB {i + 1}</text>
              <rect x={pad + 56} y={y} width={500} height={h} fill={GRANITE} stroke="#334155" strokeWidth="2" />
              <text x={pad + 306} y={y + h / 2 - 2} textAnchor="middle" fontSize="10" fontWeight="700">{p.part_no}</text>
              <text x={pad + 306} y={y + h / 2 + 10} textAnchor="middle" fontSize="8">{fmt(pf.thick)}″ · {fmt(pf.long)}″ long edge</text>
            </g>
          );
          y += h + 16;
          return row;
        })}
      </g>
    );
  }

  const nodes = [header];
  stackSteps.forEach((step) => {
    if (step.kind === 'spacer') {
      nodes.push(
        <g key={`sp-${step.step}`}>
          <text x={pad + 4} y={y + 14} fontSize="10" fontWeight="800">L{step.step}</text>
          <rect x={pad + 48} y={y} width={508} height={24} fill="url(#foamHatch)" stroke={FOAM_EDGE} strokeWidth="1.2" strokeDasharray="6 3" />
          <text x={pad + 302} y={y + 16} textAnchor="middle" fontSize="10" fontWeight="800">{step.title}</text>
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
              <text x={pad + 48 + i * sw + sw / 2} y={y + lh / 2 - 1} textAnchor="middle" fontSize="9" fontWeight="700">{p.part_no}</text>
              <text x={pad + 48 + i * sw + sw / 2} y={y + lh / 2 + 10} textAnchor="middle" fontSize="7">{fmt(pf.length)}×{fmt(pf.width)}″</text>
            </g>
          );
        })}
        <text x={pad + 568} y={y + lh / 2 + 4} fontSize="9" fontWeight="700">{step.title}</text>
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
  nodes.push(<text key="note" x={pad} y={y + 16} fontSize="8.5" fill={INK2}>Build sequence · {fmt(gapIn)}″ foam · ext H {fmt(dims.external_height)}″ (estimator dims)</text>);
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
  crateClass,
  footprint,
  stackSteps,
  validation,
  onReorderLayer,
}) {
  const dims = preview.dimensions || {};
  const pattern = packingPattern(island, crateClass);
  const subtitle = `${patternSubtitle(pattern)} · ${crateId}`;

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
        <pattern id="woodPat" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill={WOOD} /><path d="M0 7h14M7 0v14" stroke={WOOD_D} strokeWidth="0.4" opacity="0.35" /></pattern>
        <pattern id="foamHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill={FOAM} /><line x1="0" y1="0" x2="0" y2="8" stroke={FOAM_EDGE} strokeWidth="1.5" /></pattern>
      </defs>
      <rect width={VB_W} height={VB_H} fill={BOARD} />
      <path d="M0 64 H1200 M64 0 V920" stroke="#a8adb2" strokeWidth="0.5" opacity="0.45" />

      <text x={VB_W / 2} y={28} textAnchor="middle" fontSize="17" fontWeight="800" fill={INK} letterSpacing="0.14em">SMART CRATE PLANNING ENGINE</text>
      <text x={VB_W / 2} y={48} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={INK2} letterSpacing="0.06em">{subtitle}</text>
      <text x={40} y={48} fontSize="10" fontWeight="800" fill={INK}>FIG {figure}</text>

      {figure === 'A' && <HeroCrateFigure layers={layers} pieces={pieces} gapIn={gapIn} pattern={pattern} dims={dims} />}
      {figure === 'B' && <FigureSection layers={layers} pieces={pieces} pattern={pattern} footprint={footprint} gapIn={gapIn} dims={dims} />}
      {figure === 'C' && <FigureExploded layers={layers} stackSteps={stackSteps} gapIn={gapIn} pattern={pattern} pieces={pieces} onReorderLayer={onReorderLayer} dims={dims} />}

      <MetricsPanelSvg preview={preview} crateId={crateId} gapIn={gapIn} pattern={pattern} stackSteps={stackSteps} layers={layers} />
      {figure === 'A' && <BottomInsets dims={dims} pattern={pattern} pieceCount={pieces.length} layers={layers} gapIn={gapIn} />}
      <ConstraintStripSvg validation={validation} />
    </svg>
  );
}
