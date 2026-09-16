import React, { useMemo } from 'react';
import { colorForSizes } from './cutlistPatterns';

/** One cut pattern rendered as a large SVG diagram — color-coded panels,
 * centered size labels (rotated for pieces too narrow to fit horizontally),
 * and dimension lines along the top/left edges, matching the reference
 * tool's on-screen sheet view. */
const CutListPatternDiagram = ({ pattern, viewW = 460 }) => {
  const { sheet, qty } = pattern;
  const L = sheet.stock_length;
  const W = sheet.stock_width;
  const scale = W > 0 ? viewW / W : 1;
  const viewH = L * scale;

  const colorOf = useMemo(() => {
    const sizeCounts = new Map();
    sheet.placements.forEach((p) => {
      const key = `${p.w.toFixed(2)}x${p.h.toFixed(2)}`;
      sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1);
    });
    const ordered = [...sizeCounts.keys()].sort((a, b) => {
      const [aw, ah] = a.split('x').map(Number);
      const [bw, bh] = b.split('x').map(Number);
      return bw * bh - aw * ah;
    });
    return colorForSizes(ordered);
  }, [sheet]);

  return (
    <svg width={viewW + 40} height={viewH + 30} className="overflow-visible">
      <g transform="translate(30, 22)">
        {sheet.placements.map((p, i) => {
          const key = `${p.w.toFixed(2)}x${p.h.toFixed(2)}`;
          const x = p.x * scale, y = p.y * scale, w = p.w * scale, h = p.h * scale;
          const label = `${p.w.toFixed(2)}×${p.h.toFixed(2)}`;
          const fits = w > label.length * 5.2;
          const fitsRotated = !fits && h > label.length * 5.2;
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill={colorOf[key]} stroke="#1e293b" strokeWidth={0.6} />
              {fits && (
                <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#1e293b">
                  {label}
                </text>
              )}
              {fitsRotated && (
                <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#1e293b"
                  transform={`rotate(90, ${x + w / 2}, ${y + h / 2})`}>
                  {label}
                </text>
              )}
              {p.y <= 0.05 && (
                <text x={x + w / 2} y={-4} textAnchor="middle" fontSize={8} fill="#64748b">{p.w.toFixed(2)}</text>
              )}
              {p.x <= 0.05 && (
                <text x={-6} y={y + h / 2} textAnchor="middle" fontSize={8} fill="#64748b"
                  transform={`rotate(-90, -6, ${y + h / 2})`}>{p.h.toFixed(2)}</text>
              )}
            </g>
          );
        })}
        <rect x={0} y={0} width={W * scale} height={L * scale} fill="none" stroke="#1e293b" strokeWidth={1} />
      </g>
      <text x={viewW + 25} y={16} textAnchor="end" fontSize={12} fontWeight="600" fill="#1e293b">×{qty}</text>
    </svg>
  );
};

export default CutListPatternDiagram;
