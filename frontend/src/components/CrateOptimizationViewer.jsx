import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from './DraftCrateWorkspace';
import {
  buildHorizontalStackLayers,
  crateFootprintFromPieces,
} from '../utils/cratePhysicalLayout';
import {
  BoardMetricsSpec,
  CutawayHeroBoard,
  EngineeringHeroBoard,
  ExplodedFactoryBoard,
} from './crateViewer/CrateEngineeringVisuals';
import {
  applyEditsToPlan,
  buildCanonicalStackSteps,
  cloneDraftCrates,
  deleteCrateFromPlan,
  flattenPiecesFromCrate,
  isCrateEmpty,
  isIslandCrate,
  listMovablePiecesFromOtherCrates,
  movePieceBetweenCrates,
  pieceKey,
  previewCrateFromEdits,
  removePieceFromCrate,
  reorderPiecesInCrate,
  validateEditPlan,
} from '../utils/crateOptimizationEngine';

const GAP_OPTIONS = [0.5, 1, 1.5, 2];

const VIEW_TABS = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'cutaway', label: 'Cutaway' },
  { id: 'exploded', label: 'Exploded' },
];

function ConstraintValidationPanel({ validation, compact = false }) {
  if (!validation.errors.length && !validation.warnings.length) {
    return (
      <div className={`${compact ? 'text-[10px] px-2 py-1' : 'rounded-xl border border-emerald-600/40 bg-emerald-900/90 px-3 py-2 text-[11px] text-emerald-100'} backdrop-blur-sm`}>
        Constraints OK — safe to apply
      </div>
    );
  }
  const box = compact
    ? 'text-[10px] px-2 py-1.5 backdrop-blur-sm max-h-24 overflow-y-auto'
    : 'rounded-xl p-3';
  return (
    <div className={`space-y-1 ${compact ? '' : 'space-y-2'}`}>
      {validation.errors.length > 0 && (
        <div className={`${box} border-2 border-red-500 bg-red-950/90 text-red-100`}>
          <div className="font-bold uppercase tracking-wide mb-0.5">Blocking — Apply disabled</div>
          <ul className="space-y-0.5">
            {validation.errors.map((e) => <li key={e}>• {e}</li>)}
          </ul>
        </div>
      )}
      {validation.warnings.length > 0 && (
        <div className={`${box} border border-amber-500 bg-amber-950/85 text-amber-100`}>
          <div className="font-bold uppercase tracking-wide mb-0.5">Warnings — Apply allowed</div>
          <ul className="space-y-0.5">
            {validation.warnings.map((w) => <li key={w}>• {w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyCrateModal({ crateId, onDelete, onCancel }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-md w-full rounded-2xl border-2 border-[#f59e0b] bg-white p-6 shadow-2xl" role="dialog" aria-labelledby="empty-crate-title">
        <h3 id="empty-crate-title" className="text-lg font-bold text-[#0f172a]">Crate {crateId} is empty</h3>
        <p className="mt-2 text-sm text-[#475569]">
          All parts were removed from this crate. Empty crates are not kept in the saved plan.
          Delete the crate or cancel to restore the previous contents.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Delete Crate
          </button>
        </div>
      </div>
    </div>
  );
}

function PartsEditor({
  pieces,
  editCrates,
  activeCrateId,
  onRemove,
  onMoveToCrate,
  onAddFromPool,
  onReorderPiece,
  addPool,
}) {
  const otherCrates = editCrates.filter((c) => c.id !== activeCrateId);

  return (
    <div className="space-y-2 max-h-[220px] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Edit contents</div>
      {pieces.length === 0 && (
        <p className="text-xs text-[#94a3b8]">No parts in this crate.</p>
      )}
      {pieces.map((p, i) => {
        const k = pieceKey(p, i);
        return (
          <div
            key={k}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', k)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const fromK = e.dataTransfer.getData('text/plain');
              if (fromK && fromK !== k) onReorderPiece(fromK, k);
            }}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1.5 text-[11px]"
          >
            <span className="cursor-grab text-[#94a3b8]" title="Drag to reorder">⋮⋮</span>
            <span className="flex-1 min-w-[120px] text-[#0f172a] font-medium truncate">
              {p.part_no || '—'} · {p.part}
            </span>
            <span className="text-[#64748b] tabular-nums">{fmt(p.weight_kg)} kg</span>
            <button type="button" onClick={() => onRemove(k)} className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-100">
              −
            </button>
            {otherCrates.length > 0 && (
              <select
                className="rounded border border-[#e2e8f0] text-[10px] py-0.5 max-w-[100px]"
                defaultValue=""
                onChange={(e) => {
                  const toId = e.target.value;
                  if (toId) onMoveToCrate(k, toId);
                  e.target.value = '';
                }}
              >
                <option value="">Move to…</option>
                {otherCrates.map((c) => (
                  <option key={c.id} value={c.id}>{c.id}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {addPool.length > 0 && (
        <div className="pt-2 border-t border-[#f1f5f9]">
          <label className="text-[10px] text-[#64748b] font-semibold">Add part from another crate</label>
          <select
            className="mt-1 w-full rounded-lg border border-[#e2e8f0] text-xs py-1.5"
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                const [fromId, key] = val.split('::');
                onAddFromPool(fromId, key);
                e.target.value = '';
              }
            }}
          >
            <option value="">+ Select part…</option>
            {addPool.map((p, i) => {
              const k = pieceKey(p, i);
              return (
                <option key={k} value={`${p._fromCrateId}::${k}`}>
                  {p._fromCrateId}: {p.part_no || p.part}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}

/**
 * Interactive engineering crate optimization viewer (Phase 1).
 * Preview edits locally; persist only via Apply to Plan.
 */
export default function CrateOptimizationViewer({
  crate,
  allCrates = [],
  targetWeightKg = 1900,
  onClose = null,
  onApplyPlan = null,
  onCrateDeleted = null,
  busy = false,
}) {
  const [mode, setMode] = useState('engineering');
  const [gapIn, setGapIn] = useState(1);
  const [editCrates, setEditCrates] = useState(() => cloneDraftCrates(allCrates.length ? allCrates : [crate]));
  const [layerOrderByCrateId, setLayerOrderByCrateId] = useState({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingEmpty, setPendingEmpty] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const baselineRef = useRef({ crates: cloneDraftCrates(allCrates.length ? allCrates : [crate]), gapIn: 1 });

  const layerOrder = layerOrderByCrateId[crate?.id] ?? null;

  useEffect(() => {
    const baseline = cloneDraftCrates(allCrates.length ? allCrates : [crate]);
    baselineRef.current = { crates: baseline, gapIn: 1 };
    setEditCrates(baseline);
    setLayerOrderByCrateId({});
    setGapIn(1);
    setDirty(false);
    setMessage('');
    setPendingEmpty(null);
  }, [crate?.id]);

  const activeCrate = useMemo(
    () => editCrates.find((c) => c.id === crate?.id) || crate,
    [editCrates, crate],
  );

  const pieces = useMemo(() => flattenPiecesFromCrate(activeCrate), [activeCrate]);
  const island = isIslandCrate(activeCrate);

  const preview = useMemo(
    () => previewCrateFromEdits(activeCrate, pieces, gapIn, targetWeightKg),
    [activeCrate, pieces, gapIn, targetWeightKg],
  );

  const baseLayers = useMemo(
    () => (island ? [] : buildHorizontalStackLayers(pieces, gapIn)),
    [pieces, gapIn, island],
  );
  const layers = layerOrder || baseLayers;

  const stackSteps = useMemo(
    () => (island ? [] : buildCanonicalStackSteps(layers, gapIn)),
    [layers, gapIn, island],
  );

  const validation = useMemo(
    () => validateEditPlan(editCrates, targetWeightKg, {
      layerOrderByCrateId,
      gapInByCrateId: { [crate?.id]: gapIn },
    }),
    [editCrates, targetWeightKg, layerOrderByCrateId, crate?.id, gapIn],
  );

  const footprint = useMemo(
    () => crateFootprintFromPieces(pieces, preview.dimensions),
    [pieces, preview.dimensions],
  );

  const addPool = useMemo(
    () => listMovablePiecesFromOtherCrates(editCrates, crate?.id),
    [editCrates, crate?.id],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const handleRemove = (key) => {
    const prev = editCrates;
    const { crates: next, becameEmpty } = removePieceFromCrate(prev, crate.id, key);
    if (becameEmpty) {
      setPendingEmpty({ crateId: crate.id, rollback: prev });
    }
    setEditCrates(next);
    markDirty();
    setMessage(becameEmpty ? 'Crate is empty — confirm delete or cancel.' : 'Part removed (preview).');
  };

  const handleMoveToCrate = (key, toId) => {
    const prev = editCrates;
    const res = movePieceBetweenCrates(editCrates, crate.id, toId, key);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    if (res.sourceEmpty) {
      setPendingEmpty({ crateId: crate.id, rollback: prev });
    }
    setEditCrates(res.crates);
    markDirty();
    setMessage(res.sourceEmpty ? 'Crate is empty — confirm delete or cancel.' : `Moved to ${toId} (preview).`);
  };

  const handleAddFromPool = (fromId, key) => {
    const res = movePieceBetweenCrates(editCrates, fromId, crate.id, key);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    if (res.sourceEmpty && fromId !== crate.id) {
      setMessage(`Part added — source crate ${fromId} is now empty (delete or restore from that crate).`);
    } else {
      setMessage('Part added (preview).');
    }
    setEditCrates(res.crates);
    markDirty();
  };

  const handleReorderPiece = (fromKey, toKey) => {
    const keys = pieces.map((p, i) => pieceKey(p, i));
    const fi = keys.indexOf(fromKey);
    const ti = keys.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    const next = [...keys];
    const [item] = next.splice(fi, 1);
    next.splice(ti, 0, item);
    setEditCrates((prev) => reorderPiecesInCrate(prev, crate.id, next));
    markDirty();
  };

  const handleMoveLayer = (idx, dir) => {
    const next = [...layers];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setLayerOrderByCrateId((prev) => ({ ...prev, [crate.id]: next }));
    markDirty();
    setMessage('Layer order changed — factory stack order must remain Tops → Back → Side.');
  };

  const handleEmptyDelete = () => {
    const id = pendingEmpty?.crateId || crate.id;
    const next = deleteCrateFromPlan(editCrates, id);
    setEditCrates(next);
    setPendingEmpty(null);
    markDirty();
    setMessage(`Crate ${id} marked for removal — apply to persist.`);
    if (id === crate.id && onCrateDeleted) onCrateDeleted(id);
  };

  const handleEmptyCancel = () => {
    if (pendingEmpty?.rollback) {
      setEditCrates(pendingEmpty.rollback);
    }
    setPendingEmpty(null);
    setMessage('Restored previous crate contents.');
  };

  const handleApply = async () => {
    if (!onApplyPlan || !validation.canApply || pendingEmpty) return;
    const applied = applyEditsToPlan(editCrates);
    const ok = await onApplyPlan(applied);
    if (ok !== false) {
      baselineRef.current = { crates: cloneDraftCrates(applied), gapIn };
      setDirty(false);
      setMessage('Changes applied to saved plan.');
    }
  };

  const handleDiscard = () => {
    const { crates: baseline, gapIn: baselineGap } = baselineRef.current;
    setEditCrates(cloneDraftCrates(baseline));
    setLayerOrderByCrateId({});
    setGapIn(baselineGap);
    setPendingEmpty(null);
    setDirty(false);
    setMessage('Edits discarded — restored snapshot from when viewer opened.');
  };

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm(
        'You have unsaved preview edits. Close without applying? The saved plan will not change.',
      );
      if (!ok) return;
    }
    onClose?.();
  };

  const canApply = dirty && validation.canApply && !pendingEmpty && !busy && onApplyPlan;

  if (!crate) return null;

  return (
    <div className="rounded-lg border-2 border-slate-500 bg-slate-300 shadow-2xl overflow-hidden flex flex-col">
      {/* Slim control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-800 text-slate-100 px-4 py-2 border-b border-slate-600">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.2em] text-slate-400">CRATE OPT</span>
          <span className="font-mono font-bold text-sm">{crate.id}</span>
          {dirty && <span className="text-[10px] text-amber-400 font-semibold">PREVIEW</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!island && (
            <label className="flex items-center gap-1.5 text-[10px] text-slate-300">
              SPACER
              <select
                value={gapIn}
                onChange={(e) => {
                  setGapIn(Number(e.target.value));
                  setLayerOrderByCrateId((prev) => {
                    const next = { ...prev };
                    delete next[crate.id];
                    return next;
                  });
                  markDirty();
                }}
                className="rounded bg-slate-700 border border-slate-500 px-1.5 py-0.5 text-[10px] text-white"
              >
                {GAP_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}″</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setEditorOpen((o) => !o)}
            className="rounded bg-slate-700 border border-slate-500 px-2.5 py-1 text-[10px] font-semibold hover:bg-slate-600"
          >
            {editorOpen ? 'Hide editor' : 'Edit parts'}
          </button>
          {onClose && (
            <button type="button" onClick={handleClose} className="rounded bg-slate-700 border border-slate-500 px-2.5 py-1 text-[10px] font-semibold hover:bg-slate-600">
              Close
            </button>
          )}
        </div>
      </div>

      {/* Hero engineering board */}
      <div className="relative flex-1 min-h-[560px] bg-[#d4d8dc]">
        <div className="absolute top-3 left-3 z-20 flex gap-1">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={`px-3 py-1.5 text-[10px] font-bold tracking-wide uppercase border-2 shadow-sm ${
                mode === t.id
                  ? 'bg-slate-800 text-white border-slate-900'
                  : 'bg-slate-200/90 text-slate-700 border-slate-400 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="absolute top-3 right-3 z-20">
          <BoardMetricsSpec
            preview={preview}
            crateId={crate.id}
            gapIn={gapIn}
            island={island}
            stackSteps={stackSteps}
          />
        </div>

        <div className="absolute bottom-3 left-3 right-3 z-20 max-w-3xl">
          <ConstraintValidationPanel validation={validation} compact />
        </div>

        <div className="w-full h-full pt-1 pb-16">
          {mode === 'engineering' && (
            <EngineeringHeroBoard
              preview={preview}
              layers={layers}
              pieces={pieces}
              crateId={crate.id}
              gapIn={gapIn}
              island={island}
            />
          )}
          {mode === 'cutaway' && (
            <CutawayHeroBoard
              layers={layers}
              pieces={pieces}
              island={island}
              footprint={footprint}
              gapIn={gapIn}
            />
          )}
          {mode === 'exploded' && (
            <ExplodedFactoryBoard
              layers={layers}
              pieces={pieces}
              island={island}
              gapIn={gapIn}
              stackSteps={stackSteps}
              onReorderLayer={island ? null : handleMoveLayer}
            />
          )}
        </div>
      </div>

      {/* Collapsible editor dock */}
      {editorOpen && (
        <div className="border-t-2 border-slate-500 bg-slate-800 px-4 py-3">
          <PartsEditor
            pieces={pieces}
            editCrates={editCrates}
            activeCrateId={crate.id}
            onRemove={handleRemove}
            onMoveToCrate={handleMoveToCrate}
            onAddFromPool={handleAddFromPool}
            onReorderPiece={handleReorderPiece}
            addPool={addPool}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-500 bg-slate-100 px-4 py-2">
        <p className="text-[10px] text-[#64748b] max-w-xl">
          {message || 'Live preview — dimensions and weight recalculate on every edit. Spacer changes are visual overrides until you apply.'}
          {' '}
          Optimizer output is unchanged until <strong>Apply to Plan</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={handleDiscard}
            className="rounded-full border border-[#e2e8f0] px-4 py-1.5 text-xs font-semibold text-[#475569] disabled:opacity-40"
          >
            Discard edits
          </button>
          <button
            type="button"
            disabled={!canApply}
            title={
              !validation.canApply
                ? 'Resolve blocking errors before applying'
                : pendingEmpty
                  ? 'Confirm empty crate action first'
                  : ''
            }
            onClick={handleApply}
            className="rounded-full border border-[#1d4ed8] bg-[#1d4ed8] px-5 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-40"
          >
            Apply to Plan
          </button>
        </div>
      </div>

      {pendingEmpty && (
        <EmptyCrateModal
          crateId={pendingEmpty.crateId}
          onDelete={handleEmptyDelete}
          onCancel={handleEmptyCancel}
        />
      )}
    </div>
  );
}
