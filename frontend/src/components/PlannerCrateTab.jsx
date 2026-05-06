import React, { useEffect, useMemo, useState } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import {
  buildPiecesByCrate,
  formatNumber,
  getPieceWeight,
  groupCratesForWorkflow,
} from '../utils/plannerUtils';

const statusStyles = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-rose-100 text-rose-700 border-rose-200',
};

const PlannerCrateTab = () => {
  const {
    project,
    pieces,
    crates,
    assignments,
    insights,
    selectedCrateId,
    setSelectedCrateId,
    updateCrate,
    mergeCrates,
    assignPiece,
    unassignPiece,
    createCustomCrate,
  } = usePlannerStore((state) => ({
    project: state.project,
    pieces: state.pieces,
    crates: state.crates,
    assignments: state.assignments,
    insights: state.insights,
    selectedCrateId: state.selectedCrateId,
    setSelectedCrateId: state.setSelectedCrateId,
    updateCrate: state.updateCrate,
    mergeCrates: state.mergeCrates,
    assignPiece: state.assignPiece,
    unassignPiece: state.unassignPiece,
    createCustomCrate: state.createCustomCrate,
  }));

  const [detailDraft, setDetailDraft] = useState(null);
  const [selectedPieceIds, setSelectedPieceIds] = useState([]);
  const [dragPieceId, setDragPieceId] = useState(null);

  const crateRows = insights?.crates || [];
  const groupedCrates = useMemo(() => groupCratesForWorkflow(crateRows), [crateRows]);
  const piecesByCrate = useMemo(() => buildPiecesByCrate(pieces, crates, assignments), [pieces, crates, assignments]);
  const pieceWeights = useMemo(
    () => pieces.reduce((map, piece) => ({ ...map, [piece.id]: getPieceWeight(piece, project) }), {}),
    [pieces, project]
  );
  const selectedCrate = crateRows.find((crate) => crate.id === selectedCrateId) || crateRows[0] || null;
  const selectedCratePieces = selectedCrate ? (piecesByCrate.grouped[selectedCrate.id] || []) : [];
  const underfilledMap = useMemo(
    () => Object.fromEntries((insights?.underfilled_crates || []).map((crate) => [crate.crate_id, crate])),
    [insights]
  );

  useEffect(() => {
    if (!selectedCrate) {
      setDetailDraft(null);
      return;
    }
    setDetailDraft({
      name: selectedCrate.name || '',
      max_weight: selectedCrate.max_weight || 1000,
      reserved_space_pct: selectedCrate.reserved_space_pct || 0,
      planner_notes: selectedCrate.planner_notes || '',
      dimension_mode: selectedCrate.dimension_mode || 'auto',
      internal_length: selectedCrate.internal_length || '',
      internal_width: selectedCrate.internal_width || '',
      internal_height: selectedCrate.internal_height || '',
      external_length: selectedCrate.external_length || '',
      external_width: selectedCrate.external_width || '',
      external_height: selectedCrate.external_height || '',
      locked: Boolean(selectedCrate.locked),
      custom: Boolean(selectedCrate.custom),
    });
    setSelectedPieceIds([]);
  }, [selectedCrate]);

  const buildPayload = (overrides = {}) => {
    if (!selectedCrate || !detailDraft) return null;
    const next = { ...detailDraft, ...overrides };
    const payload = {
      name: next.name,
      max_weight: Number(next.max_weight) || 1000,
      reserved_space_pct: Number(next.reserved_space_pct) || 0,
      planner_notes: next.planner_notes || '',
      locked: Boolean(next.locked),
      custom: Boolean(next.custom),
      dimension_mode: next.dimension_mode || 'auto',
    };
    if (payload.dimension_mode === 'manual') {
      payload.internal_length = Number(next.internal_length) || 0;
      payload.internal_width = Number(next.internal_width) || 0;
      payload.internal_height = Number(next.internal_height) || 0;
      payload.external_length = Number(next.external_length) || 0;
      payload.external_width = Number(next.external_width) || 0;
      payload.external_height = Number(next.external_height) || 0;
    }
    return payload;
  };

  const commitDraft = async (overrides = {}) => {
    if (!selectedCrate) return;
    const payload = buildPayload(overrides);
    if (!payload) return;
    await updateCrate(selectedCrate.id, payload);
  };

  const handleSuggestedMerge = async () => {
    if (!selectedCrate) return;
    const candidateCode = underfilledMap[selectedCrate.crate_id]?.merge_candidates?.[0];
    const candidate = crateRows.find((crate) => crate.crate_id === candidateCode);
    if (!candidate) return;
    await mergeCrates([selectedCrate.id, candidate.id], selectedCrate.id);
  };

  const handleCreateSplitCrate = async () => {
    if (selectedPieceIds.length === 0) return;
    await createCustomCrate({
      name: `Split ${selectedCrate?.crate_id || 'Crate'}`,
      max_weight: selectedCrate?.max_weight || 1000,
      reserved_space_pct: 0,
      planner_notes: 'Created from selected parts during crate review.',
      locked: false,
      custom: true,
      piece_ids: selectedPieceIds,
    });
    setSelectedPieceIds([]);
  };

  const toggleSelectedPiece = (pieceId) => {
    setSelectedPieceIds((prev) => (
      prev.includes(pieceId) ? prev.filter((id) => id !== pieceId) : [...prev, pieceId]
    ));
  };

  if (!insights || !selectedCrate || !detailDraft) {
    return (
      <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-20 text-center shadow-sm">
        <div className="text-xl font-semibold text-[#0f172a]">No crate plan yet</div>
        <div className="mt-2 text-sm text-[#64748b]">Generate crates to start the review workflow.</div>
      </div>
    );
  }

  const recommendationBundle = underfilledMap[selectedCrate.crate_id];
  const quickWarnings = (selectedCrate.warnings || []).slice(0, 4);

  return (
    <div className="grid gap-6 xl:grid-cols-[0.32fr,0.48fr,0.2fr]">
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2A</div>
        <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Crate List</div>
        <div className="mt-2 text-sm text-[#64748b]">Select a crate to review. Drop a part onto any row to move it there.</div>

        <div className="mt-5 space-y-5">
          {Object.entries(groupedCrates).map(([groupName, rows]) => (
            <div key={groupName}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">{groupName}</div>
                <div className="rounded-full bg-[#f8fafc] px-2.5 py-1 text-xs text-[#475569]">{rows.length}</div>
              </div>
              <div className="space-y-2">
                {rows.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#e2e8f0] px-3 py-4 text-xs text-[#94a3b8]">
                    No crates in this group
                  </div>
                )}
                {rows.map((crate) => (
                  <button
                    key={crate.id}
                    type="button"
                    onClick={() => setSelectedCrateId(crate.id)}
                    onDragOver={(event) => {
                      if (!crate.locked && dragPieceId) event.preventDefault();
                    }}
                    onDrop={async () => {
                      if (!dragPieceId || crate.locked) return;
                      await assignPiece(dragPieceId, crate.id);
                      setDragPieceId(null);
                    }}
                    className={`w-full rounded-[22px] border px-4 py-3 text-left transition-all ${
                      selectedCrate.id === crate.id
                        ? 'border-[#1d4ed8] bg-[#eff6ff] shadow-[0_0_0_3px_rgba(29,78,216,0.08)]'
                        : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#0f172a]">{crate.crate_id}</div>
                        <div className="mt-1 text-xs text-[#64748b]">{crate.destination_group}</div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[crate.efficiency_status] || statusStyles.yellow}`}>
                        {crate.efficiency_status}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#475569]">
                      <div>{formatNumber(crate.gross_weight, 0)} kg</div>
                      <div>{formatNumber(crate.fill_percent, 0)}% fill</div>
                      <div>{crate.locked ? 'Locked' : 'Open'}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2B</div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <div className="text-2xl font-semibold text-[#0f172a]">{selectedCrate.crate_id}</div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[selectedCrate.efficiency_status] || statusStyles.yellow}`}>
            {selectedCrate.efficiency_status}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label-text">Crate Name</label>
            <input
              className="input-field"
              value={detailDraft.name}
              onChange={(e) => setDetailDraft((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={() => commitDraft()}
            />
          </div>
          <div>
            <label className="label-text">Gross Limit (kg)</label>
            <input
              type="number"
              className="input-field"
              value={detailDraft.max_weight}
              onChange={(e) => setDetailDraft((prev) => ({ ...prev, max_weight: e.target.value }))}
              onBlur={() => commitDraft()}
            />
          </div>
          <div>
            <label className="label-text">Reserved Space %</label>
            <input
              type="number"
              className="input-field"
              value={detailDraft.reserved_space_pct}
              onChange={(e) => setDetailDraft((prev) => ({ ...prev, reserved_space_pct: e.target.value }))}
              onBlur={() => commitDraft()}
            />
          </div>
          <div>
            <label className="label-text">Dimension Mode</label>
            <select
              className="input-field"
              value={detailDraft.dimension_mode}
              onChange={(e) => {
                const value = e.target.value;
                setDetailDraft((prev) => ({ ...prev, dimension_mode: value }));
                commitDraft({ dimension_mode: value });
              }}
            >
              <option value="auto">Auto Dimensions</option>
              <option value="manual">Manual Dimensions</option>
            </select>
          </div>
        </div>

        {detailDraft.dimension_mode === 'manual' && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ['internal_length', 'Int L'],
              ['internal_width', 'Int W'],
              ['internal_height', 'Int H'],
              ['external_length', 'Ext L'],
              ['external_width', 'Ext W'],
              ['external_height', 'Ext H'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="label-text">{label}</label>
                <input
                  type="number"
                  className="input-field"
                  value={detailDraft[field]}
                  onChange={(e) => setDetailDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                  onBlur={() => commitDraft()}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Dimensions</div>
            <div className="mt-2 text-sm text-[#334155]">
              {formatNumber(selectedCrate.external_length)} × {formatNumber(selectedCrate.external_width)} × {formatNumber(selectedCrate.external_height)} in
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Weights</div>
            <div className="mt-2 text-sm text-[#334155]">
              Tare {formatNumber(selectedCrate.tare_weight, 1)} kg
              <br />
              Gross {formatNumber(selectedCrate.gross_weight, 1)} kg
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Handling</div>
            <div className="mt-2 text-sm text-[#334155]">
              {selectedCrate.stackable ? 'Stackable' : 'Single layer'}
              <br />
              Forklift {selectedCrate.forklift_entry}
            </div>
          </div>
        </div>

        {quickWarnings.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {quickWarnings.map((warning) => (
              <span key={warning} className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-3 py-1 text-xs font-medium text-[#be123c]">
                {warning}
              </span>
            ))}
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Contents</div>
              <div className="mt-1 text-lg font-semibold text-[#0f172a]">Drag a part to another crate row to move it</div>
            </div>
            <button
              type="button"
              className="rounded-full border border-[#e2e8f0] px-3 py-1.5 text-xs font-medium text-[#475569]"
              onClick={() => setSelectedPieceIds([])}
            >
              Clear Part Selection
            </button>
          </div>

          <div
            className="mt-4 space-y-3 rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] p-4"
            onDragOver={(event) => event.preventDefault()}
            onDrop={async () => {
              if (!dragPieceId) return;
              await assignPiece(dragPieceId, selectedCrate.id);
              setDragPieceId(null);
            }}
          >
            {selectedCratePieces.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-4 py-6 text-sm text-[#64748b]">
                This crate is empty.
              </div>
            )}
            {selectedCratePieces.map((piece) => (
              <div
                key={piece.id}
                draggable={!selectedCrate.locked}
                onDragStart={() => setDragPieceId(piece.id)}
                onDragEnd={() => setDragPieceId(null)}
                className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={selectedPieceIds.includes(piece.id)}
                      onChange={() => toggleSelectedPiece(piece.id)}
                    />
                    <div>
                      <div className="font-medium text-[#0f172a]">{piece.part}</div>
                      <div className="text-xs text-[#64748b]">
                        {piece.drawing || 'No drawing'} · {piece.building || 'B?'} / {piece.floor || 'F?'} / {piece.flat || 'Unit?'}
                      </div>
                    </div>
                  </label>
                  <button
                    type="button"
                    className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#475569]"
                    onClick={() => unassignPiece(piece.id)}
                  >
                    Unassign
                  </button>
                </div>
                <div className="mt-2 text-xs text-[#475569]">
                  {formatNumber(piece.length)} × {formatNumber(piece.width)} in · {formatNumber(pieceWeights[piece.id], 1)} kg
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-dashed border-[#cbd5e1] bg-white px-4 py-4">
          <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Unassigned Parts</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {piecesByCrate.unassigned.length === 0 && (
              <div className="text-sm text-[#94a3b8]">No unassigned parts</div>
            )}
            {piecesByCrate.unassigned.map((piece) => (
              <button
                key={piece.id}
                type="button"
                draggable
                onDragStart={() => setDragPieceId(piece.id)}
                onDragEnd={() => setDragPieceId(null)}
                className="rounded-full border border-[#dbe4f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#334155]"
              >
                {piece.part} · {formatNumber(pieceWeights[piece.id], 1)} kg
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2C</div>
        <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Recommendations Engine</div>

        <div className="mt-5 space-y-4">
          <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Suggested Merge</div>
            <div className="mt-2 text-sm text-[#334155]">
              {recommendationBundle?.merge_candidates?.length
                ? `${selectedCrate.crate_id} + ${recommendationBundle.merge_candidates[0]}`
                : 'No merge suggestion for this crate right now.'}
            </div>
            <button
              type="button"
              onClick={handleSuggestedMerge}
              disabled={!recommendationBundle?.merge_candidates?.length}
              className={`mt-4 btn-primary w-full ${!recommendationBundle?.merge_candidates?.length ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              Merge
            </button>
          </div>

          <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Suggested Resize</div>
            <div className="mt-2 text-sm text-[#334155]">
              {selectedCrate.oversized
                ? 'Current crate is larger than needed for the piece mix.'
                : selectedCrate.fill_percent < 72
                  ? 'This crate may be too large for its current load.'
                  : 'Current size is acceptable.'}
            </div>
            <button
              type="button"
              onClick={() => updateCrate(selectedCrate.id, { ...buildPayload(), reset_dimensions: true })}
              className="mt-4 btn-primary w-full"
            >
              Resize
            </button>
          </div>

          <div className="rounded-[24px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Suggested Rebalance</div>
            <div className="mt-2 text-sm text-[#334155]">
              {(selectedCrate.warnings || []).find((warning) => /heavy parts grouped|light parts grouped/i.test(warning))
                || 'No balance rebalance suggestion on this crate.'}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={() => commitDraft({ locked: !selectedCrate.locked })}
            className="btn-primary w-full"
          >
            {selectedCrate.locked ? 'Unlock Crate' : 'Lock Crate'}
          </button>
          <button
            type="button"
            onClick={() => commitDraft({ reserved_space_pct: 10 })}
            className="btn-primary w-full"
          >
            Reserve 10% Space
          </button>
          <button
            type="button"
            onClick={handleCreateSplitCrate}
            disabled={selectedPieceIds.length === 0}
            className={`btn-primary w-full ${selectedPieceIds.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Split Selected Parts
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlannerCrateTab;
