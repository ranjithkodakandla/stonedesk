import React, { useEffect } from 'react';
import Logo from './Logo';
import SourceDataModal from './SourceDataModal';
import PlannerSummaryTab from './PlannerSummaryTab';
import PlannerCrateTab from './PlannerCrateTab';
import PlannerContainerTab from './PlannerContainerTab';
import { usePlannerStore } from '../store/plannerStore';
import { formatNumber, getPieceWeight } from '../utils/plannerUtils';

const tabs = [
  { id: 'summary', label: 'Summary / Insights', step: 'Step 1' },
  { id: 'crate-plan', label: 'Crate Plan', step: 'Step 2' },
  { id: 'container-loading', label: 'Container Loading', step: 'Step 3' },
];

const ProjectWorkspace = ({ projectId, goBack }) => {
  const {
    project,
    pieces,
    activeTab,
    sourceDataOpen,
    initialize,
    setActiveTab,
    openSourceData,
    closeSourceData,
    setProjectDraft,
    refreshWorkspace,
    deletePiece,
    exportWorkbook,
  } = usePlannerStore((state) => ({
    project: state.project,
    pieces: state.pieces,
    activeTab: state.activeTab,
    sourceDataOpen: state.sourceDataOpen,
    initialize: state.initialize,
    setActiveTab: state.setActiveTab,
    openSourceData: state.openSourceData,
    closeSourceData: state.closeSourceData,
    setProjectDraft: state.setProjectDraft,
    refreshWorkspace: state.refreshWorkspace,
    deletePiece: state.deletePiece,
    exportWorkbook: state.exportWorkbook,
  }));

  useEffect(() => {
    initialize(projectId);
  }, [initialize, projectId]);

  const totalWeight = pieces.reduce((sum, piece) => sum + getPieceWeight(piece, project), 0);
  const totalSqFt = pieces.reduce((sum, piece) => sum + ((Number(piece.length || 0) * Number(piece.width || 0)) / 144) * (Number(piece.qty) || 1), 0);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f6f8fc,_#f8fafc)] text-[#1e293b]">
      <div className="mx-auto max-w-[1600px] px-5 py-6 lg:px-8">
        <div className="rounded-[36px] border border-[#dbe4f0] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#edf2f7] px-6 py-5">
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={goBack}
                className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#f8fafc]"
              >
                ← Back
              </button>
              <Logo />
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-primary" onClick={openSourceData}>
                Manage Source Data
              </button>
              <button
                type="button"
                className={`btn-primary bg-[#059669] hover:bg-[#047857] ${pieces.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={exportWorkbook}
                disabled={pieces.length === 0}
              >
                Export Final Plan
              </button>
            </div>
          </div>

          <div className="border-b border-[#edf2f7] px-6 py-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-[#64748b]">Planning Workspace</div>
                <div className="mt-2 text-3xl font-semibold text-[#0f172a]">
                  {project.name || `Project #${projectId}`}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#64748b]">
                  <span>{project.customer || 'No customer set'}</span>
                  <span>•</span>
                  <span>{project.job_number || 'No job number'}</span>
                  <span>•</span>
                  <span>{project.material} / {project.thickness}</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Total Parts</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{pieces.reduce((sum, piece) => sum + (Number(piece.qty) || 1), 0)}</div>
                </div>
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Total Sq Ft</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{formatNumber(totalSqFt, 1)}</div>
                </div>
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Shipment Weight</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{formatNumber(totalWeight, 0)} kg</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-[24px] border px-4 py-3 text-left transition-all ${
                    activeTab === tab.id
                      ? 'border-[#1d4ed8] bg-[#eff6ff] text-[#1d4ed8] shadow-sm'
                      : 'border-[#dbe4f0] bg-[#f8fafc] text-[#334155] hover:bg-white'
                  }`}
                >
                  <div className="text-xs uppercase tracking-[0.16em]">{tab.step}</div>
                  <div className="mt-1 text-sm font-semibold">{tab.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 py-6">
            {activeTab === 'summary' && <PlannerSummaryTab />}
            {activeTab === 'crate-plan' && <PlannerCrateTab />}
            {activeTab === 'container-loading' && <PlannerContainerTab />}
          </div>
        </div>
      </div>

      <SourceDataModal
        isOpen={sourceDataOpen}
        onClose={closeSourceData}
        project={project}
        setProject={setProjectDraft}
        pieces={pieces}
        onDeletePiece={deletePiece}
        onDataChange={refreshWorkspace}
      />
    </div>
  );
};

export default ProjectWorkspace;
