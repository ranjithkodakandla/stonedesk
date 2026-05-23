import React, { useMemo } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import { buildRecommendationReasons, formatNumber, summarizeWarnings, downloadPersistedDraftCratePlan } from '../utils/plannerUtils';
import { printCratePlan, printContainerPlan } from '../utils/printUtils';
import { CratePlanSummary } from './DraftCrateWorkspace';

const KpiCard = ({ label, value, accent = 'text-[#0f172a]' }) => (
  <div className="rounded-[24px] border border-[#e2e8f0] bg-white px-4 py-4 shadow-sm">
    <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">{label}</div>
    <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
  </div>
);

const PlannerSummaryTab = ({ draftCratePlan = null, onEditPlan = null }) => {
  const insights   = usePlannerStore((s) => s.insights);
  const crates       = usePlannerStore((s) => s.crates);
  const isWorkspaceLoading  = usePlannerStore((s) => s.isWorkspaceLoading);
  const setActiveTab        = usePlannerStore((s) => s.setActiveTab);
  const setPreferredContainerMode = usePlannerStore((s) => s.setPreferredContainerMode);
  const exportWorkbook      = usePlannerStore((s) => s.exportWorkbook);
  const project    = usePlannerStore((s) => s.project);

  const warningSummary = useMemo(
    () => summarizeWarnings(insights?.exceptions || []),
    [insights],
  );
  const recommendationReasons = useMemo(
    () => buildRecommendationReasons(insights),
    [insights],
  );

  const projectId     = project?.id;
  const hasDraftPlan  = (draftCratePlan?.draft_crates?.length ?? 0) > 0;
  const hasLegacyCratePlan  =
    Boolean(insights?.crate_count > 0) || (Array.isArray(crates) && crates.length > 0);

  const handleDownload = () => {
    if (!projectId) return;
    downloadPersistedDraftCratePlan(projectId).catch((err) => alert(err.message || 'Download failed — save a crate plan first.'));
  };

  if (isWorkspaceLoading) {
    return (
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white px-6 py-20 text-center text-sm text-[#64748b] shadow-sm">
        Building planning summary...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasDraftPlan && (
        <div className="space-y-4">
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-900">
            Saved Draft Plan Mode — totals and exports use your manually saved crate plan from Dispatch &amp; build.
          </div>
          <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Saved crate plan</div>
                <div className="mt-1 text-xl font-semibold text-[#0f172a]">
                  {draftCratePlan.draft_crates.length} crate{draftCratePlan.draft_crates.length !== 1 ? 's' : ''}
                  {draftCratePlan.saved_at && (
                    <span className="ml-3 text-sm font-normal text-[#64748b]">
                      · Saved {new Date(draftCratePlan.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('crate-plan')}
                  className="rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-5 py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors"
                >
                  View Crate Plan
                </button>
                <button
                  type="button"
                  onClick={() => (onEditPlan ? onEditPlan() : setActiveTab('build-plan'))}
                  className="rounded-full border border-[#64748b] bg-white px-5 py-2 text-sm font-semibold text-[#334155] hover:bg-[#f1f5f9] transition-colors"
                >
                  Edit Plan
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-full border border-[#059669] bg-[#f0fdf4] px-5 py-2 text-sm font-semibold text-[#059669] hover:bg-[#dcfce7] transition-colors"
                >
                  Download Plan
                </button>
              </div>
            </div>
          </div>
          <CratePlanSummary
            draftCrates={draftCratePlan.draft_crates}
            targetWeightKg={draftCratePlan.target_weight_kg || 1900}
          />
        </div>
      )}

      {!hasDraftPlan && hasLegacyCratePlan && insights && (
        <>
          <div className="rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-semibold text-violet-900">
            Legacy Auto Planner Mode — automatic packing engine only (no saved draft plan). Use Dispatch &amp; build to create a saved plan.
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.3fr,0.7fr]">
            <div className="rounded-[36px] border border-[#dbe4f0] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_30%),linear-gradient(135deg,_#ffffff,_#f8fbff)] p-7 shadow-sm">
              <div className="text-xs uppercase tracking-[0.26em] text-[#64748b]">Legacy auto planner</div>
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
                  Review crate contents
                </button>
                <button type="button" className="btn-primary" onClick={() => setActiveTab('container-loading')}>
                  Review Container Plan
                </button>
                <button type="button" className="btn-primary bg-[#059669] hover:bg-[#047857]" onClick={exportWorkbook}>
                  Export Excel
                </button>
                <button type="button" className="btn-primary bg-[#7c3aed] hover:bg-[#6d28d9]" onClick={() => printCratePlan(project, insights)}>
                  Print Crate Plan
                </button>
                <button type="button" className="btn-primary bg-[#7c3aed] hover:bg-[#6d28d9]" onClick={() => printContainerPlan(project, insights)}>
                  Print Container Plan
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <KpiCard label="Total Parts"         value={insights.efficiency_kpis?.piece_count || 0} />
              <KpiCard label="Total Weight"        value={`${formatNumber(insights.summary?.shipment_weight)} kg`} />
              <KpiCard label="Crates Created"      value={insights.summary?.crates_created || 0} />
              <KpiCard label="Avg Crate Fill"      value={`${formatNumber(insights.efficiency_kpis?.average_fill_percent)}%`} />
              <KpiCard label="Underloaded Crates"  value={insights.underfilled_crates?.length || 0} accent="text-[#b45309]" />
              <KpiCard label="Containers Needed"   value={insights.container_loading_plan?.summary?.total_containers || 0} />
            </div>
          </div>

          <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Container Options</div>
                <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Choose the active container mode</div>
              </div>
              <div className="rounded-full bg-[#f8fafc] px-4 py-2 text-sm text-[#475569]">
                Active: {project.preferred_container_mode === 'recommended' ? 'Auto recommendation' : project.preferred_container_mode}
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {(insights.container_options || []).map((option) => {
                const isActive =
                  project.preferred_container_mode === option.mode ||
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
                      <div>Weight utilization: {formatNumber(option.average_weight_utilization)}%</div>
                      <div>Floor utilization: {formatNumber(option.average_length_utilization)}%</div>
                      <div>Cost index: {formatNumber(option.cost_index)}</div>
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
        </>
      )}

      {!hasDraftPlan && (
        <div className="rounded-[32px] border border-[#bfdbfe] bg-[#f8fafc] px-6 py-12 text-center shadow-sm">
          <div className="text-xl font-semibold text-[#0f172a]">Ready to generate</div>
          <p className="mt-2 text-sm text-[#64748b]">
            Open <strong className="text-[#334155]">Dispatch &amp; build</strong> to create and save a crate plan.
          </p>
          <button
            type="button"
            className="mt-5 rounded-full border border-[#1d4ed8] bg-[#1d4ed8] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1e40af] transition-colors"
            onClick={() => setActiveTab('build-plan')}
          >
            Go to Dispatch &amp; build
          </button>
        </div>
      )}
    </div>
  );
};

export default PlannerSummaryTab;
