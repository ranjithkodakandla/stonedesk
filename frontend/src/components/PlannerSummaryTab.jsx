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

const STATUS_FLOW = [
  { key: 'draft',                label: 'Draft',                 desc: 'Project created, pieces being entered.' },
  { key: 'review_pending',       label: 'Review Pending',        desc: 'Submitted for manager review.' },
  { key: 'approved_for_packing', label: 'Approved for Packing',  desc: 'Approved. Ready to generate crate plan.' },
  { key: 'crate_planned',        label: 'Crate Planned',         desc: 'Crate plan generated. Under review.' },
  { key: 'packing_approved',     label: 'Packing Approved',      desc: 'Packing plan signed off.' },
  { key: 'container_planned',    label: 'Container Planned',     desc: 'Container loading plan finalised.' },
];

const STATUS_ORDER = STATUS_FLOW.map((s) => s.key);

const StatusFlowStrip = ({ currentStatus, onApprove, isRefreshing }) => {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus) ?? 0;

  return (
    <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
      <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Project Workflow</div>
      <div className="mt-1 text-xl font-semibold text-[#0f172a]">Approval gates</div>

      {/* Progress bar */}
      <div className="mt-5 flex items-center gap-0">
        {STATUS_FLOW.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          const upcoming = idx > currentIdx;
          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className={`h-6 w-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                    done    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : active ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-400'
                  }`}
                >
                  {done ? '✓' : idx + 1}
                </div>
                <div
                  className={`mt-1 text-center text-[10px] leading-tight max-w-[70px] ${
                    active ? 'font-semibold text-blue-700' : done ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </div>
              </div>
              {idx < STATUS_FLOW.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mt-[-16px] transition-colors ${
                    idx < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="mt-5 flex flex-wrap gap-3">
        {currentStatus === 'draft' && (
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => onApprove('review_pending')}
            className="rounded-full border border-amber-300 bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Submit for Review
          </button>
        )}
        {currentStatus === 'review_pending' && (
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => onApprove('approved_for_packing')}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Approve for Packing
          </button>
        )}
        {currentStatus === 'crate_planned' && (
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => onApprove('packing_approved')}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Approve Packing Plan
          </button>
        )}
      </div>
    </div>
  );
};

const PlannerSummaryTab = () => {
  const project    = usePlannerStore((s) => s.project);
  const insights   = usePlannerStore((s) => s.insights);
  const crates       = usePlannerStore((s) => s.crates);
  const isWorkspaceLoading  = usePlannerStore((s) => s.isWorkspaceLoading);
  const isRefreshing        = usePlannerStore((s) => s.isRefreshing);
  const setActiveTab        = usePlannerStore((s) => s.setActiveTab);
  const setPreferredContainerMode = usePlannerStore((s) => s.setPreferredContainerMode);
  const exportWorkbook      = usePlannerStore((s) => s.exportWorkbook);
  const approveProject      = usePlannerStore((s) => s.approveProject);
  const warningSummary = useMemo(
    () => summarizeWarnings(insights?.exceptions || []),
    [insights]
  );
  const recommendationReasons = useMemo(
    () => buildRecommendationReasons(insights),
    [insights]
  );

  const projectStatus = project?.status || 'draft';
  const projectId     = project?.id;
  const hasCratePlan =
    Boolean(insights?.crate_count > 0) || (Array.isArray(crates) && crates.length > 0);

  if (isWorkspaceLoading) {
    return (
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white px-6 py-20 text-center text-sm text-[#64748b] shadow-sm">
        Building planning summary...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow status strip */}
      <StatusFlowStrip
        currentStatus={projectStatus}
        onApprove={approveProject}
        isRefreshing={isRefreshing}
      />

      {/* Shipping recommendation — shown after a plan exists */}
      {hasCratePlan && insights && (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.3fr,0.7fr]">
            <div className="rounded-[36px] border border-[#dbe4f0] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_30%),linear-gradient(135deg,_#ffffff,_#f8fbff)] p-7 shadow-sm">
              <div className="text-xs uppercase tracking-[0.26em] text-[#64748b]">Step 3</div>
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
              <KpiCard label="Total Weight"        value={`${formatNumber(insights.summary?.shipment_weight, 0)} kg`} />
              <KpiCard label="Crates Created"      value={insights.summary?.crates_created || 0} />
              <KpiCard label="Avg Crate Fill"      value={`${formatNumber(insights.efficiency_kpis?.average_fill_percent, 1)}%`} />
              <KpiCard label="Underloaded Crates"  value={insights.underfilled_crates?.length || 0} accent="text-[#b45309]" />
              <KpiCard label="Containers Needed"   value={insights.container_loading_plan?.summary?.total_containers || 0} />
            </div>
          </div>

          {/* Container options */}
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

          {/* Warnings */}
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

      {/* Empty state */}
      {!hasCratePlan && projectStatus !== 'approved_for_packing' && projectStatus !== 'crate_planned' && (
        <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-16 text-center shadow-sm">
          <div className="text-xl font-semibold text-[#0f172a]">No crate plan yet</div>
          <div className="mt-2 text-sm text-[#64748b]">
            {projectStatus === 'draft' || projectStatus === 'review_pending'
              ? 'Approve the project for packing to unlock crate generation.'
              : 'Open Planning Workspace → Dispatch & build to generate the v3 crate and container layout.'}
          </div>
        </div>
      )}

      {projectStatus === 'approved_for_packing' && !hasCratePlan && (
        <div className="rounded-[32px] border border-[#bfdbfe] bg-[#f8fafc] px-6 py-8 text-center shadow-sm">
          <div className="text-lg font-semibold text-[#0f172a]">Ready to generate</div>
          <p className="mt-2 text-sm text-[#64748b]">
            Open <strong className="text-[#334155]">Planning Workspace</strong>, then the{' '}
            <strong className="text-[#334155]">Dispatch & build</strong> tab to run the planner.
          </p>
          <button
            type="button"
            className="btn-primary mt-5"
            onClick={() => setActiveTab('build-plan')}
          >
            Go to Dispatch & build
          </button>
        </div>
      )}
    </div>
  );
};

export default PlannerSummaryTab;
