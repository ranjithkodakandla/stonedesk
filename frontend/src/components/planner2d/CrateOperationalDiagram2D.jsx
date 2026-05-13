import React, { useMemo } from 'react';

const WOOD = '#78350f';
const FOAM = '#fde68a';
const EDGE = '#0f172a';

const THICK_IN = { '2CM': 0.79, '3CM': 1.18, Mixed: 0.98 };

function thicknessIn(piece, project) {
  const t = piece?.thickness || project?.thickness || '3CM';
  return THICK_IN[t] ?? THICK_IN['3CM'];
}

function parseDim(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function classStroke(cls) {
  if (cls === 'A') return '#1d4ed8';
  if (cls === 'B') return '#059669';
  if (cls === 'C') return '#d97706';
  if (cls === 'D') return '#7c3aed';
  return '#475569';
}

function collectSplashLayers(crate, piecesById, allInCrate) {
  const layers = crate.planner_v3_splash_layers;
  if (Array.isArray(layers) && layers.length) {
    return layers.map((layer) =>
      (Array.isArray(layer) ? layer : []).map((id) => piecesById[Number(id)]).filter(Boolean),
    );
  }
  const splashIds = new Set((crate.splash_layer_piece_ids || []).map(Number));
  const flat = (allInCrate || []).filter((p) => splashIds.has(p.id));
  return flat.length ? [flat] : [];
}

/**
 * 2D operational diagrams: island = vertical cassette section (thickness stack × slab height);
 * horizontal = true layered main (bed) + splash courses above with geometry-weighted spans.
 */
export default function CrateOperationalDiagram2D({ crate, piecesInCrate: pic, crateClass, project }) {
  const cls = crateClass || 'D';
  const stroke = classStroke(cls);

  const { vertical, mains, splashLayers, islandPieces } = useMemo(() => {
    const byId = Object.fromEntries((pic || []).map((p) => [p.id, p]));
    const mainIds = new Set((crate.main_layer_piece_ids || []).map(Number));
    let mainsList = (pic || []).filter((p) => mainIds.has(p.id));
    if (!mainsList.length) {
      const splashSet = new Set((crate.splash_layer_piece_ids || []).map(Number));
      mainsList = (pic || []).filter((p) => !splashSet.has(p.id));
    }
    const spl = collectSplashLayers(crate, byId, pic);
    const vert = (crate.planner_v3_orientation || crate.orientation) === 'vertical';
    const islandOrder = vert ? [...(pic || [])].sort((a, b) => a.id - b.id) : [];
    return {
      vertical: vert,
      mains: mainsList,
      splashLayers: spl,
      islandPieces: islandOrder,
    };
  }, [crate, pic]);

  const vbW = 480;
  const vbH = 300;
  const pad = 14;
  const frame = { x: pad, y: pad, w: vbW - 2 * pad, h: vbH - 2 * pad };

  if (!pic?.length) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-sm text-[#64748b]">
        No pieces in this crate.
      </div>
    );
  }

  if (vertical) {
    const pieces = islandPieces.length ? islandPieces : pic;
    const thicknesses = pieces.map((p) => thicknessIn(p, project));
    const sumT = thicknesses.reduce((a, b) => a + b, 0) || 1;
    const longDims = pieces.map((p) => {
      const L = parseDim(p.length);
      const W = parseDim(p.width);
      return Math.max(L, W) || 1;
    });
    const maxLong = Math.max(...longDims, 1);
    const usableW = frame.w - 20;
    const usableH = frame.h - 28;
    const scaleX = usableW / sumT;
    const scaleY = (usableH * 0.92) / maxLong;
    let x = frame.x + 10;
    const y0 = frame.y + 18 + usableH * 0.04;

    return (
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
          Island — vertical cassette (section)
        </div>
        <p className="mt-1 text-xs text-[#64748b]">
          Each slab drawn by real thickness (stack axis) and long-edge height — adjacent stack, no intentional gaps.
        </p>
        <svg viewBox={`0 0 ${vbW} ${vbH}`} className="mt-2 w-full" role="img" aria-label="Island cassette section">
          <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#fffbeb" stroke={WOOD} strokeWidth="3" rx="6" />
          <text x={frame.x + 8} y={frame.y + 12} fill="#64748b" fontSize="9" fontWeight="600">
            Stack depth →
          </text>
          {pieces.map((p, i) => {
            const t = thicknesses[i] * scaleX;
            const h = longDims[i] * scaleY;
            const y = y0 + (maxLong * scaleY - h);
            const label = String(p.part_no || p.part || p.id).slice(0, 12);
            return (
              <g key={p.id}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(t, 2)}
                  height={h}
                  fill={stroke}
                  opacity={0.82}
                  stroke={EDGE}
                  strokeWidth="0.6"
                  rx="0.5"
                />
                <line x1={x} x2={x + Math.max(t, 2)} y1={y + h} y2={y + h} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
                <text x={x + Math.max(t, 2) / 2} y={y0 + maxLong * scaleY + 12} textAnchor="middle" fill="#334155" fontSize="8" fontFamily="ui-monospace,monospace">
                  {label}
                </text>
              </g>
            );
          })}
          <text x={frame.x + frame.w - 8} y={frame.y + frame.h - 6} textAnchor="end" fill="#94a3b8" fontSize="8">
            Face height ↑
          </text>
        </svg>
      </div>
    );
  }

  const innerX = frame.x + 8;
  const innerW = frame.w - 16;
  const baseY = frame.y + frame.h - 18;

  const list = mains.length ? mains : pic;
  const spanRows = list.map((p) => {
    const L = parseDim(p.length);
    const W = parseDim(p.width);
    const run = Math.max(L, W) || 1;
    const rise = Math.min(L, W) || run;
    return { piece: p, run, rise };
  });
  const sumRun = spanRows.reduce((s, x) => s + x.run, 0) || 1;
  const maxRise = Math.max(...spanRows.map((x) => x.rise), 1);
  const mainSpans = spanRows.map((s) => ({
    ...s,
    w: (s.run / sumRun) * innerW,
    h: Math.min(56, 12 + (s.rise / maxRise) * 44),
  }));

  let yCursor = baseY;
  const mainDepth = Math.max(...mainSpans.map((s) => s.h), 36);

  yCursor -= mainDepth;
  let xAcc = innerX;
  const mainRects = mainSpans.map((s) => {
    const r = { x: xAcc, y: yCursor, w: s.w - 1, h: mainDepth, piece: s.piece, run: s.run, rise: s.rise };
    xAcc += s.w;
    return r;
  });

  const splashStacks = [];
  let layerY = yCursor - 6;
  splashLayers.forEach((layerPieces, li) => {
    if (!layerPieces.length) return;
    const spans = layerPieces.map((p) => {
      const L = parseDim(p.length);
      const W = parseDim(p.width);
      const run = Math.max(L, W) || 1;
      const rise = Math.min(L, W) || run;
      return { piece: p, run, rise };
    });
    const sumRun = spans.reduce((s, x) => s + x.run, 0) || 1;
    const layerH = Math.min(40, 10 + (Math.max(...spans.map((x) => x.rise), 1) / 120) * 30);
    layerY -= layerH + 5;
    let xx = innerX;
    const row = spans.map((s) => {
      const w = (s.run / sumRun) * innerW;
      const seg = {
        x: xx,
        y: layerY,
        w: w - 1,
        h: layerH,
        piece: s.piece,
        li,
      };
      xx += w;
      return seg;
    });
    splashStacks.push(row);
  });

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
        Horizontal crate — layered load (plan-view proportions)
      </div>
      <p className="mt-1 text-xs text-[#64748b]">
        Main bed uses each piece’s long edge along the row; splash courses stack above with thinner depth. Polished
        faces are implied between layers (foam strip exaggerated).
      </p>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="mt-2 w-full" role="img" aria-label="Crate layered diagram">
        <defs>
          <pattern id="foam2d" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M0 5 L5 0" stroke={FOAM} strokeWidth="0.8" opacity="0.55" />
          </pattern>
        </defs>
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#fffbeb" stroke={WOOD} strokeWidth="3" rx="8" />
        <text x={innerX} y={frame.y + 14} fill="#64748b" fontSize="9" fontWeight="600">
          Interior (operational schematic)
        </text>

        {mainRects.map((r) => (
          <g key={`m-${r.piece.id}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={stroke} opacity={0.88} stroke={EDGE} strokeWidth="0.8" rx="1.5" />
            <text
              x={r.x + r.w / 2}
              y={r.y + r.h / 2 + 3}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="8"
              fontFamily="ui-monospace,monospace"
              fontWeight="600"
            >
              {String(r.piece.part_no || r.piece.id).slice(0, 9)}
            </text>
            <text x={r.x + r.w / 2} y={r.y - 3} textAnchor="middle" fill="#475569" fontSize="7">
              {Math.round(r.run)}×{Math.round(r.rise)}″
            </text>
          </g>
        ))}
        <text
          x={innerX + innerW}
          y={mainRects[0] ? mainRects[0].y + mainRects[0].h + 12 : baseY}
          textAnchor="end"
          fill="#334155"
          fontSize="8"
          fontWeight="600"
        >
          Layer 1 — mains
        </text>

        {splashStacks.map((row, ri) => (
          <g key={`splrow-${ri}`}>
            {row.length > 0 && (
              <text x={innerX} y={row[0].y - 2} fill="#0369a1" fontSize="8" fontWeight="600">
                Layer {ri + 2} — splashes
              </text>
            )}
            {row.map((s) => (
              <g key={`s-${s.piece.id}-${ri}`}>
                <rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  fill="#93c5fd"
                  opacity={0.95}
                  stroke="#1e40af"
                  strokeWidth="0.6"
                  rx="1"
                />
                <rect x={s.x} y={s.y + s.h - 3} width={s.w} height={3} fill="url(#foam2d)" opacity="0.55" />
                <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 2} textAnchor="middle" fill="#0f172a" fontSize="7" fontFamily="ui-monospace,monospace">
                  {String(s.piece.part_no || s.piece.id).slice(0, 8)}
                </text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
