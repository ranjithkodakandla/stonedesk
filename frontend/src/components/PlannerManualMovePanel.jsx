import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE, bundleRowKey, formatNumber } from '../utils/plannerUtils';
import { usePlannerStore } from '../store/plannerStore';

/**
 * Default: move whole PartBundle (packing family). Advanced: pick individual pieces.
 */
const PlannerManualMovePanel = ({ projectId }) => {
  const crates = usePlannerStore((s) => s.crates);
  const isRefreshing = usePlannerStore((s) => s.isRefreshing);
  const assignFamily = usePlannerStore((s) => s.assignFamily);
  const recalculateV3Plan = usePlannerStore((s) => s.recalculateV3Plan);

  const [families, setFamilies] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [selectedFamilyKey, setSelectedFamilyKey] = useState('');
  const [selectedPieceIds, setSelectedPieceIds] = useState(() => new Set());
  const [targetCrateDbId, setTargetCrateDbId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const v3 = useMemo(() => (crates || []).some((c) => c.packing_mode === 'v3'), [crates]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/projects/${projectId}/families`);
        if (!cancelled) {
          setFamilies(Array.isArray(res.data) ? res.data : []);
          setLoadErr(null);
        }
      } catch (e) {
        if (!cancelled) setLoadErr(e.message || 'Failed to load families');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, isRefreshing]);

  const familyOptions = useMemo(() => {
    return families.map((f) => ({
      key: bundleRowKey(f),
      label: `${f.family_id} · ${f.category_label || f.category} · ${f.flat_key || '—'}${
        f.is_split && f.split_reason ? ` — ${f.split_reason.slice(0, 120)}` : ''
      }`,
      ids: f.all_piece_ids || [],
      split: f.is_split,
      splitReason: f.split_reason || null,
    }));
  }, [families]);

  const selectedFam = familyOptions.find((f) => f.key === selectedFamilyKey);

  const togglePiece = (id) => {
    setSelectedPieceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runMove = async (ids) => {
    if (!ids?.length || !targetCrateDbId) {
      setMsg('Select a bundle (or pieces) and a target crate.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await assignFamily(ids, Number(targetCrateDbId));
      setMsg(`Moved ${ids.length} part(s). Weights, dims, containers, and summary were recalculated.`);
    } catch (e) {
      setMsg(e.response?.data?.detail || e.message || 'Move failed');
    } finally {
      setBusy(false);
    }
  };

  if (!v3) return null;

  return (
    <div className="rounded-[28px] border border-[#dbe4f0] bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748b]">Manual move (bundles first)</div>
      <p className="mt-2 text-sm text-[#64748b]">
        Default moves keep <strong className="text-[#0f172a]">family / PartBundle integrity</strong> (mains + splashes
        together). Enable advanced mode only to split a bundle by selecting individual parts.
      </p>

      {loadErr && <div className="mt-3 text-sm text-red-600">{loadErr}</div>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Advanced: move selected pieces only
        </label>
      </div>

      {!advanced ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-[#64748b]">Bundle (family)</div>
            <select
              className="mt-1 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm"
              value={selectedFamilyKey}
              onChange={(e) => setSelectedFamilyKey(e.target.value)}
              disabled={busy}
            >
              <option value="">— Select bundle —</option>
              {familyOptions.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                  {f.split ? (f.splitReason ? ' (split — see reason)' : ' (split across crates)') : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold text-[#64748b]">Target crate</div>
            <select
              className="mt-1 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-mono"
              value={targetCrateDbId}
              onChange={(e) => setTargetCrateDbId(e.target.value)}
              disabled={busy}
            >
              <option value="">— Select crate —</option>
              {crates
                .filter((c) => !c.locked)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.crate_id} · {formatNumber(Number(c.weight) || Number(c.total_weight) || 0, 0)} kg
                  </option>
                ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold text-[#64748b]">Pick pieces (split bundle)</div>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-2 text-sm">
            {families.flatMap((f) => (f.all_piece_ids || []).map((id) => ({ id, fam: bundleRowKey(f) }))).length === 0 ? (
              <div className="text-[#64748b]">No pieces.</div>
            ) : (
              families.map((f) => (
                <div key={bundleRowKey(f)} className="mb-2">
                  <div className="text-[11px] font-semibold text-[#475569]">{f.family_id}</div>
                  {(f.all_piece_ids || []).map((id) => (
                    <label key={id} className="flex cursor-pointer items-center gap-2 py-0.5 pl-2 font-mono text-xs">
                      <input
                        type="checkbox"
                        checked={selectedPieceIds.has(id)}
                        onChange={() => togglePiece(id)}
                        disabled={busy}
                      />
                      Part #{id}
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-[#64748b]">Target crate</div>
            <select
              className="mt-1 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-mono"
              value={targetCrateDbId}
              onChange={(e) => setTargetCrateDbId(e.target.value)}
              disabled={busy}
            >
              <option value="">— Select crate —</option>
              {crates
                .filter((c) => !c.locked)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.crate_id}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || isRefreshing}
          onClick={() =>
            advanced ? runMove([...selectedPieceIds]) : runMove(selectedFam?.ids || [])
          }
          className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1e40af] disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Move & recalculate'}
        </button>
        <button
          type="button"
          disabled={busy || !v3}
          onClick={() => recalculateV3Plan()}
          className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] disabled:opacity-50"
        >
          Recalculate only
        </button>
      </div>

      {msg && (
        <div className={`mt-3 text-sm ${msg.includes('fail') ? 'text-red-600' : 'text-emerald-700'}`}>{msg}</div>
      )}
    </div>
  );
};

export default PlannerManualMovePanel;
