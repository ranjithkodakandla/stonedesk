import React from 'react';

// Renders template geometry (outline / cutouts / dimensions, all in inches)
// as an SVG. Mirrors backend/app/services/drawing_engine.py::render_svg so
// the live client preview and the downloaded SVG/PDF look the same.
const SCALE = 6; // px per inch
const PAD = 40;

const toPx = ([x, y]) => [x * SCALE + PAD, y * SCALE + PAD];

const DrawingPreview = ({ geometry, title }) => {
  if (!geometry) return null;
  const wIn = geometry.width_in || 96;
  const hIn = geometry.height_in || 42;
  const accessories = geometry.accessories || [];
  const accessoryRowH = accessories.length ? 90 : 0;
  const vbW = Math.max(wIn * SCALE + PAD * 2, 320);
  const vbH = hIn * SCALE + PAD * 2 + accessoryRowH;
  let accessoryX = PAD;
  const accessoryY = hIn * SCALE + PAD + 50;

  const dimOffset = (side, [fx, fy], [tx, ty]) => {
    const offset = 16;
    if (side === 'top') return [[fx, fy - offset], [tx, ty - offset]];
    if (side === 'left') return [[fx - offset, fy], [tx - offset, ty]];
    if (side === 'bottom') return [[fx, fy + offset], [tx, ty + offset]];
    return [[fx, fy], [tx, ty]];
  };

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-auto bg-white rounded-xl border border-[#e2e8f0]">
      {title && (
        <text x={PAD} y={PAD / 2} fontSize="12" fill="#0f172a" fontWeight="600">{title}</text>
      )}
      {geometry.outline?.length > 0 && (
        <polygon
          points={geometry.outline.map((p) => toPx(p).join(',')).join(' ')}
          fill="#f8fafc"
          stroke="#0f172a"
          strokeWidth="1.5"
        />
      )}
      {(geometry.cutouts || []).map((cutout, i) => {
        const [x, y, w, h] = cutout.rect;
        const [px0, py0] = toPx([x, y]);
        return (
          <g key={i}>
            <rect
              x={px0} y={py0} width={w * SCALE} height={h * SCALE}
              fill="white" stroke="#334155" strokeWidth="1.2" strokeDasharray="4,2"
            />
            {cutout.label && (
              <text
                x={px0 + (w * SCALE) / 2} y={py0 + (h * SCALE) / 2}
                fontSize="10" fill="#334155" textAnchor="middle" dominantBaseline="middle"
              >
                {cutout.label}
              </text>
            )}
          </g>
        );
      })}
      {(geometry.dimensions || []).map((dim, i) => {
        const [[fx, fy], [tx, ty]] = dimOffset(dim.side, toPx(dim.from), toPx(dim.to));
        return (
          <g key={i}>
            <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#64748b" strokeWidth="0.75" />
            <text x={(fx + tx) / 2} y={(fy + ty) / 2 - 4} fontSize="9" fill="#64748b" textAnchor="middle">
              {dim.label}
            </text>
          </g>
        );
      })}
      {accessories.length > 0 && (
        <>
          <line x1={0} y1={hIn * SCALE + PAD + 20} x2={vbW} y2={hIn * SCALE + PAD + 20} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PAD} y={hIn * SCALE + PAD + 38} fontSize="9" fill="#94a3b8">Bundled with this top:</text>
          {accessories.map((acc, i) => {
            const w = Math.min(acc.w, 60) * 0.9;
            const h = Math.min(acc.h, 40) * 1.6;
            const x = accessoryX;
            accessoryX += w + 28;
            return (
              <g key={i}>
                <rect x={x} y={accessoryY} width={w} height={h} fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
                <text x={x} y={accessoryY - 6} fontSize="8" fill="#64748b">{acc.label}</text>
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
};

export default DrawingPreview;
