import React, { useMemo } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import { computedCrateWeightKg } from '../utils/plannerDisplay';
import { buildPiecesByCrate, formatNumber, getPieceWeight } from '../utils/plannerUtils';

const PlannerCrateTab = () => {
  const project = usePlannerStore((s) => s.project);
  const pieces = usePlannerStore((s) => s.pieces);
  const crates = usePlannerStore((s) => s.crates);
  const assignments = usePlannerStore((s) => s.assignments);
  const setActiveTab = usePlannerStore((s) => s.setActiveTab);

  const { grouped } = useMemo(
    () => buildPiecesByCrate(pieces, crates, assignments),
    [pieces, crates, assignments],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Crate contents (v3)</div>
            <p className="mt-2 max-w-3xl text-sm text-[#64748b]">
              Part lists per crate from SmartCratePlanner v3 (A island vertical, B/C/D horizontal with multi-layer
              splashes). To regenerate or adjust loads, use <strong className="text-[#334155]">Dispatch & build</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('build-plan')}
            className="shrink-0 rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-4 py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-[#dbeafe]"
          >
            Dispatch & build
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {crates.map((crate) => {
          const cratePieces = grouped[crate.id] || [];
          return (
            <div
              key={crate.id}
              className="rounded-[28px] border border-[#e2e8f0] bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm text-[#1d4ed8]">{crate.crate_id}</div>
                  <div className="mt-1 text-lg font-semibold text-[#0f172a]">{crate.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#64748b]">
                    {crate.planner_v3_crate_class && (
                      <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 font-semibold text-[#1d4ed8]">
                        Class {crate.planner_v3_crate_class}
                      </span>
                    )}
                    {crate.planner_v3_orientation && (
                      <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 capitalize">
                        {crate.planner_v3_orientation}
                      </span>
                    )}
                    <span>{formatNumber(computedCrateWeightKg(crate, cratePieces, project), 0)} kg</span>
                  </div>
                </div>
                <div className="text-right text-xs text-[#64748b]">
                  <div>
                    Ext {formatNumber(crate.external_length, 0)} × {formatNumber(crate.external_width, 0)} ×{' '}
                    {formatNumber(crate.external_height, 0)}″
                  </div>
                </div>
              </div>

              {(Array.isArray(crate.planner_v3_splash_layers) &&
                crate.planner_v3_splash_layers.some((L) => Array.isArray(L) && L.length > 0)) ||
              (Array.isArray(crate.splash_layer_piece_ids) && crate.splash_layer_piece_ids.length > 0) ? (
                <div className="mt-3 rounded-2xl bg-[#f8fafc] px-3 py-2 text-xs text-[#475569]">
                  <span className="font-semibold text-[#0f172a]">Splash layers:</span>{' '}
                  {Array.isArray(crate.planner_v3_splash_layers) &&
                  crate.planner_v3_splash_layers.some((L) => Array.isArray(L) && L.length > 0)
                    ? crate.planner_v3_splash_layers.map((layer, i) => (
                        <span key={i}>
                          L{i + 1}: {(layer || []).length} pc
                          {i < crate.planner_v3_splash_layers.length - 1 ? ' · ' : ''}
                        </span>
                      ))
                    : `${crate.splash_layer_piece_ids.length} splash pc (vertical / consolidated tier)`}
                </div>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] text-[#64748b]">
                      <th className="py-1 pr-3">Part</th>
                      <th className="py-1 pr-3">Dims</th>
                      <th className="py-1 pr-3">Flat</th>
                      <th className="py-1">kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cratePieces.map((p) => (
                      <tr key={p.id} className="border-b border-[#f8fafc]">
                        <td className="py-1 pr-3">{p.part || p.part_no || '—'}</td>
                        <td className="py-1 pr-3">
                          {p.length}×{p.width}
                        </td>
                        <td className="py-1 pr-3 text-[#64748b]">
                          {[p.building, p.floor, p.flat].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="py-1">{formatNumber(getPieceWeight(p, project), 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlannerCrateTab;
