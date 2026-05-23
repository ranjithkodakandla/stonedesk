import React, { useMemo, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';
import DispatchSelectionPanel from './DispatchSelectionPanel';
import DispatchInventoryExplorer from './DispatchInventoryExplorer';
import DraftCrateWorkspace from './DraftCrateWorkspace';
import { buildDraftCrate, recomputeCrate, getNextDraftCrateId, batchBundlesIntoCrates, getCrateClass } from '../utils/crateEstimator';
import IslandOperationalReview from './IslandOperationalReview';
import KitchenOperationalReview from './KitchenOperationalReview';
import Container3DPreview from './planner3d/Container3DPreview';
import CrateOperationalDiagram2D from './planner2d/CrateOperationalDiagram2D';
import ContainerTopDown2D from './planner2d/ContainerTopDown2D';
import PlannerManualMovePanel from './PlannerManualMovePanel';
import UnderloadedCrateAssistant from './UnderloadedCrateAssistant';
import { usePlannerStore } from '../store/plannerStore';
import {
  buildPlacements3DFromManual,
  computedCrateWeightKg,
  inferCrateClass,
  inferOrientation,
  normalizeAllPlacementsFor3D,
  normalizePlacementsFor3D,
  splashLayerLabel,
} from '../utils/plannerDisplay';
import { buildPiecesByCrate, CONTAINER_SPECS, formatNumber, getPieceWeight, PLANNER_2D_UI_ENABLED } from '../utils/plannerUtils';
import { printV3OperationalPackSheet } from '../utils/printUtils';

/**
 * Assisted Crate Planning — dispatch scope, inventory selection, draft crate builder.
 * Optimizer-era UI sections are preserved in code but hidden while manual planning is active.
 * `onClose` is optional legacy hook (no-op) for older callers.
 */

// Set to true to restore optimizer workflow UI (fleet decision, 3D container, crate table, etc.)
const OPTIMIZER_UI_ENABLED = false;

const PlannerV3Screen = ({
  projectId,
  onClose = () => {},
  savedPlan = null,
  onPlanSaved = null,
}) => {
  const project = usePlannerStore((s) => s.project);
  const pieces = usePlannerStore((s) => s.pieces);
  const crates = usePlannerStore((s) => s.crates);
  const assignments = usePlannerStore((s) => s.assignments);
  const generateV3Plan = usePlannerStore((s) => s.generateV3Plan);
  const isRefreshing = usePlannerStore((s) => s.isRefreshing);
  const setDeliveryPayloadCapKg = usePlannerStore((s) => s.setDeliveryPayloadCapKg);
  const draftPlanHydration = usePlannerStore((s) => s.draftPlanHydration);
  const consumeDraftPlanHydration = usePlannerStore((s) => s.consumeDraftPlanHydration);

  const [lastMessage, setLastMessage] = useState(null);
  const [selectedCrateId, setSelectedCrateId] = useState(null);
  const [dispatchSelection, setDispatchSelection] = useState(null);

  // ── Draft crate state (Step 3A) ──────────────────────────────────────────
  const [draftCrates, setDraftCrates] = useState([]);
  const [targetWeightKg, setTargetWeightKg] = useState(1900);
  const [savedAt, setSavedAt] = useState(null);
  // When a saved plan is found on mount, hold it here until the user decides
  const [savedPlanCandidate, setSavedPlanCandidate] = useState(null);

  const applySavedPlan = useCallback((plan) => {
    if (!plan?.draft_crates?.length) return;
    setDraftCrates(plan.draft_crates);
    if (plan.target_weight_kg) setTargetWeightKg(plan.target_weight_kg);
    if (plan.dispatch_selection) setDispatchSelection(plan.dispatch_selection);
    setSavedAt(plan.saved_at);
    setSavedPlanCandidate(null);
    setLastMessage(
      `Loaded saved plan (${new Date(plan.saved_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}).`,
    );
  }, []);

  // ── Watch savedPlan prop (loaded by ProjectWorkspace) ────────────────────
  useEffect(() => {
    if (!savedPlan?.draft_crates?.length) return;
    if (draftPlanHydration === 'auto') {
      applySavedPlan(savedPlan);
      consumeDraftPlanHydration();
      return;
    }
    if (draftCrates.length === 0) {
      setSavedPlanCandidate(savedPlan);
    }
  }, [savedPlan, draftPlanHydration, draftCrates.length, applySavedPlan, consumeDraftPlanHydration]);

  const handleLoadSavedPlan = useCallback(() => {
    if (!savedPlanCandidate) return;
    applySavedPlan(savedPlanCandidate);
  }, [savedPlanCandidate, applySavedPlan]);

  const handleDiscardSavedPlan = useCallback(() => {
    setSavedPlanCandidate(null);
    setLastMessage('Starting fresh — saved plan discarded from view.');
  }, []);

  // Map of unit_id → crateId for all bundles currently in a draft crate (Step 3F)
  const assignedBundleIds = useMemo(() => {
    const m = new Map();
    for (const c of draftCrates) {
      for (const b of c.bundles) m.set(b.unit_id, c.id);
    }
    return m;
  }, [draftCrates]);

  const activeCrateId = selectedCrateId ?? crates[0]?.id ?? null;
  const selectedCrate = crates.find((c) => c.id === activeCrateId) || null;

  const layout = project?.planner_v3_layout;
  const decision = layout?.container_decision;
  const containerOpt = project?.planner_v3_container_optimization;
  const optLabel =
    containerOpt?.chosen_strategy === 'mixed_20_first'
      ? 'Mixed — 20′ first'
      : containerOpt?.chosen_strategy === 'mixed_40_first'
        ? 'Mixed — 40′ first'
        : containerOpt?.chosen_strategy === 'twenty_only'
          ? '20′ seed (economic)'
          : containerOpt?.chosen_strategy === 'forty_only'
            ? '40′ fleet'
            : containerOpt?.chosen_strategy === 'frozen'
              ? 'Frozen (locked)'
              : null;

  const fleetSelectionReason = project?.planner_v3_summary?.fleet_selection_reason;

  const { grouped } = useMemo(
    () => buildPiecesByCrate(pieces, crates, assignments),
    [pieces, crates, assignments],
  );

  const manualContainerDraft = useMemo(() => {
    const list = project?.manual_container_plan?.containers || [];
    return list.find((c) => (c.placements || []).length) || list[0];
  }, [project?.manual_container_plan]);

  const placements3d = useMemo(() => {
    if (!crates.length) return [];
    const v3c = project?.planner_v3_containers;
    if (Array.isArray(v3c) && v3c.length) {
      const merged = normalizeAllPlacementsFor3D(v3c, crates);
      if (merged.length) return merged;
    }
    const mcontainers = project?.manual_container_plan?.containers || [];
    const mergedManual = [];
    for (const cont of mcontainers) {
      if (!cont?.placements?.length) continue;
      mergedManual.push(...buildPlacements3DFromManual(cont, crates, project, layout));
    }
    if (mergedManual.length) return mergedManual;
    return normalizePlacementsFor3D(layout, crates);
  }, [project?.planner_v3_containers, project?.manual_container_plan, crates, project, layout]);

  const containerSpec = CONTAINER_SPECS[manualContainerDraft?.type || '20ft'] || CONTAINER_SPECS['20ft'];
  const interior = layout?.container_interior_in || { length: 233, width: 92, max_clear_height: 100 };
  const payloadCapKg = Number(project.delivery_payload_cap_kg) > 0 ? Number(project.delivery_payload_cap_kg) : 24000;

  const handleGenerate = async (sel) => {
    setLastMessage(null);
    try {
      const res = await generateV3Plan(sel);
      setLastMessage(res?.message || 'Plan generated.');
    } catch (e) {
      const d = e.response?.data?.detail;
      setLastMessage(typeof d === 'string' ? d : e.message || 'Generation failed.');
    }
  };

  // Step 3B / 4A — Create draft crates from selected bundles.
  // Applies category-aware partitioning + weight batching before building each crate.
  const handleCreateDraftCrate = useCallback((selectedBundles) => {
    if (!selectedBundles?.length) return;
    const groups = batchBundlesIntoCrates(selectedBundles, targetWeightKg);
    if (!groups.length) return;
    setDraftCrates((prev) => {
      const newCrates = [];
      let all = [...prev];
      for (const group of groups) {
        const id = getNextDraftCrateId(all);
        const crate = buildDraftCrate(id, group.bundles);
        // Never persist a crate with no content
        if ((crate.part_count || 0) === 0 && (crate.total_weight_kg || 0) === 0) continue;
        newCrates.push(crate);
        all = [...all, crate];
      }
      if (newCrates.length === 1) {
        const c = newCrates[0];
        setLastMessage(
          `${c.id} created — ${c.part_count} parts, ` +
          `${c.total_weight_kg.toLocaleString('en-AU')} kg.`,
        );
      } else {
        const lines = newCrates.map((c) => `${c.id} — ${c.total_weight_kg.toLocaleString('en-AU')} kg`).join(' · ');
        setLastMessage(`Created ${newCrates.length} draft crates: ${lines}`);
      }
      return all;
    });
  }, [targetWeightKg]);

  // Step 3E — Remove a single bundle from a draft crate (returns to inventory)
  const handleRemoveBundleFromCrate = useCallback((crateId, bundleUnitId) => {
    setDraftCrates((prev) =>
      prev
        .map((c) => {
          if (c.id !== crateId) return c;
          const bundles = c.bundles.filter((b) => b.unit_id !== bundleUnitId);
          if (bundles.length === 0) return null; // will be filtered below
          return recomputeCrate({ ...c, bundles });
        })
        .filter(Boolean),
    );
  }, []);

  // Step 3E — Delete an entire draft crate (all bundles return to inventory)
  const handleDeleteDraftCrate = useCallback((crateId) => {
    setDraftCrates((prev) => prev.filter((c) => c.id !== crateId));
  }, []);

  // Step 3G — Persist the current plan to the backend
  const handleSavePlan = useCallback(() => {
    if (!projectId || !draftCrates.length) return;
    axios.post(`${API_BASE}/projects/${projectId}/draft-crate-plan`, {
      target_weight_kg: targetWeightKg,
      dispatch_selection: dispatchSelection,
      draft_crates: draftCrates,
    }).then((res) => {
      const plan = {
        draft_crates: draftCrates,
        target_weight_kg: targetWeightKg,
        dispatch_selection: dispatchSelection,
        saved_at: res.data.saved_at,
      };
      setSavedAt(res.data.saved_at);
      setLastMessage('Crate plan saved.');
      if (onPlanSaved) onPlanSaved(plan);
    }).catch(() => {
      setLastMessage('Save failed — check connection and retry.');
    });
  }, [projectId, draftCrates, targetWeightKg, dispatchSelection]);

  // Step 4B/4C — Add bundles to an existing draft crate (dedup by unit_id, then recompute)
  const handleAddBundlesToCrate = useCallback((crateId, newBundles) => {
    if (!newBundles?.length) return;
    setDraftCrates((prev) =>
      prev.map((c) => {
        if (c.id !== crateId) return c;
        const incomingClass = getCrateClass(newBundles[0]);
        if (c.crate_class && incomingClass !== c.crate_class) {
          setLastMessage(
            `Cannot add to ${crateId} — part group type (${incomingClass}) does not match crate type (${c.crate_class}).`,
          );
          return c;
        }
        const existingIds = new Set(c.bundles.map((b) => b.unit_id));
        const merged = [...c.bundles, ...newBundles.filter((b) => !existingIds.has(b.unit_id))];
        const updated = recomputeCrate({ ...c, bundles: merged });
        setLastMessage(
          `${crateId} updated — ${updated.part_count} parts, ` +
          `${updated.total_weight_kg.toLocaleString('en-AU')} kg.`,
        );
        return updated;
      }),
    );
  }, []);


  const legacyPlan = crates.length > 0 && crates.some((c) => (c.packing_mode || '') !== 'v3');

  const islandOpsUiEnabled = import.meta.env.VITE_PLANNER_V3_OPERATIONAL === 'true';
  const projectStatus = project?.status || 'draft';
  const canIslandPlan =
    islandOpsUiEnabled &&
    ['approved_for_packing', 'crate_planned', 'container_planned'].includes(projectStatus) &&
    pieces.length > 0;
  const canKitchenPlan =
    islandOpsUiEnabled &&
    ['approved_for_packing', 'crate_planned', 'container_planned'].includes(projectStatus) &&
    pieces.length > 0;

  return (
    <div className="space-y-6 text-[#0f172a]">
      {/* Header */}
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Dispatch & build</div>
        <h2 className="mt-1 text-xl font-semibold text-[#0f172a]">
          {project.name || project.job_number || `Project #${projectId}`}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-[#64748b]">
          Select the dispatch scope, then choose parts to manually build crates.
          The system provides inventory visibility, dimension estimates, and operational warnings —
          you decide the load.
        </p>
      </div>

      {/* Load saved plan dialog — shown when a saved plan is found on mount */}
      {savedPlanCandidate && (
        <div className="rounded-[24px] border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="font-semibold text-blue-900">Saved crate plan found</div>
              <div className="mt-1 text-sm text-blue-700">
                Saved {new Date(savedPlanCandidate.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                {' — '}
                {savedPlanCandidate.draft_crates?.length ?? 0} crate{savedPlanCandidate.draft_crates?.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleLoadSavedPlan}
                className="rounded-full border border-blue-600 bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                Load saved plan
              </button>
              <button
                type="button"
                onClick={handleDiscardSavedPlan}
                className="rounded-full border border-blue-200 bg-white px-4 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors whitespace-nowrap"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — Dispatch scope selection */}
      <DispatchSelectionPanel
        projectId={projectId}
        onGenerate={handleGenerate}
        isGenerating={isRefreshing}
        onSelectionChange={setDispatchSelection}
        onApplySelection={setDispatchSelection}
        showGenerate={OPTIMIZER_UI_ENABLED}
      />

      {/* Step 2 — Inventory + part selection workspace */}
      <DispatchInventoryExplorer
        projectId={projectId}
        dispatchSelection={dispatchSelection}
        onCreateCrate={handleCreateDraftCrate}
        assignedBundleIds={assignedBundleIds}
        draftCrates={draftCrates}
        onAddToCrate={handleAddBundlesToCrate}
        targetWeightKg={targetWeightKg}
        onTargetWeightChange={setTargetWeightKg}
      />

      {/* Step 3 — Draft crate lifecycle */}
      <DraftCrateWorkspace
        draftCrates={draftCrates}
        onRemoveBundle={handleRemoveBundleFromCrate}
        onDeleteCrate={handleDeleteDraftCrate}
        onSavePlan={handleSavePlan}
        savedAt={savedAt}
        targetWeightKg={targetWeightKg}
      />

      {/* Operational geometry reviews (feature-flagged) */}
      {canIslandPlan && <IslandOperationalReview projectId={projectId} project={project} embedded />}
      {canKitchenPlan && <KitchenOperationalReview projectId={projectId} project={project} embedded />}

      {/* Feedback from generate / draft crate creation */}
      {lastMessage && (
        <div
          className={`rounded-[24px] border px-5 py-4 text-sm ${
            lastMessage.includes('fail') || lastMessage.includes('Approve')
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {lastMessage}
        </div>
      )}

      {/* Parts in scope summary */}
      <div className="rounded-[24px] border border-[#dbe4f0] bg-white p-5 shadow-sm text-sm text-[#64748b]">
        <strong className="text-[#0f172a]">Project scope:</strong> {pieces.length} parts ·{' '}
        {formatNumber(pieces.reduce((s, p) => s + getPieceWeight(p, project), 0), 0)} kg total
      </div>

      {/* ── OPTIMIZER-ERA UI (hidden while assisted planning is active) ── */}
      {OPTIMIZER_UI_ENABLED && (
        <>
          {crates.length > 0 && <PlannerManualMovePanel projectId={projectId} />}
          {crates.length > 0 && <UnderloadedCrateAssistant projectId={projectId} />}

          {/* Payload cap + print sheet */}
          <div className="mt-6 flex flex-col gap-3 rounded-[24px] border border-[#dbe4f0] bg-white p-5 shadow-sm sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">20ft payload cap (planning)</div>
              <p className="mt-1 max-w-xl text-sm text-[#64748b]">
                Default <strong className="text-[#0f172a]">24 t</strong> (24,000 kg). Use{' '}
                <strong className="text-[#0f172a]">28 t</strong> only when port unload rules allow.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-medium text-[#0f172a]"
                value={payloadCapKg}
                disabled={isRefreshing}
                onChange={(e) => setDeliveryPayloadCapKg(Number(e.target.value))}
              >
                <option value={24000}>24,000 kg (standard)</option>
                <option value={28000}>28,000 kg (port unload)</option>
              </select>
              {crates.length > 0 && (
                <button
                  type="button"
                  className="rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-4 py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-[#dbeafe]"
                  onClick={() =>
                    printV3OperationalPackSheet({
                      project, crates, pieces, layout,
                      containers: project?.planner_v3_containers?.length > 0 ? project.planner_v3_containers : layout ? [layout] : [],
                      groupedByCrateId: grouped,
                      optimization: project?.planner_v3_container_optimization,
                    })
                  }
                >
                  Print pack sheet (PDF)…
                </button>
              )}
            </div>
          </div>

          {/* Legacy plan notice */}
          {legacyPlan && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
              Some crates were built with an <strong>older planner</strong>. Run <strong>Generate Crate Plan</strong> to rebuild with v3.
            </div>
          )}

          {/* Fleet decision + 40ft suggestion */}
          <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Container decision</div>
            <div className="mt-3 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#334155]">
                <div className="text-lg font-semibold text-[#0f172a]">Fleet decision</div>
                {optLabel && <p className="mt-2 text-xs font-semibold text-[#1d4ed8]">Selected strategy: {optLabel}</p>}
                <p className="mt-2 leading-relaxed">
                  {fleetSelectionReason || decision?.rationale || 'Planner seeds with 20′ boxes, then evaluates an all-40′ fleet when average stone per 20′ falls below the economic threshold.'}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[#64748b]">
                  <li>Payload guidance: {formatNumber(layout?.max_weight_kg ?? payloadCapKg)} kg cap</li>
                  <li>Interior: {formatNumber(interior.length)}″ L × {formatNumber(interior.width)}″ W</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-[#eff6ff] p-4 text-sm text-[#1e3a8a]">
                <div className="text-lg font-semibold">40ft suggestion</div>
                <p className="mt-2 leading-relaxed">
                  {layout?.suggest_40ft
                    ? decision?.forty_ft_hint || 'Flagged because the 20ft footprint is under-used or some crates did not fit.'
                    : 'Not flagged for this plan.'}
                </p>
              </div>
            </div>
          </div>

          {/* Summary metrics */}
          {project?.planner_v3_summary && Object.keys(project.planner_v3_summary).length > 0 && (
            <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Summary metrics</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><div className="text-[#64748b]">Crates</div><div className="text-lg font-semibold">{project.planner_v3_summary.total_crates ?? '—'}</div></div>
                <div><div className="text-[#64748b]">Containers (20′ / 40′)</div><div className="text-lg font-semibold">{project.planner_v3_summary.container_count_20ft ?? 0} / {project.planner_v3_summary.container_count_40ft ?? 0}</div></div>
                <div><div className="text-[#64748b]">Avg crate fill %</div><div className="text-lg font-semibold">{project.planner_v3_summary.average_crate_fill_pct ?? '—'}%</div></div>
                <div><div className="text-[#64748b]">Avg cont. weight util.</div><div className="text-lg font-semibold">{project.planner_v3_summary.average_container_weight_utilization_pct ?? '—'}%</div></div>
              </div>
              {(project.planner_v3_summary.warnings || []).length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#b45309]">
                  {project.planner_v3_summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* 2D container plan */}
          {PLANNER_2D_UI_ENABLED &&
            (project?.planner_v3_containers?.length ? project.planner_v3_containers : layout ? [layout] : []).map((cont, idx) => (
              <div key={cont.container_id || idx} className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
                <ContainerTopDown2D layout={cont} title={`2D container plan — ${cont.container_id || idx + 1} (${cont.type || cont.container_type || '20ft'})`} />
              </div>
            ))}
          {!PLANNER_2D_UI_ENABLED && (project?.planner_v3_containers?.length || layout) && (
            <div className="mt-8 rounded-[32px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-4 text-sm text-[#64748b]">
              2D container plan view is temporarily hidden while layout logic is refined.
            </div>
          )}

          {/* 3D container */}
          {crates.length > 0 && (
            <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">3D — crates inside 20ft container</div>
              <div className="mt-4">
                <Container3DPreview
                  placements={placements3d}
                  lengthIn={containerSpec.max_length}
                  widthIn={containerSpec.max_width}
                  clearHeightIn={Number(interior.max_clear_height) || 100}
                  islandZoneDepthIn={layout?.island_zone_depth_in}
                  horizontalZoneStartX={layout?.horizontal_zone_start_x}
                  linearHorizEndX={layout?.linear_horiz_block_end_x_in}
                  linearIslandStartX={layout?.linear_island_strip_start_x_in}
                  maxWeightKg={payloadCapKg}
                  totalWeightKg={layout?.total_weight_kg}
                  selectedCrateId={selectedCrate?.crate_id}
                  onSelectCrate={(code) => { const c = crates.find((x) => x.crate_id === code); if (c) setSelectedCrateId(c.id); }}
                  hudTitle={`${manualContainerDraft?.type || '20ft'} load · ${containerSpec.max_length}" × ${containerSpec.max_width}"`}
                />
              </div>
            </div>
          )}

          {/* Crate table */}
          {crates.length > 0 && (
            <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Crates</div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] text-[#64748b]">
                      <th className="py-2 pr-4">ID</th>
                      <th className="py-2 pr-4">Class</th>
                      <th className="py-2 pr-4">Orientation</th>
                      <th className="py-2 pr-4">Weight (kg)</th>
                      <th className="py-2 pr-4">Splash layers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crates.map((c) => {
                      const pc = grouped[c.id] || [];
                      const cls = inferCrateClass(c) || '—';
                      const ori = inferOrientation(c) || '—';
                      const kg = computedCrateWeightKg(c, pc, project);
                      return (
                        <tr key={c.id} className={`cursor-pointer border-b border-[#f1f5f9] ${c.id === activeCrateId ? 'bg-blue-50/80' : ''}`} onClick={() => setSelectedCrateId(c.id)}>
                          <td className="py-2 pr-4 font-mono text-xs">{c.crate_id}</td>
                          <td className="py-2 pr-4 font-semibold text-[#1d4ed8]">{cls}</td>
                          <td className="py-2 pr-4 capitalize">{ori}</td>
                          <td className="py-2 pr-4">{formatNumber(kg)}</td>
                          <td className="py-2 pr-4 text-xs text-[#64748b]">{splashLayerLabel(c)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectedCrate && (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Crate load diagram</div>
                    {PLANNER_2D_UI_ENABLED ? (
                      <div className="mt-3">
                        <CrateOperationalDiagram2D crate={selectedCrate} piecesInCrate={grouped[selectedCrate.id] || []} crateClass={inferCrateClass(selectedCrate)} project={project} />
                      </div>
                    ) : (
                      <p className="mt-3 rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">2D crate diagram temporarily hidden.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#475569]">
                    <div className="font-semibold text-[#0f172a]">Placement in container</div>
                    {(() => {
                      const pl = placements3d.find((p) => p.crate_id === selectedCrate.crate_id);
                      if (!pl) return <p className="mt-2">No placement row — regenerate plan.</p>;
                      return (
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          <li>Floor corner: ({formatNumber(pl.x)}, {formatNumber(pl.y)})″</li>
                          <li>Footprint: {formatNumber(pl.floor_l)} × {formatNumber(pl.floor_w)}″</li>
                          <li>Stack level: {pl.stack_level ?? 0}</li>
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Solver metrics */}
          {layout && (
            <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Solver metrics</div>
              <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><div className="text-[#64748b]">Shipment weight</div><div className="text-lg font-semibold">{formatNumber(layout.total_weight_kg)} kg</div></div>
                <div><div className="text-[#64748b]">Floor length used</div><div className="text-lg font-semibold">{formatNumber(layout.used_length_in)}″</div></div>
                <div><div className="text-[#64748b]">Island strip depth</div><div className="text-lg font-semibold">{formatNumber(layout.linear_island_strip_end_x_in ?? 0)}″</div></div>
                <div><div className="text-[#64748b]">Horizontal zone starts @</div><div className="text-lg font-semibold">{formatNumber(layout.horizontal_zone_start_x_in ?? layout.horizontal_zone_start_x ?? 0)}″</div></div>
              </div>
              {(layout.warnings || []).length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#b45309]">
                  {layout.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PlannerV3Screen;
