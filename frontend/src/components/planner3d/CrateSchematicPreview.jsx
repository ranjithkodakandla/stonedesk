import React, { useMemo } from 'react';

const WOOD = '#92400e';
const FOAM = '#fde68a';
const MAIN_A = '#1d4ed8';
const MAIN_B = '#059669';
const MAIN_C = '#d97706';
const MAIN_D = '#7c3aed';
const MAIN_MISC = '#475569';
const SPLASH = '#93c5fd';

function classColor(cls) {
  if (cls === 'A') return MAIN_A;
  if (cls === 'B') return MAIN_B;
  if (cls === 'C') return MAIN_C;
  if (cls === 'D') return MAIN_D;
  return MAIN_MISC;
}

function pieceArea(p) {
  const l = Number(p.length) || 0;
  const w = Number(p.width) || 0;
  return Math.max(l * w, 1);
}

/** Build row layout: pieces as horizontal segments proportional to area. */
function layoutRow(pieces, innerX, innerY, rowW, rowH) {
  if (!pieces.length) return [];
  const total = pieces.reduce((s, p) => s + pieceArea(p), 0);
  const raw = pieces.map((p) => Math.max(4, (pieceArea(p) / total) * rowW));
  const sumW = raw.reduce((a, b) => a + b, 0);
  const scale = sumW > rowW ? rowW / sumW : 1;
  let x = innerX;
  return pieces.map((p, i) => {
    const w = raw[i] * scale;
    const seg = { x, y: innerY, w, h: rowH, piece: p };
    x += w;
    return seg;
  });
}

function collectSplashLayers(crate, piecesById) {
  const layers = crate.planner_v3_splash_layers;
  if (Array.isArray(layers) && layers.length) {
    return layers.map((layer) =>
      (Array.isArray(layer) ? layer : []).map((id) => piecesById[Number(id)]).filter(Boolean),
    );
  }
  const splashIds = new Set((crate.splash_layer_piece_ids || []).map(Number));
  const flat = (crate.pieces || []).map((p) => p.id).filter((id) => splashIds.has(id));
  return flat.length ? [flat.map((id) => piecesById[id]).filter(Boolean)] : [];
}

export default function CrateSchematicPreview({ crate, piecesInCrate, crateClass }) {
  const cls = crateClass || 'D';
  const mainColor = classColor(cls);

  const { mains, splashLayers, vertical } = useMemo(() => {
    const byId = Object.fromEntries((piecesInCrate || []).map((p) => [p.id, p]));
    const mainIds = new Set((crate.main_layer_piece_ids || []).map(Number));
    let mainsList = (piecesInCrate || []).filter((p) => mainIds.has(p.id));
    if (!mainsList.length) {
      const splashSet = new Set((crate.splash_layer_piece_ids || []).map(Number));
      mainsList = (piecesInCrate || []).filter((p) => !splashSet.has(p.id));
    }
    const spl = collectSplashLayers(crate, byId);
    const vert = (crate.planner_v3_orientation || crate.orientation) === 'vertical';
    return { mains: mainsList, splashLayers: spl, vertical: vert };
  }, [crate, piecesInCrate]);

  const vbW = 420;
  const vbH = 260;
  const pad = 16;
  const frame = { x: pad, y: pad, w: vbW - 2 * pad, h: vbH - 2 * pad };

  if (!piecesInCrate?.length) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-sm text-[#64748b]">
        No pieces linked to this crate for schematic.
      </div>
    );
  }

  if (vertical) {
    return (
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
          A-type vertical cassette (section)
        </div>
        <p className="mt-1 text-xs text-[#64748b]">
          Slabs on edge, packed along depth — matches shop vertical island crates.
        </p>
        <svg viewBox={`0 0 ${vbW} ${vbH}`} className="mt-2 w-full" role="img" aria-label="Crate section">
          <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#fffbeb" stroke={WOOD} strokeWidth="3" rx="6" />
          {mains.map((p, i) => {
            const n = Math.max(mains.length, 1);
            const slotW = (frame.w - 24) / n;
            const x0 = frame.x + 12 + i * slotW;
            const slabW = Math.min(slotW - 4, 28);
            const x = x0 + (slotW - slabW) / 2;
            const h = frame.h - 36;
            const y = frame.y + 18;
            return (
              <g key={p.id}>
                <rect x={x} y={y} width={slabW} height={h} fill={mainColor} opacity={0.85} stroke="#0f172a" strokeWidth="1" rx="1" />
                <text x={x + slabW / 2} y={y + h + 14} textAnchor="middle" fill="#334155" fontSize="9" fontFamily="ui-monospace, monospace">
                  {String(p.part_no || p.id).slice(0, 10)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  const innerX = frame.x + 10;
  const innerW = frame.w - 20;
  let yCursor = frame.y + 14;
  const mainRowH = 52;
  const splashRowH = 28;

  const mainSegs = layoutRow(mains, innerX, yCursor, innerW, mainRowH);
  yCursor += mainRowH + 6;

  const splashSegRows = splashLayers.map((layerPieces) => {
    const segs = layoutRow(layerPieces, innerX, yCursor, innerW, splashRowH);
    yCursor += splashRowH + 4;
    return segs;
  });

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
        B/C/D horizontal load diagram (splashes above mains)
      </div>
      <p className="mt-1 text-xs text-[#64748b]">
        Layer cake view — mains on the bed, splash layers stacked upward (not to scale with real foam gaps).
      </p>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="mt-2 w-full" role="img" aria-label="Crate load diagram">
        <defs>
          <pattern id="foam" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 6 L6 0" stroke={FOAM} strokeWidth="1" opacity="0.6" />
          </pattern>
        </defs>
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#fffbeb" stroke={WOOD} strokeWidth="3" rx="8" />
        <text x={innerX} y={frame.y + 11} fill="#64748b" fontSize="9" fontWeight="600">
          Interior (schematic)
        </text>

        {mainSegs.map((s) => (
          <g key={`m-${s.piece.id}`}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={mainColor} opacity={0.88} stroke="#0f172a" strokeWidth="1" rx="2" />
            <text
              x={s.x + s.w / 2}
              y={s.y + s.h / 2 + 3}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="8"
              fontFamily="ui-monospace, monospace"
              fontWeight="600"
            >
              {String(s.piece.part_no || s.piece.id).slice(0, 8)}
            </text>
          </g>
        ))}

        {mainSegs.length > 0 && (
          <text x={innerX + innerW - 2} y={mainSegs[0].y - 4} textAnchor="end" fill="#334155" fontSize="8" fontWeight="600">
            Main layer
          </text>
        )}

        {splashSegRows.map((segs, li) => (
          <g key={`spl-${li}`}>
            {segs.length > 0 && (
              <text x={innerX} y={segs[0].y - 3} fill="#0369a1" fontSize="8" fontWeight="600">
                Splash layer {li + 1}
              </text>
            )}
            {segs.map((s) => (
              <g key={`s-${s.piece.id}-${li}`}>
                <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={SPLASH} opacity={0.92} stroke="#1e40af" strokeWidth="0.8" rx="1" />
                <rect x={s.x} y={s.y + s.h - 4} width={s.w} height={4} fill="url(#foam)" opacity="0.5" />
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
