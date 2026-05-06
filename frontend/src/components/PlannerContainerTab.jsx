import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import {
  buildContainerPreview,
  CONTAINER_SPECS,
  formatNumber,
  getDestinationColorMap,
  placementDimensionsForDraft,
  summarizeDraftContainers,
} from '../utils/plannerUtils';

const EMPTY_CRATES = [];

const PlannerContainerTab = () => {
  const insights = usePlannerStore((state) => state.insights);
  const manualContainers = usePlannerStore((state) => state.manualContainers);
  const manualContainerDirty = usePlannerStore((state) => state.manualContainerDirty);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);
  const selectedContainerId = usePlannerStore((state) => state.selectedContainerId);
  const setSelectedContainerId = usePlannerStore((state) => state.setSelectedContainerId);
  const selectedPlacementCrateId = usePlannerStore((state) => state.selectedPlacementCrateId);
  const setSelectedPlacementCrateId = usePlannerStore((state) => state.setSelectedPlacementCrateId);
  const addManualContainer = usePlannerStore((state) => state.addManualContainer);
  const removeManualContainer = usePlannerStore((state) => state.removeManualContainer);
  const updateManualContainerType = usePlannerStore((state) => state.updateManualContainerType);
  const addCrateToManualContainer = usePlannerStore((state) => state.addCrateToManualContainer);
  const updateManualPlacement = usePlannerStore((state) => state.updateManualPlacement);
  const removeManualPlacement = usePlannerStore((state) => state.removeManualPlacement);
  const resetManualContainerPlan = usePlannerStore((state) => state.resetManualContainerPlan);

  const crates = useMemo(() => insights?.crates || EMPTY_CRATES, [insights]);

  const [addCrateValue, setAddCrateValue] = useState('');
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const destinationColorMap = useMemo(() => getDestinationColorMap(crates), [crates]);
  const crateByCode = useMemo(
    () => crates.reduce((map, crate) => ({ ...map, [crate.crate_id]: crate }), {}),
    [crates]
  );
  const previewContainers = useMemo(
    () => manualContainers.map((container) => buildContainerPreview(container, crateByCode)),
    [manualContainers, crateByCode]
  );
  const currentSummary = useMemo(() => summarizeDraftContainers(previewContainers), [previewContainers]);
  const selectedContainer = previewContainers.find((container) => container.id === selectedContainerId) || previewContainers[0] || null;
  const selectedContainerDraft = manualContainers.find((container) => container.id === selectedContainer?.id) || null;
  const selectedPlacement = selectedContainer?.placements.find((placement) => placement.crate_id === selectedPlacementCrateId)
    || selectedContainer?.placements[0]
    || null;

  const selectedPlacementCrateIdResolved = selectedPlacement?.crate_id ?? null;
  useEffect(() => {
    if (selectedPlacementCrateIdResolved != null && selectedPlacementCrateIdResolved !== selectedPlacementCrateId) {
      setSelectedPlacementCrateId(selectedPlacementCrateIdResolved);
    }
  }, [selectedPlacementCrateIdResolved, selectedPlacementCrateId, setSelectedPlacementCrateId]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !selectedContainer || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const deltaX = ((event.clientX - dragRef.current.startX) / rect.width) * selectedContainer.max_length;
      const deltaY = ((event.clientY - dragRef.current.startY) / rect.height) * selectedContainer.max_width;
      const crate = crateByCode[dragRef.current.crateId];
      const dims = placementDimensionsForDraft(crate, dragRef.current.rotated);
      const nextX = Math.min(
        Math.max(0, dragRef.current.originX + deltaX),
        Math.max(0, selectedContainer.max_length - dims.length)
      );
      const nextY = Math.min(
        Math.max(0, dragRef.current.originY + deltaY),
        Math.max(0, selectedContainer.max_width - dims.width)
      );
      updateManualPlacement(selectedContainer.id, dragRef.current.crateId, {
        x: Number(nextX.toFixed(1)),
        y: Number(nextY.toFixed(1)),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [crateByCode, selectedContainer, updateManualPlacement]);

  const availableCrates = useMemo(() => {
    const selectedIds = new Set((selectedContainerDraft?.placements || []).map((placement) => placement.crate_id));
    return crates.filter((crate) => !selectedIds.has(crate.crate_id));
  }, [crates, selectedContainerDraft]);

  const suggestionLines = useMemo(() => {
    if (!selectedContainer) return [];
    const lines = [];
    if (selectedContainer.balance.left_right_delta_pct > 15) {
      lines.push('Move a heavier crate toward the lighter side to reduce left/right imbalance.');
    }
    if (selectedContainer.balance.front_rear_delta_pct > 18) {
      lines.push('Pull one of the heavy rear crates forward to improve front/rear balance.');
    }
    if (selectedContainer.weight_utilization < 45) {
      lines.push('This container is lightly loaded. Consider consolidating crates or removing the extra box.');
    }
    if (selectedContainer.length_utilization < 45) {
      lines.push('There is unused floor length. Try reordering crates to compact the load.');
    }
    return lines.slice(0, 3);
  }, [selectedContainer]);

  if (!insights || !selectedContainer || !selectedContainerDraft) {
    return (
      <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-20 text-center shadow-sm">
        <div className="text-xl font-semibold text-[#0f172a]">No container plan yet</div>
        <div className="mt-2 text-sm text-[#64748b]">Generate crates to start container onboarding.</div>
      </div>
    );
  }

  const handleAddCrate = () => {
    if (!addCrateValue || !selectedContainerDraft) return;
    const crate = crateByCode[addCrateValue];
    const dims = placementDimensionsForDraft(crate, false);
    const usedLength = selectedContainer.placements.reduce((max, placement) => Math.max(max, placement.x + placement.length), 0);
    addCrateToManualContainer(selectedContainerDraft.id, {
      crate_id: addCrateValue,
      x: Number(Math.min(usedLength, Math.max(0, selectedContainer.max_length - dims.length)).toFixed(1)),
      y: 0,
      rotated: false,
      loading_order: selectedContainerDraft.placements.length + 1,
      unload_order: selectedContainerDraft.placements.length + 1,
    });
    setAddCrateValue('');
  };

  const startPlacementDrag = (event, placement) => {
    event.preventDefault();
    dragRef.current = {
      crateId: placement.crate_id,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y,
      rotated: placement.rotated,
    };
    setSelectedPlacementCrateId(placement.crate_id);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 3</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Container Loading</div>
            <div className="mt-2 text-sm text-[#64748b]">
              Active plan: {currentSummary.label} {manualContainerDirty ? '• syncing changes...' : isRefreshing ? '• refreshing...' : '• synced'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => addManualContainer('20ft')}>
              + 20ft
            </button>
            <button type="button" className="btn-primary" onClick={() => addManualContainer('40ft')}>
              + 40ft
            </button>
            <button type="button" className="btn-danger" onClick={resetManualContainerPlan}>
              Reset Container Plan
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {previewContainers.map((container) => (
            <button
              key={container.id}
              type="button"
              onClick={() => setSelectedContainerId(container.id)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                selectedContainer.id === container.id
                  ? 'border-[#1d4ed8] bg-[#eff6ff] text-[#1d4ed8]'
                  : 'border-[#dbe4f0] bg-[#f8fafc] text-[#334155] hover:bg-white'
              }`}
            >
              {container.id}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr,0.3fr]">
        <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Selected Container</div>
              <div className="mt-1 flex items-center gap-3">
                <div className="text-2xl font-semibold text-[#0f172a]">{selectedContainer.id}</div>
                <select
                  className="input-field !w-28"
                  value={selectedContainer.type}
                  onChange={(e) => updateManualContainerType(selectedContainer.id, e.target.value)}
                >
                  <option value="20ft">20ft</option>
                  <option value="40ft">40ft</option>
                </select>
                <button
                  type="button"
                  className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-3 py-1 text-xs font-semibold text-[#be123c]"
                  onClick={() => removeManualContainer(selectedContainer.id)}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155]">
                Weight {formatNumber(selectedContainer.used_weight, 0)} / {formatNumber(selectedContainer.max_weight, 0)} kg
              </div>
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155]">
                Floor {formatNumber(selectedContainer.used_length, 1)} / {formatNumber(selectedContainer.max_length, 1)} in
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr),auto]">
            <select
              className="input-field"
              value={addCrateValue}
              onChange={(e) => setAddCrateValue(e.target.value)}
            >
              <option value="">Add or move crate into this container...</option>
              {availableCrates.map((crate) => (
                <option key={crate.id} value={crate.crate_id}>
                  {crate.crate_id} · {crate.destination_group} · {formatNumber(crate.gross_weight, 0)} kg
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`btn-primary ${!addCrateValue ? 'cursor-not-allowed opacity-50' : ''}`}
              disabled={!addCrateValue}
              onClick={handleAddCrate}
            >
              Add Crate
            </button>
          </div>

          <div
            ref={canvasRef}
            className="relative mt-5 overflow-hidden rounded-[28px] border border-[#cbd5e1] bg-[linear-gradient(180deg,_#f8fafc,_#eef2f7)]"
            style={{ aspectRatio: `${selectedContainer.max_length} / ${selectedContainer.max_width}` }}
          >
            <div className="absolute inset-0 border-[10px] border-[#0f172a]/10" />
            <div className="absolute right-0 top-0 h-full w-[12%] bg-amber-100/70" />
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-[#94a3b8]" />

            {selectedContainer.placements.map((placement) => {
              const left = `${(placement.x / selectedContainer.max_length) * 100}%`;
              const top = `${(placement.y / selectedContainer.max_width) * 100}%`;
              const width = `${(placement.length / selectedContainer.max_length) * 100}%`;
              const height = `${(placement.width / selectedContainer.max_width) * 100}%`;
              const color = destinationColorMap[placement.destination_group] || '#1d4ed8';
              const selected = selectedPlacement?.crate_id === placement.crate_id;
              return (
                <button
                  key={`${selectedContainer.id}-${placement.crate_id}`}
                  type="button"
                  onMouseDown={(event) => startPlacementDrag(event, placement)}
                  onClick={() => setSelectedPlacementCrateId(placement.crate_id)}
                  className={`absolute overflow-hidden rounded-xl border text-left shadow-md transition-all ${
                    selected ? 'border-[#0f172a] ring-2 ring-[#0f172a]/20' : 'border-white/70'
                  }`}
                  style={{ left, top, width, height, backgroundColor: color }}
                >
                  <div className="flex h-full flex-col justify-between px-2 py-1 text-white">
                    <div className="text-[11px] font-semibold">{placement.crate_id}</div>
                    <div className="text-[10px]">{Math.round(placement.weight)}kg</div>
                  </div>
                </button>
              );
            })}

            {selectedContainer.warnings.length > 0 && (
              <div className="absolute left-4 top-4 rounded-2xl border border-amber-300 bg-white/90 px-4 py-3 text-xs text-amber-950 shadow-sm">
                {selectedContainer.warnings.join(' · ')}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Optimization Suggestions</div>
            <div className="mt-3 space-y-2 text-sm text-[#334155]">
              {suggestionLines.length === 0 && <div>No optimization suggestions on this container right now.</div>}
              {suggestionLines.map((line) => (
                <div key={line} className="rounded-2xl border border-[#e2e8f0] bg-white px-3 py-3">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Selected Crate</div>
            {selectedPlacement ? (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-2xl font-semibold text-[#0f172a]">{selectedPlacement.crate_id}</div>
                  <div className="mt-1 text-sm text-[#64748b]">{selectedPlacement.destination_group}</div>
                </div>
                <div className="grid gap-3">
                  <div>
                    <label className="label-text">X</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input-field"
                      value={selectedPlacement.x}
                      onChange={(e) => updateManualPlacement(selectedContainer.id, selectedPlacement.crate_id, { x: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="label-text">Y</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input-field"
                      value={selectedPlacement.y}
                      onChange={(e) => updateManualPlacement(selectedContainer.id, selectedPlacement.crate_id, { y: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="label-text">Rotate</label>
                    <label className="mt-2 inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155]">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedPlacement.rotated)}
                        onChange={(e) => updateManualPlacement(selectedContainer.id, selectedPlacement.crate_id, { rotated: e.target.checked })}
                      />
                      Rotated
                    </label>
                  </div>
                  <div>
                    <label className="label-text">Load Order</label>
                    <input
                      type="number"
                      min="1"
                      className="input-field"
                      value={selectedPlacement.loading_order}
                      onChange={(e) => updateManualPlacement(selectedContainer.id, selectedPlacement.crate_id, { loading_order: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div>
                    <label className="label-text">Unload Order</label>
                    <input
                      type="number"
                      min="1"
                      className="input-field"
                      value={selectedPlacement.unload_order}
                      onChange={(e) => updateManualPlacement(selectedContainer.id, selectedPlacement.crate_id, { unload_order: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-4 py-2 text-sm font-semibold text-[#be123c]"
                  onClick={() => removeManualPlacement(selectedContainer.id, selectedPlacement.crate_id)}
                >
                  Remove From Container
                </button>
              </div>
            ) : (
              <div className="mt-4 text-sm text-[#64748b]">Select a crate on the canvas to edit its position.</div>
            )}
          </div>

          <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Container KPIs</div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#64748b]">Weight Utilization</div>
                <div className="mt-2 text-xl font-semibold text-[#0f172a]">{formatNumber(selectedContainer.weight_utilization, 1)}%</div>
              </div>
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#64748b]">Floor Utilization</div>
                <div className="mt-2 text-xl font-semibold text-[#0f172a]">{formatNumber(selectedContainer.length_utilization, 1)}%</div>
              </div>
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#64748b]">Left / Right Balance</div>
                <div className="mt-2 text-xl font-semibold text-[#0f172a]">{formatNumber(selectedContainer.balance.left_right_delta_pct, 1)}%</div>
              </div>
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#64748b]">Front / Rear Balance</div>
                <div className="mt-2 text-xl font-semibold text-[#0f172a]">{formatNumber(selectedContainer.balance.front_rear_delta_pct, 1)}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlannerContainerTab;
