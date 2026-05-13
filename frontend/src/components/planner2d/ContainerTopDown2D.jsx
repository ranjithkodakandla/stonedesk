import React from 'react';

const CLASS_COL = { A: '#3b82f6', B: '#22c55e', C: '#f59e0b', D: '#a855f7' };

/**
 * Operational top-down container floor: crate footprints from solver placements.
 */
export default function ContainerTopDown2D({ layout, title }) {
  const interior = layout?.container_interior_in || layout?.layout_2d || {};
  const L = Number(interior.length ?? interior.interior_length_in) || 233;
  const W = Number(interior.width ?? interior.interior_width_in) || 92;
  const placements = layout?.placements || [];

  const vbW = 520;
  const vbH = Math.max(120, (vbW * W) / L);
  const pad = 12;
  const sx = (vbW - 2 * pad) / L;
  const sy = (vbH - 2 * pad) / W;

  const rows = [...placements].sort((a, b) => {
    const aA = String(a.crate_class || '').toUpperCase() === 'A' ? 1 : 0;
    const bA = String(b.crate_class || '').toUpperCase() === 'A' ? 1 : 0;
    if (aA !== bA) return aA - bA;
    return Number(a.x ?? 0) - Number(b.x ?? 0) || Number(a.y ?? 0) - Number(b.y ?? 0);
  });

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
        {title || 'Container top-down (floor plan)'}
      </div>
      <p className="mt-1 text-xs text-[#64748b]">
        Islands (A) toward the back wall (low X); B/C/D pack toward the doors (high X). Horizontal crates may use one
        stack tier when clear height allows. Sequence follows load order.
      </p>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="mt-2 w-full bg-[#f8fafc]" role="img" aria-label="Container top down">
        <rect x={pad} y={pad} width={L * sx} height={W * sy} fill="#ffffff" stroke="#64748b" strokeWidth="2" rx="4" />
        <text x={pad + 4} y={pad + 14} fill="#64748b" fontSize="10" fontWeight="600">
          {Math.round(L)}″ L × {Math.round(W)}″ W · {layout?.type || layout?.container_type || '20ft'}
        </text>
        {rows.map((pl, i) => {
          const fl = Number(pl.floor_l) || 0;
          const fw = Number(pl.floor_w) || 0;
          const x = pad + Number(pl.x || 0) * sx;
          const y = pad + Number(pl.y || 0) * sy;
          const w = fl * sx;
          const h = fw * sy;
          const cls = String(pl.crate_class || '').toUpperCase();
          const fill = CLASS_COL[cls] || '#94a3b8';
          return (
            <g key={`${pl.crate_id}-${i}`}>
              <rect x={x} y={y} width={Math.max(w, 3)} height={Math.max(h, 3)} fill={fill} fillOpacity={0.35} stroke="#0f172a" strokeWidth="1.2" rx="2" />
              <text x={x + 4} y={y + 14} fill="#0f172a" fontSize="9" fontWeight="700" fontFamily="ui-monospace,monospace">
                {pl.crate_id || '—'}
              </text>
              <text x={x + 4} y={y + 26} fill="#334155" fontSize="8" fontFamily="ui-monospace,monospace">
                {pl.weight_kg != null ? `${Math.round(pl.weight_kg)} kg` : ''} · seq {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[#64748b]">
        <span>
          Used floor (bbox est.): {Math.round(layout?.used_length_in || 0)}″ × {Math.round(layout?.used_width_in || 0)}″
        </span>
        <span>Weight util: {layout?.weight_utilization_pct ?? '—'}%</span>
        <span>Floor util (approx): {layout?.floor_utilization_pct_approx ?? '—'}%</span>
        <span>Remaining payload: {layout?.remaining_payload_kg ?? '—'} kg</span>
      </div>
    </div>
  );
}
