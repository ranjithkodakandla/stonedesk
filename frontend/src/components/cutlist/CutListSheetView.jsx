import React from 'react';

/** Renders one nested stock sheet as an SVG — pieces placed exactly where the
 * backend engine put them, scaled to fit a fixed-width preview box. */
const CutListSheetView = ({ sheet, sheetNo, groupLabel }) => {
  const { stock_length: L, stock_width: W, used_pct, wasted_area, placements } = sheet;
  const viewW = 360;
  const scale = L > 0 ? viewW / W : 1;
  const viewH = L * scale;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-800">{groupLabel} — Sheet #{sheetNo}</div>
        <div className="text-xs text-slate-500">Used {used_pct}% · Wasted {wasted_area.toFixed(1)} in²</div>
      </div>
      <svg width={viewW} height={viewH} viewBox={`0 0 ${W} ${L}`} className="border border-slate-300 bg-slate-50">
        {placements.map((p, i) => (
          <g key={i}>
            <rect
              x={p.x} y={p.y} width={p.w} height={p.h}
              fill="#dbe4fb" stroke="#1e293b" strokeWidth={Math.max(0.3, 0.15 * scale)}
            />
            <text x={p.x + 2} y={p.y + 10} fontSize={Math.max(6, 8 / scale)} fill="#475569">
              {p.w.toFixed(2)}×{p.h.toFixed(2)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export default CutListSheetView;
