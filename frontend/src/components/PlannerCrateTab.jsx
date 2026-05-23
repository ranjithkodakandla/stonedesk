import React from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';
import { DraftCrateCard, CratePlanSummary } from './DraftCrateWorkspace';
import { usePlannerStore } from '../store/plannerStore';

const PlannerCrateTab = ({ draftCratePlan = null, projectId = null }) => {
  const setActiveTab = usePlannerStore((s) => s.setActiveTab);

  const handleDownload = () => {
    axios.post(`${API_BASE}/projects/${projectId}/draft-crate-plan/export`, {
      draft_crates: draftCratePlan.draft_crates,
    }, { responseType: 'blob' }).then((res) => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const disp = res.headers['content-disposition'] || '';
      const match = disp.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : 'CratePlan.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }).catch(() => alert('Download failed'));
  };

  if (!draftCratePlan?.draft_crates?.length) {
    return (
      <div className="space-y-6">
        <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-16 text-center shadow-sm">
          <div className="text-xl font-semibold text-[#0f172a]">No saved crate plan yet</div>
          <div className="mt-2 text-sm text-[#64748b]">
            Go to Step 2 (Dispatch &amp; build) to create and save a plan.
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
      {/* Header */}
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Crate Contents — Saved Plan</div>
            <div className="mt-1 text-xl font-semibold text-[#0f172a]">
              {draftCratePlan.draft_crates.length} crate{draftCratePlan.draft_crates.length !== 1 ? 's' : ''} saved
              {draftCratePlan.saved_at && (
                <span className="ml-3 text-sm font-normal text-[#64748b]">
                  · Saved {new Date(draftCratePlan.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            className="shrink-0 rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-5 py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors"
          >
            Download Crate Plan
          </button>
        </div>
      </div>

      {/* Summary panel */}
      <CratePlanSummary
        draftCrates={draftCratePlan.draft_crates}
        targetWeightKg={draftCratePlan.target_weight_kg || 1900}
      />

      {/* Read-only crate cards */}
      <div className="space-y-4">
        {draftCratePlan.draft_crates.map((c) => (
          <DraftCrateCard
            key={c.id}
            crate={c}
            onRemoveBundle={null}
            onDeleteCrate={null}
            readOnly
          />
        ))}
      </div>
    </div>
  );
};

export default PlannerCrateTab;
