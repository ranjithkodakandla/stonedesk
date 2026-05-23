import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';

function statusStyle(status) {
  const s = (status || '').toUpperCase();
  if (s === 'OPTIMAL') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (s === 'ACCEPTABLE') return 'bg-sky-50 text-sky-800 border-sky-200';
  if (s === 'UNDERLOADED') return 'bg-amber-50 text-amber-900 border-amber-200';
  if (s === 'OVERWEIGHT') return 'bg-rose-50 text-rose-800 border-rose-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function SlabStack({ rows }) {
  if (!rows || !rows.length) return <div className="text-xs text-[#94a3b8]">No slabs</div>;
  const tw = rows.reduce((a, r) => a + Math.max(0.05, Number(r.thickness_in) || 0), 0);
  return (
    <div className="flex h-12 flex-row items-end gap-px overflow-hidden rounded border border-[#e2e8f0] bg-[#f8fafc] px-1 py-1">
      {rows.map((r, i) => {
        const w = Math.max(0.05, Number(r.thickness_in) || 0);
        const pct = tw > 0 ? (w / tw) * 100 : 100 / rows.length;
        return (
          <div
            key={i}
            title={`${r.part_no || 'Part'} — ${w}"`}
            className="min-w-[2px] rounded-sm bg-[#475569]"
            style={{ width: `${pct}%`, height: '100%' }}
          />
        );
      })}
    </div>
  );
}

/**
 * Preview-only island operational crates (API: POST .../island-operational/plan).
 * Shown when VITE_PLANNER_V3_OPERATIONAL is true and project is approved for packing.
 */
export default function IslandOperationalReview({ projectId, project, embedded = false }) {
  const [options, setOptions] = useState({ buildings: [], floors: [], flats: [] });
  const [selB, setSelB] = useState([]);
  const [selF, setSelF] = useState([]);
  const [selFl, setSelFl] = useState([]);
  const [crates, setCrates] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [expanded, setExpanded] = useState({});

  const toggle = useCallback((idx) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const loadOptions = useCallback(async () => {
    setLoadingOpts(true);
    setError('');
    try {
      const { data } = await axios.get(`${API_BASE}/projects/${projectId}/island-operational/options`);
      setOptions({
        buildings: data.buildings || [],
        floors: data.floors || [],
        flats: data.flats || [],
      });
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load location options');
    } finally {
      setLoadingOpts(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const multiProps = useMemo(
    () => ({
      className: 'mt-1 w-full min-h-[88px] rounded-xl border border-[#e2e8f0] bg-white px-2 py-2 text-sm',
      size: 4,
    }),
    [],
  );

  const runPlan = async () => {
    setLoading(true);
    setError('');
    try {
      const body = {
        buildings: selB.length ? selB : undefined,
        floors: selF.length ? selF : undefined,
        flats: selFl.length ? selFl : undefined,
        dispatch_selection: project?.dispatch_selection || undefined,
      };
      const { data } = await axios.post(`${API_BASE}/projects/${projectId}/island-operational/plan`, body);
      if (data.message === 'no pieces in scope') {
        setCrates([]);
        setMeta(data);
        setError('No parts match the selected building / floor / flat filters (island-classified parts may be empty).');
        return;
      }
      setCrates(data.crates || []);
      setMeta(data);
    } catch (e) {
      const d = e.response?.data?.detail;
      setCrates([]);
      setMeta(null);
      setError(typeof d === 'string' ? d : d ? JSON.stringify(d) : e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`${
        embedded ? 'mt-8' : 'mt-10'
      } rounded-[28px] border border-[#bfdbfe] bg-[#f8fafc] p-6 shadow-sm`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Operational</div>
          <h3 className="mt-1 text-lg font-semibold text-[#0f172a]">Island crate plan (preview)</h3>
          <p className="mt-2 max-w-2xl text-sm text-[#64748b]">
            Generates <strong>island-only</strong> vertical-cassette crates from current parts. Does not write crates to
            the database. Requires <code className="rounded bg-white px-1">PLANNER_V3_OPERATIONAL=1</code> on the API
            server.
          </p>
          {embedded && (
            <p className="mt-2 max-w-2xl text-sm text-[#64748b]">
              After review, use <strong className="text-[#334155]">Generate Crate Plan</strong> in the dispatch section
              above to persist the full v3 layout (islands + B/C/D) to this project.
            </p>
          )}
        </div>
      </div>

      {loadingOpts ? (
        <p className="mt-4 text-sm text-[#64748b]">Loading location lists…</p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="font-medium text-[#334155]">Buildings</span>
            <span className="ml-1 text-xs text-[#94a3b8]">(empty = all)</span>
            <select
              multiple
              {...multiProps}
              value={selB}
              onChange={(e) => setSelB([...e.target.selectedOptions].map((o) => o.value))}
            >
              {options.buildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-[#334155]">Floors</span>
            <span className="ml-1 text-xs text-[#94a3b8]">(empty = all)</span>
            <select
              multiple
              {...multiProps}
              value={selF}
              onChange={(e) => setSelF([...e.target.selectedOptions].map((o) => o.value))}
            >
              {options.floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-[#334155]">Flats</span>
            <span className="ml-1 text-xs text-[#94a3b8]">(empty = all)</span>
            <select
              multiple
              {...multiProps}
              value={selFl}
              onChange={(e) => setSelFl([...e.target.selectedOptions].map((o) => o.value))}
            >
              {options.flats.map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={loading}
          onClick={runPlan}
          className="rounded-full bg-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1e40af] disabled:bg-[#94a3b8]"
        >
          {loading ? 'Generating…' : 'Generate island plan'}
        </button>
        <span className="text-xs text-[#64748b]">
          {meta && meta.scoped_piece_count != null
            ? `${meta.scoped_piece_count} part(s) in scope • ${meta.crate_count ?? 0} preview crate(s)`
            : null}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>
      )}

      {meta?.batching && (
        <div className="mt-4 rounded-xl border border-[#cbd5e1] bg-white px-4 py-3 text-xs text-[#334155]">
          <div className="font-semibold text-[#0f172a]">Batching mode: {meta.batching.mode}</div>
          <p className="mt-1 leading-relaxed text-[#64748b]">{meta.batching.explanation}</p>
          <p className="mt-1 text-[#475569]">
            Scope: <span className="font-medium">{meta.batching.scope_label}</span> · Island part groups in scope:{' '}
            {meta.batching.scoped_island_bundle_count}
          </p>
        </div>
      )}

      {!!crates.length && (
        <div className="mt-8 space-y-4">
          {crates.map((c, idx) => (
            <div key={idx} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <button
                type="button"
                onClick={() => toggle(idx)}
                className="flex w-full flex-wrap items-start justify-between gap-4 text-left"
              >
                <div>
                  <div className="text-base font-semibold text-[#0f172a]">{c.name || `Crate ${idx + 1}`}</div>
                  <div className="mt-2 text-sm text-[#475569]">
                    Weight: <strong>{c.total_weight_kg} kg</strong>
                    <span className="mx-2 text-[#cbd5e1]">|</span>
                    Dimensions: <strong>{c.dimensions_in?.label || '—'}</strong> in
                  </div>
                  <div className="mt-2 text-sm text-[#64748b]">
                    Part groups: {c.bundle_count} · Slabs: {c.slab_count}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(c.status)}`}
                  >
                    {c.status}
                  </span>
                  <span className="text-xs text-[#94a3b8]">{expanded[idx] ? 'Hide detail ▲' : 'Show detail ▼'}</span>
                </div>
              </button>

              <div className="mt-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[#64748b]">Stack (slab thickness)</div>
                <div className="mt-1 max-w-md">
                  <SlabStack rows={c.slab_stack} />
                </div>
              </div>

              {(() => {
                const od = c.optimization_debug || {};
                const tw = c.target_weight_kg || {};
                return (
                  <div className="mt-4 rounded-lg border border-dashed border-[#cbd5e1] bg-[#fafafa] px-3 py-2 text-[11px] leading-snug text-[#475569]">
                    <div className="font-semibold text-[#334155]">Optimizer (UAT)</div>
                    <div className="mt-1 grid gap-0.5 sm:grid-cols-2">
                      <div>
                        Target ideal: <strong>{tw.ideal_center ?? od.target_ideal_center_kg ?? 1900} kg</strong> (band{' '}
                        {tw.lo}–{tw.hi} kg)
                      </div>
                      <div>
                        Actual: <strong>{od.actual_weight_kg ?? c.total_weight_kg} kg</strong>
                      </div>
                      <div>Same-flat bonus (cost units): {od.flat_bonus_cost_units ?? '—'}</div>
                      <div>Material bonus (cost units): {od.material_bonus_cost_units ?? '—'}</div>
                    </div>
                    {(od.why_summary_lines || []).length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-[#64748b]">
                        {(od.why_summary_lines || []).slice(0, 4).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                    {(od.batching_decisions || []).filter((d) => d.type === 'merge_vs_flush').length > 0 && (
                      <div className="mt-2 text-[10px] text-[#64748b]">
                        Merge steps (adjacency tier / bonuses applied at decision):{' '}
                        {(od.batching_decisions || [])
                          .filter((d) => d.type === 'merge_vs_flush')
                          .map((d, i) => (
                            <span key={i} className="mr-2 inline-block whitespace-nowrap">
                              {d.bundle_id}: tier {d.adjacency_tier} ({d.adjacency_tier_label || '?'}) flat{' '}
                              +{d.same_flat_bonus_cost_units ?? 0} / mat +{d.material_bonus_cost_units ?? 0}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {expanded[idx] && (
                <div className="mt-5 border-t border-[#f1f5f9] pt-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">By flat</div>
                  <ul className="mt-2 space-y-3">
                    {(c.expanded || []).map((g) => (
                      <li key={g.flat}>
                        <div className="font-medium text-[#0f172a]">Flat {g.flat}</div>
                        <ul className="mt-1 list-disc pl-5 text-[#475569]">
                          {(g.parts || []).map((p) => (
                            <li key={p.id}>
                              {p.part_no || `#${p.id}`}
                              {p.role === 'waterfall' ? (
                                <span className="ml-1 text-xs text-[#64748b]">(waterfall)</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {c.target_weight_kg && (
                    <p className="mt-4 text-xs text-[#64748b]">
                      Target band: {c.target_weight_kg.lo}–{c.target_weight_kg.hi} kg (ideal center{' '}
                      {c.target_weight_kg.ideal_center ?? 1900} kg) · Acceptable: {c.target_weight_kg.acceptable_lo}–
                      {c.target_weight_kg.acceptable_hi} kg
                    </p>
                  )}
                  {(c.optimization_debug?.batching_decisions || []).length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-[#64748b]">
                        Full batching decision trace
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-[#f1f5f9] p-2 text-[10px] text-[#334155]">
                        {JSON.stringify(c.optimization_debug.batching_decisions, null, 2)}
                      </pre>
                    </details>
                  )}
                  {c.status === 'UNDERLOADED' && !!(c.suggested_pulls || []).length && (
                    <div className="mt-4 rounded-xl bg-[#fffbeb] px-4 py-3 text-[#92400e]">
                      <div className="text-xs font-semibold uppercase tracking-wide">Suggested pulls</div>
                      <ul className="mt-2 list-disc pl-5">
                        {(c.suggested_pulls || []).map((s) => (
                          <li key={s.bundle_id}>{s.label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(c.warnings || []).length > 0 && (
                    <ul className="mt-3 list-disc pl-5 text-xs text-[#b45309]">
                      {c.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
