import React, { useMemo, useState } from 'react';
import DispatchSelectionPanel from './DispatchSelectionPanel';
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
  normalizePlacementsFor3D,
  splashLayerLabel,
} from '../utils/plannerDisplay';
import { buildPiecesByCrate, CONTAINER_SPECS, formatNumber, getPieceWeight } from '../utils/plannerUtils';
import { printV3OperationalPackSheet } from '../utils/printUtils';

const PlannerV3Screen = ({ projectId, onClose }) => {
  const project = usePlannerStore((s) => s.project);
  const pieces = usePlannerStore((s) => s.pieces);
  const crates = usePlannerStore((s) => s.crates);
  const assignments = usePlannerStore((s) => s.assignments);
  const generateV3Plan = usePlannerStore((s) => s.generateV3Plan);
  const isRefreshing = usePlannerStore((s) => s.isRefreshing);
  const setDeliveryPayloadCapKg = usePlannerStore((s) => s.setDeliveryPayloadCapKg);

  const [lastMessage, setLastMessage] = useState(null);
  const [selectedCrateId, setSelectedCrateId] = useState(null);

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
          ? '20′ only'
          : containerOpt?.chosen_strategy === 'forty_only'
            ? '40′ only'
            : containerOpt?.chosen_strategy === 'frozen'
              ? 'Frozen (locked)'
              : null;

  const { grouped } = useMemo(
    () => buildPiecesByCrate(pieces, crates, assignments),
    [pieces, crates, assignments],
  );

  const manualContainerDraft = useMemo(() => {
    const list = project?.manual_container_plan?.containers || [];
    return list.find((c) => (c.placements || []).length) || list[0];
  }, [project?.manual_container_plan]);

  const placements3d = useMemo(() => {
    if (manualContainerDraft?.placements?.length && crates.length) {
      return buildPlacements3DFromManual(manualContainerDraft, crates, project, layout);
    }
    return normalizePlacementsFor3D(layout, crates);
  }, [manualContainerDraft, crates, project, layout]);

  const containerSpec = CONTAINER_SPECS[manualContainerDraft?.type || '20ft'] || CONTAINER_SPECS['20ft'];
  const interior = layout?.container_interior_in || { length: 233, width: 92, max_clear_height: 100 };
  const payloadCapKg = Number(project.delivery_payload_cap_kg) > 0 ? Number(project.delivery_payload_cap_kg) : 24000;

  const handleGenerate = async (dispatchSelection) => {
    setLastMessage(null);
    try {
      const res = await generateV3Plan(dispatchSelection);
      setLastMessage(res?.message || 'Plan generated.');
    } catch (e) {
      const d = e.response?.data?.detail;
      setLastMessage(typeof d === 'string' ? d : e.message || 'Generation failed.');
    }
  };

  const legacyPlan = crates.length > 0 && crates.some((c) => (c.packing_mode || '') !== 'v3');

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f0f4ff,_#f8fafc)] text-[#0f172a]">
      <div className="mx-auto max-w-[1200px] px-5 py-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Smart Crate Planner v3</div>
            <h1 className="mt-1 text-2xl font-semibold text-[#0f172a]">
              {project.name || project.job_number || `Project #${projectId}`}
            </h1>
            <p className="mt-1 text-sm text-[#64748b]">
              Dispatch → A/B/C/D crates → <strong>multi-container solve</strong> (compares 20′-only, 40′-only, and mixed
              greedy fills, then picks the best logistics score). Manual bundle moves recalc weights and sizes;{' '}
              <strong>locked crates</strong> freeze assignments, dimensions, and container slots until unlocked.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
          >
            ← Back to project
          </button>
        </div>

        <DispatchSelectionPanel projectId={projectId} onGenerate={handleGenerate} isGenerating={isRefreshing} />

        {crates.length > 0 && <PlannerManualMovePanel projectId={projectId} />}

        {crates.length > 0 && <UnderloadedCrateAssistant projectId={projectId} />}

        <div className="mt-6 flex flex-col gap-3 rounded-[24px] border border-[#dbe4f0] bg-white p-5 shadow-sm sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">
              20ft payload cap (planning)
            </div>
            <p className="mt-1 max-w-xl text-sm text-[#64748b]">
              Default <strong className="text-[#0f172a]">24 t</strong> (24,000 kg). Use{' '}
              <strong className="text-[#0f172a]">28 t</strong> only when port unload rules allow. Does not change data
              entry — applies to the next <strong>Generate</strong>.
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
                    project,
                    crates,
                    pieces,
                    layout,
                    containers:
                      project?.planner_v3_containers?.length > 0
                        ? project.planner_v3_containers
                        : layout
                          ? [layout]
                          : [],
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

        {lastMessage && (
          <div
            className={`mt-6 rounded-[24px] border px-5 py-4 text-sm ${
              lastMessage.includes('fail') || lastMessage.includes('Approve')
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {lastMessage}
          </div>
        )}

        {legacyPlan && (
          <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
            Some crates were built with an <strong>older planner</strong>. Class / splash metadata and weights may be
            estimated below. Click <strong>Generate Crate Plan</strong> above to rebuild everything with v3 (recommended).
          </div>
        )}

        {/* 20ft vs 40ft explanation */}
        <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">
            Container decision (how 20ft vs 40ft is chosen)
          </div>
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#334155]">
              <div className="text-lg font-semibold text-[#0f172a]">Fleet decision</div>
              {optLabel && (
                <p className="mt-2 text-xs font-semibold text-[#1d4ed8]">
                  Selected strategy: {optLabel}
                </p>
              )}
              <p className="mt-2 leading-relaxed">
                {decision?.rationale ||
                  'The solver evaluates 20′-only, 40′-only, and mixed greedy packs (20′-first vs 40′-first), scoring unplaced crates, container count, and utilization. Inside each box: single-layer floor — B/C/D from the back wall (low X), islands (A) toward the door (high X); no crate stacking.'}
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[#64748b]">
                <li>
                  Payload guidance: {formatNumber(layout?.max_weight_kg ?? payloadCapKg, 0)} kg cap (regenerate after
                  changing cap above)
                </li>
                <li>Interior: {formatNumber(interior.length, 0)}″ L × {formatNumber(interior.width, 0)}″ W</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-[#eff6ff] p-4 text-sm text-[#1e3a8a]">
              <div className="text-lg font-semibold">40ft suggestion</div>
              <p className="mt-2 leading-relaxed">
                {layout?.suggest_40ft
                  ? decision?.forty_ft_hint ||
                    'Flagged because the 20ft footprint is under-used or some crates did not fit — booking a 40ft may be easier. The app does not yet auto-repack for 40ft length; that is a follow-up solver pass.'
                  : 'Not flagged for this plan. If weight and floor usage stay high on 20ft, we keep the recommendation on 20ft equipment.'}
              </p>
              <p className="mt-3 text-xs text-[#64748b]">
                Open the print dialog for the operational pack sheet to see the candidate strategy table from the last
                recompute or generate.
              </p>
            </div>
          </div>
        </div>

        {project?.planner_v3_summary && Object.keys(project.planner_v3_summary).length > 0 && (
          <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Summary metrics</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <div className="text-[#64748b]">Crates</div>
                <div className="text-lg font-semibold">{project.planner_v3_summary.total_crates ?? '—'}</div>
              </div>
              <div>
                <div className="text-[#64748b]">Containers (20′ / 40′)</div>
                <div className="text-lg font-semibold">
                  {project.planner_v3_summary.container_count_20ft ?? 0} / {project.planner_v3_summary.container_count_40ft ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[#64748b]">Avg crate fill %</div>
                <div className="text-lg font-semibold">{project.planner_v3_summary.average_crate_fill_pct ?? '—'}%</div>
              </div>
              <div>
                <div className="text-[#64748b]">Avg cont. weight util.</div>
                <div className="text-lg font-semibold">
                  {project.planner_v3_summary.average_container_weight_utilization_pct ?? '—'}%
                </div>
              </div>
            </div>
            {(project.planner_v3_summary.warnings || []).length > 0 && (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#b45309]">
                {project.planner_v3_summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(project?.planner_v3_containers?.length
          ? project.planner_v3_containers
          : layout
            ? [layout]
            : []
        ).map((cont, idx) => (
          <div key={cont.container_id || idx} className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <ContainerTopDown2D layout={cont} title={`2D container plan — ${cont.container_id || idx + 1} (${cont.type || cont.container_type || '20ft'})`} />
          </div>
        ))}

        {/* 3D container */}
        {crates.length > 0 && (
          <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">
              3D — crates inside 20ft container
            </div>
            <p className="mt-1 text-sm text-[#64748b]">
              Single-layer floor plan: length → X (back wall = low X, door = high X), width → Z, all crates on the deck
              (no stacking). Colors: A blue, B green, C amber, D violet.
            </p>
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
                onSelectCrate={(code) => {
                  const c = crates.find((x) => x.crate_id === code);
                  if (c) setSelectedCrateId(c.id);
                }}
                hudTitle={`${manualContainerDraft?.type || '20ft'} load · ${containerSpec.max_length}" × ${containerSpec.max_width}"`}
              />
            </div>
          </div>
        )}

        {/* Crate table — always when crates exist */}
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
                    <th className="py-2 pr-4">Diagram</th>
                  </tr>
                </thead>
                <tbody>
                  {crates.map((c) => {
                    const pc = grouped[c.id] || [];
                    const cls = inferCrateClass(c) || '—';
                    const ori = inferOrientation(c) || '—';
                    const kg = computedCrateWeightKg(c, pc, project);
                    return (
                      <tr
                        key={c.id}
                        className={`cursor-pointer border-b border-[#f1f5f9] ${
                          c.id === activeCrateId ? 'bg-blue-50/80' : ''
                        }`}
                        onClick={() => setSelectedCrateId(c.id)}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{c.crate_id}</td>
                        <td className="py-2 pr-4 font-semibold text-[#1d4ed8]">{cls}</td>
                        <td className="py-2 pr-4 capitalize">{ori}</td>
                        <td className="py-2 pr-4">{formatNumber(kg, 0)}</td>
                        <td className="py-2 pr-4 text-xs text-[#64748b]">{splashLayerLabel(c)}</td>
                        <td className="py-2 pr-4 text-xs text-[#1d4ed8]">Row → diagram</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedCrate && (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                    Crate load diagram (like planning sheet)
                  </div>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {selectedCrate.crate_id} · wood O.D. {formatNumber(selectedCrate.external_length, 0)} ×{' '}
                    {formatNumber(selectedCrate.external_width, 0)} × {formatNumber(selectedCrate.external_height, 0)}″ ·
                    est. {formatNumber(computedCrateWeightKg(selectedCrate, grouped[selectedCrate.id] || [], project), 0)}{' '}
                    kg stone
                  </p>
                  <div className="mt-3">
                    <CrateOperationalDiagram2D
                      crate={selectedCrate}
                      piecesInCrate={grouped[selectedCrate.id] || []}
                      crateClass={inferCrateClass(selectedCrate)}
                      project={project}
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#475569]">
                  <div className="font-semibold text-[#0f172a]">Placement in container</div>
                  {(() => {
                    const pl = placements3d.find((p) => p.crate_id === selectedCrate.crate_id);
                    if (!pl) {
                      return (
                        <p className="mt-2">
                          No placement row for this crate yet — regenerate the v3 plan after upgrading, or this crate may
                          be from a legacy run.
                        </p>
                      );
                    }
                    return (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>
                          Floor corner: ({formatNumber(pl.x, 1)}, {formatNumber(pl.y, 1)})″
                        </li>
                        <li>
                          Footprint: {formatNumber(pl.floor_l, 1)} × {formatNumber(pl.floor_w, 1)}″
                        </li>
                        <li>Stack level: {pl.stack_level ?? 0}</li>
                        <li>
                          Vertical: elevation {formatNumber(pl.elevation_in ?? 0, 1)}″ + height{' '}
                          {formatNumber(pl.height_in ?? 0, 1)}″
                        </li>
                      </ul>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {layout && (
          <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Solver metrics</div>
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <div className="text-[#64748b]">Shipment weight</div>
                <div className="text-lg font-semibold">{formatNumber(layout.total_weight_kg, 0)} kg</div>
              </div>
              <div>
                <div className="text-[#64748b]">Floor length used</div>
                <div className="text-lg font-semibold">{formatNumber(layout.used_length_in, 0)}″</div>
              </div>
              <div>
                <div className="text-[#64748b]">
                  {layout.linear_horiz_block_end_x_in != null ? 'B/C/D block ends @' : 'Island zone depth'}
                </div>
                <div className="text-lg font-semibold">
                  {layout.linear_horiz_block_end_x_in != null
                    ? `${formatNumber(layout.linear_horiz_block_end_x_in, 0)}″`
                    : formatNumber(layout.island_zone_depth_in, 0) + '″'}
                </div>
              </div>
              <div>
                <div className="text-[#64748b]">
                  {layout.linear_island_strip_start_x_in != null ? 'Island strip starts @' : 'Horizontal zone starts @'}
                </div>
                <div className="text-lg font-semibold">
                  {layout.linear_island_strip_start_x_in != null
                    ? `${formatNumber(layout.linear_island_strip_start_x_in, 0)}″`
                    : formatNumber(layout.horizontal_zone_start_x, 0) + '″'}
                </div>
              </div>
            </div>
            {(layout.warnings || []).length > 0 && (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#b45309]">
                {layout.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-8 rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm text-sm text-[#64748b]">
          <strong className="text-[#0f172a]">Parts in scope:</strong> {pieces.length} pieces ·{' '}
          {formatNumber(pieces.reduce((s, p) => s + getPieceWeight(p, project), 0), 0)} kg total (estimated from L×W area ×
          material density, or <strong className="text-[#0f172a]">weight override</strong> on each part when you have
          scale weights).
        </div>
      </div>
    </div>
  );
};

export default PlannerV3Screen;
