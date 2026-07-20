import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Logo from './Logo';
import EntryForm from './EntryForm';
import UploadWorkspace from './UploadWorkspace';
import PiecesTable from './PiecesTable';
import PlannerV3Screen from './PlannerV3Screen';
import { usePlannerStore } from '../store/plannerStore';
import { formatNumber, getPieceWeight } from '../utils/plannerUtils';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const STATUS_CONFIG = {
  draft:                 { label: 'Draft',                  cls: 'bg-[#f1f5f9] text-[#64748b] border-[#cbd5e1]' },
  review_pending:        { label: 'Review Pending',          cls: 'bg-[#fffbeb] text-[#b45309] border-[#fcd34d]' },
  approved_for_packing:  { label: 'Approved for Packing',   cls: 'bg-[#ecfdf5] text-[#047857] border-[#6ee7b7]' },
  crate_planned:         { label: 'Crate Planned',           cls: 'bg-[#eff6ff] text-[#1d4ed8] border-[#93c5fd]' },
  packing_approved:      { label: 'Packing Approved',        cls: 'bg-[#f0fdf4] text-[#166534] border-[#86efac]' },
  container_planned:     { label: 'Container Planned',       cls: 'bg-[#eff6ff] text-[#1d4ed8] border-[#93c5fd]' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const ProjectWorkspace = ({ projectId, goBack }) => {
  const project = usePlannerStore((state) => state.project);
  const pieces = usePlannerStore((state) => state.pieces);
  const crates = usePlannerStore((state) => state.crates);
  const activeTab = usePlannerStore((state) => state.activeTab);
  const isWorkspaceLoading = usePlannerStore((state) => state.isWorkspaceLoading);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);
  const initialize = usePlannerStore((state) => state.initialize);
  const setActiveTab = usePlannerStore((state) => state.setActiveTab);
  const setProjectDraft = usePlannerStore((state) => state.setProjectDraft);
  const refreshWorkspace = usePlannerStore((state) => state.refreshWorkspace);
  const deletePiece = usePlannerStore((state) => state.deletePiece);
  const exportWorkbook = usePlannerStore((state) => state.exportWorkbook);
  const exportSourceData = usePlannerStore((state) => state.exportSourceData);
  const approveProject = usePlannerStore((state) => state.approveProject);

  const [mainTab, setMainTab] = useState('source-data'); // 'source-data' | 'planning'
  const [entryMode, setEntryMode] = useState('manual');  // 'manual' | 'upload'
  const [loadedDrawing, setLoadedDrawing] = useState(null);
  const [draftCratePlan, setDraftCratePlan] = useState(null);
  const requestEditSavedDraftPlan = usePlannerStore((s) => s.requestEditSavedDraftPlan);

  useEffect(() => {
    initialize(projectId);
  }, [initialize, projectId]);

  const refreshSavedDraftPlan = useCallback(() => {
    if (!projectId) return Promise.resolve(null);
    return axios.get(`${API_BASE}/projects/${projectId}/draft-crate-plan`)
      .then((res) => {
        const plan = res.data?.plan;
        if (plan?.draft_crates?.length) {
          setDraftCratePlan(plan);
          return plan;
        }
        setDraftCratePlan(null);
        return null;
      })
      .catch(() => null);
  }, [projectId]);

  useEffect(() => {
    refreshSavedDraftPlan();
  }, [refreshSavedDraftPlan]);

  useEffect(() => {
    if (mainTab !== 'planning') return;
    if (activeTab === 'summary' || activeTab === 'crate-plan') {
      refreshSavedDraftPlan();
    }
  }, [mainTab, activeTab, refreshSavedDraftPlan]);

  const hasPlan = crates.length > 0;
  const hasSavedDraftPlan = (draftCratePlan?.draft_crates?.length ?? 0) > 0;
  const projectStatus = project.status || 'draft';

  const planningUnlocked =
    hasPlan ||
    hasSavedDraftPlan ||
    (pieces.length > 0 &&
      ['approved_for_packing', 'crate_planned', 'container_planned'].includes(projectStatus));

  const openEditDraftPlan = () => {
    requestEditSavedDraftPlan();
    setMainTab('planning');
    setActiveTab('build-plan');
  };

  const openPlanningBuild = () => {
    setMainTab('planning');
    setActiveTab('build-plan');
  };

  useEffect(() => {
    if (mainTab !== 'planning' || !planningUnlocked) return;
    if (activeTab !== 'build-plan') setActiveTab('build-plan');
  }, [mainTab, planningUnlocked, activeTab, setActiveTab]);

  const totalWeight = pieces.reduce((sum, piece) => sum + getPieceWeight(piece, project), 0);
  const totalSqFt = pieces.reduce((sum, piece) => sum + ((Number(piece.length || 0) * Number(piece.width || 0)) / 144) * (Number(piece.qty) || 1), 0);
  const totalQty = pieces.reduce((sum, p) => sum + (Number(p.qty) || 1), 0);

  const drawingsByNumber = useMemo(() => {
    const map = new Map();
    pieces.forEach((piece) => {
      const drawingNo = piece.drawing || 'Unnamed';
      if (!map.has(drawingNo)) {
        map.set(drawingNo, []);
      }
      map.get(drawingNo).push(piece);
    });
    return map;
  }, [pieces]);

  const buildDrawingDraftFromPieces = (sourcePieces, drawingNo = '') => {
    if (!sourcePieces.length) return null;
    const sortedPieces = [...sourcePieces].sort((a, b) => (a.id || 0) - (b.id || 0));
    const first = sortedPieces[0];
    const seen = new Set();
    const uniqueParts = [];

    sortedPieces.forEach((piece) => {
      const key = [
        piece.part_no || '',
        piece.part || '',
        piece.length || '',
        piece.width || '',
      ].join('|');
      if (seen.has(key)) {
        const idx = uniqueParts.findIndex((row) => (
          row.part_no === (piece.part_no || '') &&
          row.part === (piece.part || '') &&
          row.length === (piece.length || '') &&
          row.width === (piece.width || '')
        ));
        if (idx >= 0) uniqueParts[idx].qty += 1;
        return;
      }
      seen.add(key);
      uniqueParts.push({
        part_no: piece.part_no || '',
        part: piece.part || '',
        length: piece.length || '',
        width: piece.width || '',
        thickness: piece.thickness || '3CM',
        qty: 1,
        sink_type: piece.sink_type || 'No Sink',
        sink_cut: piece.sink_cut || '-',
        tap_holes: piece.tap_holes || '-',
        grooves: piece.grooves || '-',
        edge: piece.edge || 'None',
        edge_area: piece.edge_area || '',
        edge_map: piece.edge_map || {},
        edge_polish_manual: piece.edge_polish_manual || '',
        radius: piece.radius || '-',
        radius_value: piece.radius_value || '',
        radius_corners: piece.radius_corners || {},
        shape_type: piece.shape_type || '',
        notes: piece.notes || '',
      });
    });

    const buildings = [...new Set(sortedPieces.map((p) => String(p.building || '').trim()).filter(Boolean))].sort();
    const floors = [...new Set(sortedPieces.map((p) => String(p.floor || '').trim()).filter(Boolean))].sort();
    const cells = {};
    sortedPieces.forEach((piece) => {
      const building = String(piece.building || '').trim();
      const floor = String(piece.floor || '').trim();
      const flat = String(piece.flat || '').trim();
      if (!building || !floor || !flat) return;
      const key = `${building}__${floor}`;
      if (!cells[key]) cells[key] = [];
      if (!cells[key].some((entry) => entry.flat === flat)) {
        cells[key].push({ flat, qty: 1 });
      }
    });

    return {
      drawing: drawingNo,
      unit: first.unit || '',
      category: first.category || 'Vanity',
      fragility: first.fragility || 'Standard',
      orientation: first.orientation || 'Auto',
      delivery_priority: first.delivery_priority || 'Standard',
      stack_preference: first.stack_preference || 'Auto',
      weight_override: first.weight_override || 0,
      thickness: first.thickness || project.thickness || '3CM',
      pieces: sortedPieces,
      unique_parts: uniqueParts,
      buildings,
      floors,
      cells,
    };
  };

  const buildDrawingDraft = (drawingNo) => {
    const drawingPieces = drawingsByNumber.get(drawingNo) || [];
    return buildDrawingDraftFromPieces(drawingPieces, drawingNo);
  };

  const handleLoadDrawing = (selection) => {
    if (!selection) return;

    let sourcePieces = [];
    let drawingNo = '';

    if (Array.isArray(selection)) {
      const selectedPieces = selection.filter(Boolean);
      if (!selectedPieces.length) return;
      const uniqueDrawings = [...new Set(selectedPieces.map((piece) => piece.drawing).filter(Boolean))];
      if (uniqueDrawings.length === 1) {
        drawingNo = uniqueDrawings[0];
        sourcePieces = drawingsByNumber.get(drawingNo) || selectedPieces;
      } else {
        const union = new Map();
        uniqueDrawings.forEach((dn) => {
          (drawingsByNumber.get(dn) || []).forEach((piece) => union.set(piece.id, piece));
        });
        sourcePieces = [...union.values()];
        drawingNo = uniqueDrawings[0] || selectedPieces[0].drawing || '';
      }
    } else if (typeof selection === 'object') {
      drawingNo = selection.drawing || '';
      sourcePieces = drawingsByNumber.get(drawingNo) || [];
    } else {
      drawingNo = selection;
      sourcePieces = drawingsByNumber.get(drawingNo) || [];
    }

    const draft = buildDrawingDraftFromPieces(sourcePieces, drawingNo);
    if (!draft) return;
    setLoadedDrawing(draft);
    setEntryMode('manual');
    setMainTab('source-data');
  };

  const handleApprove = async (status) => {
    try {
      await approveProject(status);
    } catch (err) {
      console.error('Status update failed:', err);
      alert('Failed to update status. Please try again.');
    }
  };

  // When plan exists and user navigates here, default to planning tab
  useEffect(() => {
    if (hasPlan && mainTab === 'source-data') {
      // Keep source-data as default when user first loads
    }
  }, [hasPlan]);

  if (isWorkspaceLoading) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,_#f6f8fc,_#f8fafc)] text-[#1e293b] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center mb-4">
            <span className="h-10 w-10 rounded-full border-[3px] border-[#1d4ed8] border-t-transparent animate-spin" />
          </div>
          <div className="text-sm text-[#64748b]">Loading project...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f6f8fc,_#f8fafc)] text-[#1e293b]">
      <div className="mx-auto max-w-[1600px] px-5 py-6 lg:px-8">
        <div className="rounded-[36px] border border-[#dbe4f0] bg-white shadow-sm">

          {/* ── Header Bar ── */}
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
              {hasPlan && (
                <button
                  type="button"
                  className="btn-primary bg-[#059669] hover:bg-[#047857]"
                  onClick={exportWorkbook}
                >
                  Export Final Plan
                </button>
              )}
            </div>
          </div>

          {/* ── Project Info Header ── */}
          <div className="border-b border-[#edf2f7] px-6 py-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-[#64748b]">Project</div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-3xl font-semibold text-[#0f172a]">
                    {project.name || `Project #${projectId}`}
                  </div>
                  <StatusBadge status={projectStatus} />
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#64748b]">
                  <span>{project.customer || 'No customer set'}</span>
                  <span>•</span>
                  <span>{project.job_number || 'No job number'}</span>
                  <span>•</span>
                  <span>{project.material}</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Total Parts</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{totalQty}</div>
                </div>
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Total Sq Ft</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{formatNumber(totalSqFt)}</div>
                </div>
                <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Shipment Weight</div>
                  <div className="mt-2 text-2xl font-semibold text-[#0f172a]">{formatNumber(totalWeight)} kg</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main Tabs: Source Data | Planning ── */}
          <div className="border-b border-[#edf2f7] px-6 py-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMainTab('source-data')}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                  mainTab === 'source-data'
                    ? 'bg-[#1d4ed8] text-white shadow-sm'
                    : 'bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0]'
                }`}
              >
                Source Data
              </button>
              <button
                type="button"
                disabled={!planningUnlocked}
                onClick={() => {
                  if (!planningUnlocked) return;
                  setMainTab('planning');
                  if (!hasPlan) setActiveTab('build-plan');
                }}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                  mainTab === 'planning'
                    ? 'bg-[#1d4ed8] text-white shadow-sm'
                    : !planningUnlocked
                    ? 'bg-[#f1f5f9] text-[#94a3b8] cursor-not-allowed'
                    : 'bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0]'
                }`}
              >
                Planning Workspace
                {!planningUnlocked && (
                  <span className="ml-2 text-[10px] text-[#94a3b8]">(Approve for packing with parts)</span>
                )}
                {planningUnlocked && !hasPlan && (
                  <span className="ml-2 text-[10px] text-[#64748b]">(Dispatch & build)</span>
                )}
              </button>
              {!planningUnlocked && pieces.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleApprove('approved_for_packing')}
                  className="rounded-full px-5 py-2.5 text-sm font-semibold bg-[#ecfdf5] text-[#047857] border border-[#6ee7b7] hover:bg-[#d1fae5] transition-all"
                >
                  Approve for Packing
                </button>
              )}
            </div>
          </div>

          {/* ── Tab Content ── */}

          {/* ▸ Tab 1: Source Data */}
          {mainTab === 'source-data' && (
            <>
              {/* Manual Entry | Automated Upload sub-navigation */}
              <div className="border-b border-[#edf2f7] px-6 pt-4 pb-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEntryMode('manual')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
                    entryMode === 'manual'
                      ? 'border-[#1d4ed8] text-[#1d4ed8]'
                      : 'border-transparent text-[#64748b] hover:text-[#334155]'
                  }`}>
                  Manual Entry
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('upload')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
                    entryMode === 'upload'
                      ? 'border-[#1d4ed8] text-[#1d4ed8]'
                      : 'border-transparent text-[#64748b] hover:text-[#334155]'
                  }`}>
                  Automated Upload
                </button>
              </div>

              <div className="px-6 py-6 pb-64">
                {entryMode === 'manual' && (
                  <EntryForm
                    project={project}
                    setProject={setProjectDraft}
                    onDataChange={refreshWorkspace}
                    loadedDrawing={loadedDrawing}
                    onLoadedDrawingClear={() => setLoadedDrawing(null)}
                  />
                )}
                {entryMode === 'upload' && (
                  <UploadWorkspace
                    project={project}
                    onDataChange={refreshWorkspace}
                    onSwitchToManual={() => setEntryMode('manual')}
                  />
                )}
                {/* Manual Entry only — Automated Upload has its own review grid with the same search/checkbox/Edit/Delete pattern for draft rows */}
                {entryMode === 'manual' && (
                  <PiecesTable
                    pieces={pieces}
                    project={project}
                    onDelete={deletePiece}
                    onDataChange={refreshWorkspace}
                    onLoadDrawing={handleLoadDrawing}
                  />
                )}
              </div>

              {/* Source Data Footer */}
              <div className="sticky bottom-0 z-20 border-t border-[#edf2f7] bg-white px-6 py-5 rounded-b-[36px]">

                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="text-sm text-[#64748b]">
                    {pieces.length === 0
                      ? 'Add parts above to enable plan generation'
                      : `${totalQty} parts ready • ${formatNumber(totalSqFt)} sq ft • ${formatNumber(totalWeight)} kg`}
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    {pieces.length > 0 && (
                      <button
                        type="button"
                        onClick={exportSourceData}
                        className="rounded-full border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] transition-all"
                      >
                        ↓ Download Source Data
                      </button>
                    )}

                    {['approved_for_packing', 'crate_planned', 'container_planned'].includes(projectStatus) && (
                      <button
                        type="button"
                        disabled={pieces.length === 0}
                        onClick={() => pieces.length > 0 && openPlanningBuild()}
                        className={`inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all ${
                          pieces.length === 0
                            ? 'bg-[#94a3b8] cursor-not-allowed'
                            : 'bg-[#1d4ed8] hover:bg-[#1e40af] hover:shadow-md'
                        }`}
                      >
                        {hasPlan ? 'Planning: dispatch & build' : 'Planning: generate crate plan →'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ▸ Tab 2: Planning Workspace — Crate Planning only, other steps hidden */}
          {mainTab === 'planning' && planningUnlocked && (
            <div className="px-6 py-6">
              <PlannerV3Screen
                projectId={projectId}
                savedPlan={draftCratePlan}
                onPlanSaved={setDraftCratePlan}
              />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default ProjectWorkspace;
