import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE, bundleRowKey } from '../utils/plannerUtils';
import { usePlannerStore } from '../store/plannerStore';

const IGNORE_PREFIX = 'stonedesk-underload-dismiss-';

/**
 * Surfaces planner pull hints for underloaded v3 crates (island Phase A).
 */
const UnderloadedCrateAssistant = ({ projectId }) => {
  const crates = usePlannerStore((s) => s.crates);
  const assignFamily = usePlannerStore((s) => s.assignFamily);
  const isRefreshing = usePlannerStore((s) => s.isRefreshing);

  const [families, setFamilies] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [ignored, setIgnored] = useState(() => new Set());
  const [busyCrateId, setBusyCrateId] = useState(null);
  const [chooseCrate, setChooseCrate] = useState(null);
  const [chooseFamilyId, setChooseFamilyId] = useState('');

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

  useEffect(() => {
    if (!projectId) return;
    const next = new Set();
    for (const c of crates) {
      try {
        if (localStorage.getItem(`${IGNORE_PREFIX}${projectId}-${c.id}`)) next.add(c.id);
      } catch {
        /* ignore */
      }
    }
    setIgnored(next);
  }, [projectId, crates]);

  const underloaded = useMemo(() => {
    return crates.filter(
      (c) =>
        c.packing_mode === 'v3' &&
        !c.locked &&
        c.weight_band_status === 'below_ideal' &&
        (c.planner_v3_pull_piece_ids || []).length > 0 &&
        !ignored.has(c.id),
    );
  }, [crates, ignored]);

  const bundlesFor = (crate) => {
    const pull = new Set(crate.planner_v3_pull_piece_ids || []);
    return families.filter((f) => {
      const ids = f.all_piece_ids || [];
      if (!ids.some((id) => pull.has(id))) return false;
      if (f.current_crate_db_id === crate.id) return false;
      return true;
    });
  };

  const dismiss = (crate) => {
    try {
      localStorage.setItem(`${IGNORE_PREFIX}${projectId}-${crate.id}`, '1');
    } catch {
      /* ignore */
    }
    setIgnored((prev) => new Set([...prev, crate.id]));
    if (chooseCrate?.id === crate.id) setChooseCrate(null);
  };

  const runAutoPull = async (crate) => {
    const opts = bundlesFor(crate);
    if (!opts.length) return;
    const sorted = [...opts].sort((a, b) => (a.total_weight_kg || 0) - (b.total_weight_kg || 0));
    const pick = sorted[0];
    setBusyCrateId(crate.id);
    try {
      await assignFamily(pick.all_piece_ids, crate.id);
    } finally {
      setBusyCrateId(null);
    }
  };

  const runChoosePull = async () => {
    if (!chooseCrate) return;
    const fam = families.find((f) => bundleRowKey(f) === chooseFamilyId);
    if (!fam?.all_piece_ids?.length) return;
    setBusyCrateId(chooseCrate.id);
    try {
      await assignFamily(fam.all_piece_ids, chooseCrate.id);
      setChooseCrate(null);
      setChooseFamilyId('');
    } finally {
      setBusyCrateId(null);
    }
  };

  if (!underloaded.length && !loadErr) return null;

  return (
    <div className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900/80">Underloaded crate assistant</div>
      <p className="mt-2 text-sm text-amber-950/90">
        For island crates below target weight, we suggest nearby part groups that share pull candidates. Use{' '}
        <strong>Auto pull</strong> to move the lightest matching group into this crate (whole family),{' '}
        <strong>Choose</strong> to pick one, or <strong>Ignore</strong> to hide this crate until you clear site data.
      </p>
      {loadErr && <div className="mt-2 text-sm text-red-700">{loadErr}</div>}

      {underloaded.map((c) => {
        const opts = bundlesFor(c);
        const busy = busyCrateId === c.id || isRefreshing;
        return (
          <div
            key={c.id}
            className="mt-4 rounded-2xl border border-amber-300/60 bg-white/90 px-4 py-3 text-sm text-[#0f172a]"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">
                  {c.crate_id} <span className="font-normal text-[#64748b]">· {c.name || 'Crate'}</span>
                </div>
                <div className="mt-1 text-xs text-[#64748b]">
                  {opts.length} nearby part group{opts.length === 1 ? '' : 's'} match pull hints ·{' '}
                  {(c.planner_v3_pull_piece_ids || []).length} candidate part id(s)
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !opts.length}
                  onClick={() => runAutoPull(c)}
                  className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Auto pull
                </button>
                <button
                  type="button"
                  disabled={busy || !opts.length}
                  onClick={() => {
                    setChooseCrate(c);
                    setChooseFamilyId(bundleRowKey(opts[0]) || '');
                  }}
                  className="rounded-full border border-amber-500 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-40"
                >
                  Choose…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => dismiss(c)}
                  className="rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1.5 text-xs font-semibold text-[#475569]"
                >
                  Ignore
                </button>
              </div>
            </div>
            {opts.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-[#475569]">
                {opts.slice(0, 5).map((f) => (
                  <li key={bundleRowKey(f)}>
                    {f.family_id} · {f.category_label || f.category} · {f.total_weight_kg} kg · from{' '}
                    {f.current_crate_label || (f.current_crate_db_id ? '—' : 'unassigned')}
                  </li>
                ))}
                {opts.length > 5 && <li>…and {opts.length - 5} more</li>}
              </ul>
            )}
          </div>
        );
      })}

      {chooseCrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-sm font-semibold text-[#0f172a]">Pull part group into {chooseCrate.crate_id}</div>
            <p className="mt-2 text-xs text-[#64748b]">Whole family moves; planner recalculates immediately after.</p>
            <select
              className="mt-4 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm"
              value={chooseFamilyId}
              onChange={(e) => setChooseFamilyId(e.target.value)}
            >
              {bundlesFor(chooseCrate).map((f) => (
                <option key={bundleRowKey(f)} value={bundleRowKey(f)}>
                  {f.family_id} · {f.total_weight_kg} kg · from{' '}
                  {f.current_crate_label || (f.current_crate_db_id ? '—' : 'unassigned')}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm"
                onClick={() => {
                  setChooseCrate(null);
                  setChooseFamilyId('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!chooseFamilyId || busyCrateId != null}
                className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                onClick={runChoosePull}
              >
                Pull selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnderloadedCrateAssistant;
