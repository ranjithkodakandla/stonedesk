import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE, downloadPersistedDraftCratePlan } from '../utils/plannerUtils';
import { fmt } from './DraftCrateWorkspace';
import CrateOptimizationViewer from './CrateOptimizationViewer';
import { getCrateOperationalStatus } from '../utils/crateEstimator';
import { usePlannerStore } from '../store/plannerStore';

const CRATE_TYPE_LABEL = {
  island_vertical:  'Island cassette',
  kitchen_vertical: 'Kitchen horizontal',
  vanity_vertical:  'Vanity horizontal',
  misc:             'Misc',
};

const STATUS_LABEL = {
  READY:       'Ready',
  UNDERLOADED: 'Underloaded',
  OVERWEIGHT:  'Overweight',
  REVIEW:      'Review',
  ERROR:       'Invalid',
};

function crateDimensionsLabel(crate) {
  const dims = crate.dimensions || {};
  const extL = dims.external_length;
  if (!extL) return '—';
  const ext = `${fmt(dims.external_length)} × ${fmt(dims.external_width)} × ${fmt(dims.external_height)}″`;
  if (dims.internal_length) {
    return `${ext} (int ${fmt(dims.internal_length)} × ${fmt(dims.internal_width)} × ${fmt(dims.internal_height)}″)`;
  }
  return ext;
}

const PlannerCrateTab = ({
  draftCratePlan = null,
  projectId = null,
  onPlanUpdated = null,
  onPlanDeleted = null,
  onEditPlan = null,
}) => {
  const setActiveTab = usePlannerStore((s) => s.setActiveTab);
  const [viewCrateId, setViewCrateId] = useState(null);
  const [deleteCrateId, setDeleteCrateId] = useState(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const crates = draftCratePlan?.draft_crates || [];
  const viewCrate = useMemo(
    () => crates.find((c) => c.id === viewCrateId) || null,
    [crates, viewCrateId],
  );

  const handleDownload = () => {
    if (!projectId) return;
    downloadPersistedDraftCratePlan(projectId).catch((err) => {
      alert(err.message || 'Could not download the saved plan from the server.');
    });
  };

  const persistCrates = async (nextCrates) => {
    if (!projectId) return null;
    setBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/projects/${projectId}/draft-crate-plan`, {
        target_weight_kg: draftCratePlan.target_weight_kg || 1900,
        dispatch_selection: draftCratePlan.dispatch_selection || {},
        draft_crates: nextCrates,
      });
      const plan = {
        draft_crates: nextCrates,
        target_weight_kg: draftCratePlan.target_weight_kg || 1900,
        dispatch_selection: draftCratePlan.dispatch_selection || {},
        saved_at: res.data.saved_at,
      };
      if (onPlanUpdated) onPlanUpdated(plan);
      return plan;
    } catch {
      alert('Could not save crate plan changes.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCrate = async () => {
    if (!deleteCrateId) return;
    const next = crates.filter((c) => c.id !== deleteCrateId);
    setDeleteCrateId(null);
    if (viewCrateId === deleteCrateId) setViewCrateId(null);
    if (next.length === 0) {
      await handleDeleteEntirePlan(true);
      return;
    }
    await persistCrates(next);
  };

  const handleDeleteEntirePlan = async (skipConfirm = false) => {
    if (!skipConfirm && !confirmDeleteAll) {
      setConfirmDeleteAll(true);
      return;
    }
    if (!projectId) return;
    setBusy(true);
    try {
      await axios.delete(`${API_BASE}/projects/${projectId}/draft-crate-plan`);
      setConfirmDeleteAll(false);
      setViewCrateId(null);
      if (onPlanDeleted) onPlanDeleted();
      setActiveTab('build-plan');
    } catch {
      alert('Could not delete crate plan.');
    } finally {
      setBusy(false);
    }
  };

  if (!draftCratePlan?.draft_crates?.length) {
    return (
      <div className="space-y-6">
        <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-16 text-center shadow-sm">
          <div className="text-xl font-semibold text-[#0f172a]">No saved crate plan found.</div>
          <div className="mt-2 text-sm text-[#64748b]">
            Create and save a plan in Dispatch &amp; build first.
          </div>
          <button
            type="button"
            className="mt-5 rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-6 py-2.5 text-sm font-semibold text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors"
            onClick={() => setActiveTab('build-plan')}
          >
            Go to Dispatch &amp; build
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Step 3 — Crate contents</div>
            <p className="mt-1 text-sm text-[#64748b]">
              Last saved version from the server — unsaved changes in Dispatch &amp; build are not shown here.
            </p>
            <div className="mt-1 text-xl font-semibold text-[#0f172a]">
              {crates.length} crate{crates.length !== 1 ? 's' : ''} in saved plan
              {draftCratePlan.saved_at && (
                <span className="ml-3 text-sm font-normal text-[#64748b]">
                  · Saved {new Date(draftCratePlan.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy}
              title="Downloads the last saved plan from the server (unsaved Dispatch edits are not included)"
              className="rounded-full border border-[#059669] bg-[#f0fdf4] px-5 py-2 text-sm font-semibold text-[#059669] hover:bg-[#dcfce7] transition-colors"
            >
              Download Saved Plan
            </button>
            {confirmDeleteAll ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDeleteEntirePlan(true)}
                  className="rounded-full border border-red-600 bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  Confirm delete entire plan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteAll(false)}
                  className="rounded-full border border-[#e2e8f0] bg-white px-5 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f8fafc] transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDeleteAll(true)}
                className="rounded-full border border-[#fee2e2] bg-[#fff5f5] px-5 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete Entire Crate Plan
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-[#dbe4f0] bg-white shadow-sm overflow-hidden">
        <div className="border-b border-[#e8edf3] px-5 py-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Crate summary</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[#e8edf3] bg-[#f8fafc] text-left text-[10px] uppercase tracking-wide text-[#64748b]">
                <th className="px-4 py-3 font-semibold">Crate ID</th>
                <th className="px-4 py-3 font-semibold">Crate Type</th>
                <th className="px-4 py-3 font-semibold text-right">Part Count</th>
                <th className="px-4 py-3 font-semibold text-right">Weight</th>
                <th className="px-4 py-3 font-semibold text-right">SqFt</th>
                <th className="px-4 py-3 font-semibold">Dimensions</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {crates.map((crate) => {
                const statusKey = getCrateOperationalStatus(crate);
                return (
                  <tr key={crate.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc]">
                    <td className="px-4 py-3 font-mono font-semibold text-[#0f172a]">{crate.id}</td>
                    <td className="px-4 py-3 text-[#334155]">
                      {CRATE_TYPE_LABEL[crate.crate_class] || crate.crate_class || '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{crate.part_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(crate.total_weight_kg)} kg</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(crate.total_sqft)}</td>
                    <td className="px-4 py-3 text-xs text-[#475569] max-w-[220px]">{crateDimensionsLabel(crate)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-0.5 text-[11px] font-medium text-[#334155]">
                        {STATUS_LABEL[statusKey] || statusKey}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setViewCrateId(crate.id)}
                          className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-semibold text-[#1d4ed8] hover:bg-[#eff6ff]"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => (onEditPlan ? onEditPlan() : setActiveTab('build-plan'))}
                          className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc]"
                        >
                          Edit
                        </button>
                        {deleteCrateId === crate.id ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={handleDeleteCrate}
                              className="rounded-full border border-red-600 bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                            >
                              Confirm delete {crate.id}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDeleteCrateId(null)}
                              className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-semibold text-[#475569]"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleteCrateId(crate.id)}
                            className="rounded-full border border-[#fee2e2] bg-[#fff5f5] px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {viewCrate && (
        <CrateOptimizationViewer
          crate={viewCrate}
          allCrates={crates}
          targetWeightKg={draftCratePlan?.target_weight_kg || 1900}
          busy={busy}
          onClose={() => setViewCrateId(null)}
          onCrateDeleted={(deletedId) => {
            if (viewCrateId === deletedId) setViewCrateId(null);
          }}
          onApplyPlan={async (nextCrates) => {
            const plan = await persistCrates(nextCrates);
            return plan != null;
          }}
        />
      )}
    </div>
  );
};

export default PlannerCrateTab;
