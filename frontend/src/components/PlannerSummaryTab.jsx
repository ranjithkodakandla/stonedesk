import React, { useMemo } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import { buildRecommendationReasons, formatNumber, summarizeWarnings } from '../utils/plannerUtils';
import { printCratePlan, printContainerPlan } from '../utils/printUtils';

const KpiCard = ({ label, value, accent = 'text-[#0f172a]' }) => (
  <div className="rounded-[24px] border border-[#e2e8f0] bg-white px-4 py-4 shadow-sm">
    <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">{label}</div>
    <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
  </div>
);

const PACKING_MODES = [
  {
    id: 'category',
    label: 'Category-Based',
    subtitle: 'Fabrication efficiency',
    desc: 'Groups by part type (Vanity, Kitchen, Island). Best for fabrication and handling.',
  },
  {
    id: 'flat',
    label: 'Flat-Based',
    subtitle: 'Installation efficiency',
    desc: 'Groups by apartment/flat. One crate per flat when possible. Best for on-site delivery.',
  },
  {
    id: 'family',
    label: 'Family-Based',
    subtitle: 'Stone family + dispatch logic',
    desc: 'Groups by stone family (Island, Perimeter, Vanity, Range) within dispatch units. Keeps splash pieces with parent tops.',
    readOnly: true,
  },
];

const PlannerSummaryTab = () => {
  const project = usePlannerStore((state) => state.project);
  const insights = usePlannerStore((state) => state.insights);
  const crates = usePlannerStore((state) => state.crates);
  const isWorkspaceLoading = usePlannerStore((state) => state.isWorkspaceLoading);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);
  const setActiveTab = usePlannerStore((state) => state.setActiveTab);
  const setPreferredContainerMode = usePlannerStore((state) => state.setPreferredContainerMode);
  const exportWorkbook = usePlannerStore((state) => state.exportWorkbook);
  const regenerateWithStrategy = usePlannerStore((state) => state.regenerateWithStrategy);

  const warningSummary = useMemo(
    () => summarizeWarnings(insights?.exceptions || []),
    [insights]
  );

  const familySummary = useMemo(() => {
    if (!crates.length || crates[0]?.packing_mode !== 'family') return null;
    const counts = {};
    crates.forEach((c) => {
      const f = c.packing_family || 'other';
      counts[f] = (counts[f] || 0) + 1;
    });
    return counts;
  }, [crates]);

  const recommendationReasons = useMemo(
    () => buildRecommendationReasons(insights),
    [insights]
  );

  if (isWorkspaceLoading) {
    return (
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white px-6 py-20 text-center text-sm text-[#64748b] shadow-sm">
        Building planning summary...
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-20 text-center shadow-sm">
        <div className="text-xl font-semibold text-[#0f172a]">No planning summary yet</div>
        <div className="mt-2 text-sm text-[#64748b]">
          Add source pieces, then generate crates to see a recommendation.
        </div>
      </div>
    );
  }

  const activeMode = project.preferred_container_mode || 'recommended';

  const currentPackingMode = crates.length > 0
    ? (crates[0]?.packing_mode || 'category')
    : 'category';

  return (
    <div className="space-y-6">
      {/* Packing Mode Selector */}
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Packing Strategy</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Choose how crates are grouped</div>
          </div>
          {isRefreshing && (
            <div className="flex items-center gap-2 text-sm text-[#64748b]">
              <span className="inline-block h-4 w-4 rounded-full border-2 border-[#1d4ed8] border-t-transparent animate-spin" />
              Regenerating...
            </div>
          )}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PACKING_MODES.map((mode) => {
            const isActive = currentPackingMode === mode.id;
            const clickable = !mode.readOnly && !isRefreshing && !isActive;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={isRefreshing || mode.readOnly}
                onClick={() => { if (clickable) regenerateWithStrategy(mode.id); }}
                className={`rounded-[28px] border p-5 text-left transition-all ${
                  isActive
                    ? 'border-[#1d4ed8] bg-[#eff6ff] shadow-[0_0_0_3px_rgba(29,78,216,0.1)]'
                    : mode.readOnly
                    ? 'border-[#e2e8f0] bg-[#f8fafc] opacity-60 cursor-default'
                    : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white cursor-pointer'
                } ${isRefreshing && !mode.readOnly ? 'opacity-60 cursor-wait' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold text-[#0f172a]">{mode.label}</div>
                  {isActive && (
                    <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold text-[#1d4ed8]">
                      Active
                    </span>
                  )}
                  {mode.readOnly && !isActive && (
                    <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-[11px] text-[#94a3b8]">
                      Via Approval
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-medium text-[#1d4ed8]">{mode.subtitle}</div>
                <div className="mt-2 text-sm text-[#475569]">{mode.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Family breakdown — shown only for family-based plans */}
        {familySummary && (
          <div className="mt-5 border-t border-[#edf2f7] pt-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Family Breakdown</div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(familySummary).map(([family, count]) => (
                <div key={family} className="flex items-center gap-2 rounded-full border border-[#dbeafe] bg-[#eff6ff] px-4 py-2">
                  <span className="text-sm font-semibold capitalize text-[#1d4ed8]">{family}</span>
                  <span className="text-sm text-[#475569]">{count} crate{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr,0.7fr]">
        <div className="rounded-[36px] border border-[#dbe4f0] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_30%),linear-gradient(135deg,_#ffffff,_#f8fbff)] p-7 shadow-sm">
          <div className="text-xs uppercase tracking-[0.26em] text-[#64748b]">Step 1</div>
          <div className="mt-2 text-3xl font-semibold text-[#0f172a]">Recommended Shipping Plan</div>
          <div className="mt-4 inline-flex items-center rounded-full bg-[#dbeafe] px-4 py-2 text-xl font-semibold text-[#1d4ed8]">
            {insights.summary?.recommended_containers || 'No plan'}
          </div>
          <div className="mt-5 max-w-3xl text-sm leading-7 text-[#475569]">
            {insights.container_plan?.reason}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {recommendationReasons.map((reason) => (
              <div key={reason} className="rounded-2xl border border-[#dbe4f0] bg-white/90 px-4 py-3 text-sm text-[#334155] shadow-sm">
                <span className="mr-2 text-[#059669]">✔</span>
                {reason}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-primary" onClick={() => setActiveTab('crate-plan')}>
              Review Crate Plan
            </button>
            <button type="button" className="btn-primary" onClick={() => setActiveTab('container-loading')}>
              Review Container Plan
            </button>
            <button type="button" className="btn-primary bg-[#059669] hover:bg-[#047857]" onClick={exportWorkbook}>
              Export Excel
            </button>
            <button type="button" className="btn-primary bg-[#7c3aed] hover:bg-[#6d28d9]" onClick={() => printCratePlan(project, insights)}>
              🖨 Print Crate Plan
            </button>
            <button type="button" className="btn-primary bg-[#7c3aed] hover:bg-[#6d28d9]" onClick={() => printContainerPlan(project, insights)}>
              🖨 Print Container Plan
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <KpiCard label="Total Parts" value={insights.efficiency_kpis?.piece_count || 0} />
          <KpiCard label="Total Weight" value={`${formatNumber(insights.summary?.shipment_weight, 0)} kg`} />
          <KpiCard label="Crates Created" value={insights.summary?.crates_created || 0} />
          <KpiCard label="Avg Crate Fill" value={`${formatNumber(insights.efficiency_kpis?.average_fill_percent, 1)}%`} />
          <KpiCard label="Underloaded Crates" value={insights.underfilled_crates?.length || 0} accent="text-[#b45309]" />
          <KpiCard label="Containers Needed" value={insights.container_loading_plan?.summary?.total_containers || 0} />
          <KpiCard
            label="Efficiency Score"
            value={`${Math.max(0, Math.round((insights.efficiency_kpis?.average_fill_percent || 0) * 0.55 + (insights.efficiency_kpis?.average_weight_utilization || 0) * 0.45))}`}
            accent="text-[#1d4ed8]"
          />
        </div>
      </div>

      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Alternative Plans</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Choose the active planning mode</div>
          </div>
          <div className="rounded-full bg-[#f8fafc] px-4 py-2 text-sm text-[#475569]">
            Active mode: {activeMode === 'recommended' ? 'Auto recommendation' : activeMode}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {(insights.container_options || []).map((option) => {
            const isActive = project.preferred_container_mode === option.mode ||
              (project.preferred_container_mode === 'recommended' && option.label === insights.container_plan?.mode_label);
            return (
              <button
                key={option.mode}
                type="button"
                disabled={!option.feasible}
                onClick={() => setPreferredContainerMode(option.mode)}
                className={`rounded-[28px] border p-5 text-left transition-all ${
                  isActive
                    ? 'border-[#1d4ed8] bg-[#eff6ff] shadow-[0_0_0_3px_rgba(29,78,216,0.1)]'
                    : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white'
                } ${!option.feasible ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold text-[#0f172a]">{option.label}</div>
                  {option.label === insights.container_plan?.mode_label && (
                    <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold text-[#1d4ed8]">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-2 text-sm text-[#475569]">
                  <div>Weight utilization: {formatNumber(option.average_weight_utilization, 0)}%</div>
                  <div>Floor utilization: {formatNumber(option.average_length_utilization, 0)}%</div>
                  <div>Cost index: {formatNumber(option.cost_index, 2)}</div>
                  <div>Status: {option.feasible ? 'Feasible' : 'Not feasible'}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Top Warnings</div>
        <div className="mt-2 text-2xl font-semibold text-[#0f172a]">What needs attention before release</div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {warningSummary.length === 0 && (
            <div className="rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] px-4 py-5 text-sm text-[#166534]">
              No critical warnings. The current plan is clean.
            </div>
          )}
          {warningSummary.map((warning) => (
            <div key={warning.key} className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4 shadow-sm">
              <div className="text-3xl font-semibold text-[#0f172a]">{warning.count}</div>
              <div className="mt-2 text-sm text-[#475569]">{warning.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PlannerSummaryTab;
