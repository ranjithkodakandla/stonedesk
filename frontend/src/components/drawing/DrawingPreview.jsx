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
  // Side splashes stand upright against the cabinet side — drawn as a tall
  // narrow strip (long dimension vertical). Backsplash runs flat along the
  // wall (long dimension horizontal). Rendering both the same way (as the
  // old code did) made side splashes look like short, wide backsplashes.
  const isVertical = (role) => (role || '').startsWith('side_splash');
  const accessoryDims = (acc) => {
    const long = Math.min(acc.w, 36) * 2.4;
    const short = Math.min(acc.h, 8) * 2.4;
    return isVertical(acc.role) ? { w: short, h: long } : { w: long, h: short };
  };
  const accessoryMaxH = accessories.reduce((m, acc) => Math.max(m, accessoryDims(acc).h), 0);
  const accessoryRowH = accessories.length ? accessoryMaxH + 90 : 0;
  const vbW = Math.max(wIn * SCALE + PAD * 2, 320);
  const vbH = hIn * SCALE + PAD * 2 + accessoryRowH;
  let accessoryX = PAD;
  const accessoryY = hIn * SCALE + PAD + 55;

  const dimOffset = (side, [fx, fy], [tx, ty]) => {
    const offset = 16;
    if (side === 'top') return [[fx, fy - offset], [tx, ty - offset]];
    if (side === 'left') return [[fx - offset, fy], [tx - offset, ty]];
    if (side === 'bottom') return [[fx, fy + offset], [tx, ty + offset]];
    return [[fx, fy], [tx, ty]];
  };

  const edgeMarkPos = (side) => {
    const outline = geometry.outline || [];
    if (!outline.length) return null;
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pos = {
      top: [(x0 + x1) / 2, y0], bottom: [(x0 + x1) / 2, y1],
      left: [x0, (y0 + y1) / 2], right: [x1, (y0 + y1) / 2],
    }[side];
    return pos ? toPx(pos) : null;
  };

  // Chamfers the outline's first vertex to indicate a rounded corner (R.5"
  // on real fab drawings) — a short diagonal, not a true arc, matching the
  // PDF renderer's approach.
  const chamferedOutline = () => {
    const outline = geometry.outline || [];
    const r = (geometry.cornerRadius || 0) * SCALE;
    if (!outline.length) return [];
    if (r <= 1 || outline.length < 3) return outline.map(toPx);
    const pts = outline.map(toPx);
    const corner = pts[0];
    const unit = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len];
    };
    const uPrev = unit(corner, pts[pts.length - 1]);
    const uNext = unit(corner, pts[1]);
    const trimIn = [corner[0] + uPrev[0] * r, corner[1] + uPrev[1] * r];
    const trimOut = [corner[0] + uNext[0] * r, corner[1] + uNext[1] * r];
    return [trimOut, ...pts.slice(1), trimIn];
  };

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-auto bg-white rounded-xl border border-[#e2e8f0]">
      {title && (
        <text x={PAD} y={PAD / 2} fontSize="12" fill="#0f172a" fontWeight="600">{title}</text>
      )}
      {geometry.outline?.length > 0 && (
        <polygon
          points={chamferedOutline().map((p) => p.join(',')).join(' ')}
          fill="#f8fafc"
          stroke="#0f172a"
          strokeWidth="1.5"
        />
      )}
      {(geometry.edgeMarks || []).map((side, i) => {
        const pos = edgeMarkPos(side);
        if (!pos) return null;
        return (
          <text key={i} x={pos[0]} y={pos[1]} fontSize="11" fontWeight="700" fill="#0f172a" textAnchor="middle" dominantBaseline="middle">X</text>
        );
      })}
      {(geometry.cutouts || []).map((cutout, i) => {
        const [x, y, w, h] = cutout.rect;
        const [px0, py0] = toPx([x, y]);
        const wPx = w * SCALE, hPx = h * SCALE;
        const shape = cutout.shape || 'rect';
        return (
          <g key={i}>
            {shape === 'oval' ? (
              <ellipse cx={px0 + wPx / 2} cy={py0 + hPx / 2} rx={wPx / 2} ry={hPx / 2} fill="white" stroke="#334155" strokeWidth="1.2" />
            ) : shape === 'rounded_rect' ? (
              <rect x={px0} y={py0} width={wPx} height={hPx} rx={Math.min(wPx, hPx) * 0.18} fill="white" stroke="#334155" strokeWidth="1.2" />
            ) : cutout.type === 'cooktop' ? (
              // Solid line, sharp corners — a real cut, not "cut by
              // template" like a sink's dashed convention.
              <rect x={px0} y={py0} width={wPx} height={hPx} fill="white" stroke="#0f172a" strokeWidth="1.2" />
            ) : (
              <rect x={px0} y={py0} width={wPx} height={hPx} fill="white" stroke="#334155" strokeWidth="1.2" strokeDasharray="4,2" />
            )}
            {cutout.label && (
              <text
                x={px0 + wPx / 2} y={py0 + hPx / 2}
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
            const { w, h } = accessoryDims(acc);
            const vertical = isVertical(acc.role);
            const x = accessoryX;
            accessoryX += Math.max(w, (acc.label || '').length * 4.8) + 26;
            return (
              <g key={i}>
                <rect x={x} y={accessoryY} width={w} height={h} fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
                {vertical ? (
                  <>
                    <text x={x + w / 2} y={accessoryY + 10} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <text x={x + w / 2} y={accessoryY + h / 2 + 3} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <text x={x + w / 2} y={accessoryY + h - 6} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <line x1={x - 10} y1={accessoryY} x2={x - 10} y2={accessoryY + h} stroke="#94a3b8" strokeWidth="0.6" />
                    <text x={x - 14} y={accessoryY + h / 2} fontSize="7" fill="#94a3b8" textAnchor="end">{acc.h}"</text>
                  </>
                ) : (
                  <>
                    <text x={x + 6} y={accessoryY + h / 2 + 3} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <text x={x + w / 2} y={accessoryY + h / 2 + 3} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <text x={x + w - 6} y={accessoryY + h / 2 + 3} fontSize="7" fontWeight="700" fill="#64748b" textAnchor="middle">X</text>
                    <line x1={x} y1={accessoryY - 10} x2={x + w} y2={accessoryY - 10} stroke="#94a3b8" strokeWidth="0.6" />
                    <text x={x + w / 2} y={accessoryY - 13} fontSize="7" fill="#94a3b8" textAnchor="middle">{acc.w}"</text>
                  </>
                )}
                <text x={x} y={accessoryY + Math.max(h, 14) + 14} fontSize="8" fill="#64748b">{acc.label}</text>
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
};

export default DrawingPreview;
