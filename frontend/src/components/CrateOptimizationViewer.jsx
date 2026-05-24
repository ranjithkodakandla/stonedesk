import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from './DraftCrateWorkspace';
import { buildHorizontalStackLayers, crateFootprintFromPieces } from '../utils/cratePhysicalLayout';
import CrateEngineeringCompositor from './crateViewer/CrateEngineeringCompositor';
import {
  applyEditsToPlan,
  buildCanonicalStackSteps,
  cloneDraftCrates,
  deleteCrateFromPlan,
  flattenPiecesFromCrate,
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
const FIGURES = [
  { id: 'A', mode: 'engineering', label: 'FIG A · MAIN' },
  { id: 'B', mode: 'cutaway', label: 'FIG B · SECTION' },
  { id: 'C', mode: 'exploded', label: 'FIG C · EXPLODED' },
];

function EmptyCrateModal({ crateId, onDelete, onCancel }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-md w-full rounded border-2 border-amber-600 bg-white p-6 shadow-2xl" role="dialog">
        <h3 className="text-lg font-bold text-[#0f172a]">Crate {crateId} is empty</h3>
        <p className="mt-2 text-sm text-[#475569]">
          Empty crates are not kept in the saved plan. Delete the crate or cancel to restore contents.
        </p>
        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-semibold border border-slate-300">Cancel</button>
          <button type="button" onClick={onDelete} className="px-4 py-2 text-sm font-semibold bg-red-600 text-white">Delete Crate</button>
        </div>
      </div>
    </div>
  );
}

function PartsEditor({ pieces, editCrates, activeCrateId, onRemove, onMoveToCrate, onAddFromPool, onReorderPiece, addPool }) {
  const otherCrates = editCrates.filter((c) => c.id !== activeCrateId);
  return (
    <div className="space-y-1.5 max-h-[200px] overflow-y-auto text-[11px] font-mono">
      {pieces.map((p, i) => {
        const k = pieceKey(p, i);
        return (
          <div key={k} className="flex flex-wrap items-center gap-2 py-1 border-b border-slate-600/40 text-slate-200">
            <span className="cursor-grab opacity-50">⋮⋮</span>
            <span className="flex-1 truncate">{p.part_no} · {p.part}</span>
            <span>{fmt(p.weight_kg)} kg</span>
            <button type="button" onClick={() => onRemove(k)} className="text-red-400 font-bold px-1">−</button>
            {otherCrates.length > 0 && (
              <select className="bg-slate-700 text-slate-100 text-[10px] border border-slate-500 rounded" defaultValue="" onChange={(e) => { if (e.target.value) { onMoveToCrate(k, e.target.value); e.target.value = ''; } }}>
                <option value="">move…</option>
                {otherCrates.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            )}
          </div>
        );
      })}
      {addPool.length > 0 && (
        <select className="w-full mt-2 bg-slate-700 text-slate-100 text-[10px] border border-slate-500 rounded py-1" defaultValue="" onChange={(e) => {
          const v = e.target.value;
          if (v) { const [fromId, key] = v.split('::'); onAddFromPool(fromId, key); e.target.value = ''; }
        }}>
          <option value="">+ add from crate…</option>
          {addPool.map((p, i) => (
            <option key={pieceKey(p, i)} value={`${p._fromCrateId}::${pieceKey(p, i)}`}>{p._fromCrateId}: {p.part_no}</option>
          ))}
        </select>
      )}
    </div>
  );
}

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
  const [figure, setFigure] = useState('A');
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
    setFigure('A');
    setMode('engineering');
  }, [crate?.id]);

  const activeCrate = useMemo(() => editCrates.find((c) => c.id === crate?.id) || crate, [editCrates, crate]);
  const pieces = useMemo(() => flattenPiecesFromCrate(activeCrate), [activeCrate]);
  const island = isIslandCrate(activeCrate);
  const preview = useMemo(() => previewCrateFromEdits(activeCrate, pieces, gapIn, targetWeightKg), [activeCrate, pieces, gapIn, targetWeightKg]);
  const baseLayers = useMemo(() => (island ? [] : buildHorizontalStackLayers(pieces, gapIn)), [pieces, gapIn, island]);
  const layers = layerOrder || baseLayers;
  const stackSteps = useMemo(() => (island ? [] : buildCanonicalStackSteps(layers, gapIn)), [layers, gapIn, island]);
  const validation = useMemo(
    () => validateEditPlan(editCrates, targetWeightKg, { layerOrderByCrateId, gapInByCrateId: { [crate?.id]: gapIn } }),
    [editCrates, targetWeightKg, layerOrderByCrateId, crate?.id, gapIn],
  );
  const footprint = useMemo(() => crateFootprintFromPieces(pieces, preview.dimensions), [pieces, preview.dimensions]);
  const addPool = useMemo(() => listMovablePiecesFromOtherCrates(editCrates, crate?.id), [editCrates, crate?.id]);

  const markDirty = useCallback(() => setDirty(true), []);

  const selectFigure = (fig, figMode) => {
    setFigure(fig);
    setMode(figMode);
  };

  const handleRemove = (key) => {
    const prev = editCrates;
    const { crates: next, becameEmpty } = removePieceFromCrate(prev, crate.id, key);
    if (becameEmpty) setPendingEmpty({ crateId: crate.id, rollback: prev });
    setEditCrates(next);
    markDirty();
  };

  const handleMoveToCrate = (key, toId) => {
    const prev = editCrates;
    const res = movePieceBetweenCrates(editCrates, crate.id, toId, key);
    if (res.error) { setMessage(res.error); return; }
    if (res.sourceEmpty) setPendingEmpty({ crateId: crate.id, rollback: prev });
    setEditCrates(res.crates);
    markDirty();
  };

  const handleAddFromPool = (fromId, key) => {
    const res = movePieceBetweenCrates(editCrates, fromId, crate.id, key);
    if (res.error) { setMessage(res.error); return; }
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
  };

  const handleEmptyDelete = () => {
    const id = pendingEmpty?.crateId || crate.id;
    setEditCrates(deleteCrateFromPlan(editCrates, id));
    setPendingEmpty(null);
    markDirty();
    if (id === crate.id && onCrateDeleted) onCrateDeleted(id);
  };

  const handleEmptyCancel = () => {
    if (pendingEmpty?.rollback) setEditCrates(pendingEmpty.rollback);
    setPendingEmpty(null);
  };

  const handleApply = async () => {
    if (!onApplyPlan || !validation.canApply || pendingEmpty) return;
    const ok = await onApplyPlan(applyEditsToPlan(editCrates));
    if (ok !== false) {
      baselineRef.current = { crates: cloneDraftCrates(editCrates), gapIn };
      setDirty(false);
      setMessage('Applied to saved plan.');
    }
  };

  const handleDiscard = () => {
    const { crates: baseline, gapIn: bg } = baselineRef.current;
    setEditCrates(cloneDraftCrates(baseline));
    setLayerOrderByCrateId({});
    setGapIn(bg);
    setPendingEmpty(null);
    setDirty(false);
  };

  const handleClose = () => {
    if (dirty && !window.confirm('Close without applying? Saved plan unchanged.')) return;
    onClose?.();
  };

  const canApply = dirty && validation.canApply && !pendingEmpty && !busy && onApplyPlan;
  if (!crate) return null;

  return (
    <div className="flex flex-col bg-[#a8adb2]">
      <CrateEngineeringCompositor
        figure={figure}
        preview={preview}
        layers={layers}
        pieces={pieces}
        crateId={crate.id}
        gapIn={gapIn}
        island={island}
        footprint={footprint}
        stackSteps={stackSteps}
        validation={validation}
        onReorderLayer={island ? null : handleMoveLayer}
      />

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#2d3748] border-t-2 border-[#1a202c] text-[10px] font-mono text-slate-200">
        {FIGURES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => selectFigure(f.id, f.mode)}
            className={`px-2 py-1 font-bold border ${figure === f.id ? 'bg-slate-100 text-slate-900 border-slate-900' : 'bg-transparent border-slate-500 text-slate-300'}`}
          >
            {f.label}
          </button>
        ))}
        <span className="w-px h-5 bg-slate-500 mx-1" />
        {!island && (
          <label className="flex items-center gap-1">
            SPACER
            <select value={gapIn} onChange={(e) => { setGapIn(Number(e.target.value)); setLayerOrderByCrateId((p) => { const n = { ...p }; delete n[crate.id]; return n; }); markDirty(); }} className="bg-slate-700 border border-slate-500 text-slate-100 rounded px-1">
              {GAP_OPTIONS.map((g) => <option key={g} value={g}>{g}″</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => setEditorOpen((o) => !o)} className="px-2 py-1 border border-slate-500">{editorOpen ? 'Hide editor' : 'Edit parts'}</button>
        {dirty && <span className="text-amber-400 font-bold">PREVIEW</span>}
        <span className="flex-1" />
        <button type="button" disabled={!dirty} onClick={handleDiscard} className="px-2 py-1 border border-slate-500 disabled:opacity-40">Discard</button>
        <button type="button" disabled={!canApply} onClick={handleApply} className="px-3 py-1 bg-blue-700 text-white font-bold border border-blue-900 disabled:opacity-40">Apply to Plan</button>
        {onClose && <button type="button" onClick={handleClose} className="px-2 py-1 border border-slate-500">Close</button>}
      </div>

      {editorOpen && (
        <div className="px-3 py-2 bg-[#1e293b] border-t border-slate-600">
          <PartsEditor pieces={pieces} editCrates={editCrates} activeCrateId={crate.id} onRemove={handleRemove} onMoveToCrate={handleMoveToCrate} onAddFromPool={handleAddFromPool} onReorderPiece={handleReorderPiece} addPool={addPool} />
          {message && <p className="mt-1 text-[10px] text-slate-400">{message}</p>}
        </div>
      )}

      {pendingEmpty && <EmptyCrateModal crateId={pendingEmpty.crateId} onDelete={handleEmptyDelete} onCancel={handleEmptyCancel} />}
    </div>
  );
}
