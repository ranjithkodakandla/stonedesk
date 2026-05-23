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

/**
 * Vertical strip bar showing the relative depth contribution of each slab.
 * Width = proportional to slab thickness (all slabs standing vertically,
 * thickness accumulates into crate depth).
 */
function DepthStack({ pieces }) {
  if (!pieces || !pieces.length) return <div className="text-xs text-[#94a3b8]">No slabs</div>;
  const roles = pieces.map((p) => p.role || 'main_top');
  const totalDepth = pieces.reduce((a) => a + 1, 0); // each piece is 1 thickness unit
  return (
    <div className="flex h-10 flex-row items-end gap-px overflow-hidden rounded border border-[#d1fae5] bg-[#f0fdf4] px-1 py-1">
      {pieces.map((p, i) => {
        const pct = totalDepth > 0 ? (1 / totalDepth) * 100 : 100 / pieces.length;
        const isSplash = roles[i] === 'splash';
        return (
          <div
            key={i}
            title={`${p.part_no || 'Part'} — ${isSplash ? 'splash' : 'main top'}`}
            className={`min-w-[2px] rounded-sm ${isSplash ? 'bg-[#34d399]' : 'bg-[#059669]'}`}
            style={{ width: `${pct}%`, height: isSplash ? '60%' : '100%' }}
          />
        );
      })}
    </div>
  );
}

/**
 * Vertical assembly visualization for one bundle:
 *   [ Main Top A  ]
 *   [ Splash A    ]
 *   [ Splash A    ]
 * All pieces stand vertically — grouping conveys operational relationship.
 */
function BundleAssembly({ bundle }) {
  const mains = (bundle.assembly || []).filter((p) => p.role === 'main_top');
  const splashes = (bundle.assembly || []).filter((p) => p.role === 'splash');

  return (
    <div className="rounded-lg border border-[#d1fae5] bg-[#f0fdf4] p-3 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-[#065f46]">
          Flat {bundle.flat || '—'}
          {bundle.building ? ` · Bldg ${bundle.building}` : ''}
          {bundle.floor ? ` · Fl ${bundle.floor}` : ''}
        </span>
        <span className="text-[#6b7280]">{bundle.weight_kg} kg</span>
      </div>

      {mains.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {mains.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-1.5 rounded-sm bg-[#059669]" title="Main top" />
              <span className="font-medium text-[#065f46]">{p.part_no || `#${p.id}`}</span>
              {p.length > 0 && p.width > 0 && (
                <span className="text-[#6b7280]">
                  {p.length}" × {p.width}"
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {splashes.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-l-2 border-[#a7f3d0] pl-2">
          {splashes.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-[#6b7280]">
              <span className="inline-block h-3 w-1 rounded-sm bg-[#34d399]" title="Splash" />
              <span>{p.part_no || `#${p.id}`}</span>
              {p.length > 0 && p.width > 0 && (
                <span className="text-[#9ca3af]">
                  {p.length}" × {p.width}"
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {mains.length === 0 && splashes.length === 0 && (
        <div className="text-[#9ca3af]">No pieces</div>
      )}
    </div>
  );
}

/**
 * Preview-only kitchen (B-type perimeter) operational crate plan.
 * Vertical-cassette grouped assembly model — all pieces stand vertically,
 * splashes operationally tied to their parent tops.
 * Does not write crates to the database.
 */
export default function KitchenOperationalReview({ projectId, project, embedded = false }) {
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
      const { data } = await axios.get(`${API_BASE}/projects/${projectId}/kitchen-operational/options`);
      setOptions({
        buildings: data.buildings || [],
        floors: data.floors || [],
        flats: data.flats || [],
      });
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load kitchen location options');
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
      };
      const { data } = await axios.post(`${API_BASE}/projects/${projectId}/kitchen-operational/plan`, body);
      if (data.message === 'no pieces in scope' || data.message?.startsWith('no kitchen')) {
        setCrates([]);
        setMeta(data);
        setError(
          data.message === 'no pieces in scope'
            ? 'No parts match the selected filters (no kitchen parts in scope).'
            : 'No kitchen (perimeter) parts found in the selected scope.',
        );
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

  const totalWeight = crates.reduce((a, c) => a + (c.total_weight_kg || 0), 0);
  const optimalCount = crates.filter((c) => c.status === 'OPTIMAL').length;
  const underloadedCount = crates.filter((c) => c.status === 'UNDERLOADED').length;

  return (
    <div
      className={`${
        embedded ? 'mt-8' : 'mt-10'
      } rounded-[28px] border border-[#a7f3d0] bg-[#f0fdf4] p-6 shadow-sm`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#059669]">Operational</div>
          <h3 className="mt-1 text-lg font-semibold text-[#0f172a]">Kitchen crate plan (preview)</h3>
          <p className="mt-2 max-w-2xl text-sm text-[#64748b]">
            Generates <strong>B-type kitchen</strong> vertical-cassette crates from current perimeter parts. All pieces
            stand vertically — main tops grouped with their splash sets. Does not write crates to the database.
          </p>
          {embedded && (
            <p className="mt-2 max-w-2xl text-sm text-[#64748b]">
              After review, use <strong className="text-[#334155]">Generate Crate Plan</strong> above to persist the full
              v3 layout (A/B/C/D) including kitchen crates.
            </p>
          )}
        </div>
      </div>

      {loadingOpts ? (
        <p className="mt-4 text-sm text-[#64748b]">Loading kitchen location lists…</p>
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
          className="rounded-full bg-[#059669] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#047857] disabled:bg-[#94a3b8]"
        >
          {loading ? 'Generating…' : 'Generate kitchen plan'}
        </button>
        <span className="text-xs text-[#64748b]">
          {meta && meta.scoped_piece_count != null
            ? `${meta.scoped_piece_count} part(s) in scope · ${meta.crate_count ?? 0} preview crate(s)`
            : null}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {meta?.batching && (
        <div className="mt-4 rounded-xl border border-[#d1fae5] bg-white px-4 py-3 text-xs text-[#334155]">
          <div className="font-semibold text-[#0f172a]">Batching mode: {meta.batching.mode}</div>
          <p className="mt-1 leading-relaxed text-[#64748b]">{meta.batching.explanation}</p>
          <p className="mt-1 text-[#475569]">
            Scope: <span className="font-medium">{meta.batching.scope_label}</span> · Kitchen part groups in scope:{' '}
            {meta.batching.scoped_kitchen_bundle_count}
          </p>
        </div>
      )}

      {crates.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-4 rounded-xl border border-[#d1fae5] bg-white px-4 py-3 text-xs text-[#334155]">
          <span>
            Crates: <strong>{crates.length}</strong>
          </span>
          <span>
            Total weight: <strong>{totalWeight.toFixed(2)} kg</strong>
          </span>
          <span className="text-emerald-700">
            Optimal: <strong>{optimalCount}</strong>
          </span>
          {underloadedCount > 0 && (
            <span className="text-amber-700">
              Underloaded: <strong>{underloadedCount}</strong>
            </span>
          )}
        </div>
      )}

      {!!crates.length && (
        <div className="mt-6 space-y-4">
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
                  <div className="mt-1.5 flex flex-wrap gap-3 text-sm text-[#64748b]">
                    <span>Part groups: {c.bundle_count}</span>
                    <span>Main tops: {c.main_top_count}</span>
                    <span>Splashes: {c.splash_count}</span>
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

              {/* Depth bar — compact visualization of vertical slab stack */}
              <div className="mt-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[#64748b]">
                  Vertical stack (depth profile)
                  <span className="ml-2 font-normal normal-case text-[#94a3b8]">
                    dark = main top · light = splash
                  </span>
                </div>
                <div className="mt-1 max-w-md">
                  <DepthStack
                    pieces={(c.bundles || []).flatMap((b) => b.assembly || [])}
                  />
                </div>
              </div>

              {/* Target weight band indicator */}
              {(() => {
                const tw = c.target_weight_kg || {};
                const wt = c.total_weight_kg || 0;
                const lo = tw.acceptable_lo ?? 1400;
                const hi = tw.acceptable_hi ?? 2200;
                const pct = Math.min(100, Math.max(0, ((wt - lo) / (hi - lo)) * 100));
                const idealLoPct = ((tw.lo ?? 1800) - lo) / (hi - lo) * 100;
                const idealHiPct = ((tw.hi ?? 2000) - lo) / (hi - lo) * 100;
                return (
                  <div className="mt-4 rounded-lg border border-dashed border-[#d1fae5] bg-[#f9fafb] px-3 py-2 text-[11px] text-[#475569]">
                    <div className="font-semibold text-[#334155]">Weight band</div>
                    <div className="mt-1.5 relative h-3 w-full rounded-full bg-[#e5e7eb]">
                      {/* ideal band highlight */}
                      <div
                        className="absolute top-0 h-3 rounded-full bg-[#bbf7d0]"
                        style={{ left: `${idealLoPct}%`, width: `${idealHiPct - idealLoPct}%` }}
                      />
                      {/* actual weight marker */}
                      <div
                        className="absolute top-0 h-3 w-1.5 rounded-full bg-[#059669]"
                        style={{ left: `${Math.max(0, Math.min(98, pct))}%` }}
                        title={`${wt} kg`}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[#9ca3af]">
                      <span>{lo} kg</span>
                      <span className="text-[#059669] font-medium">{wt} kg actual</span>
                      <span>{hi} kg</span>
                    </div>
                    <div className="mt-0.5 text-center text-[#6b7280]">
                      Ideal band: {tw.lo}–{tw.hi} kg · center {tw.ideal_center} kg
                    </div>
                  </div>
                );
              })()}

              {/* Expanded: bundle assemblies */}
              {expanded[idx] && (
                <div className="mt-5 border-t border-[#f1f5f9] pt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    Part group assemblies — vertical groupings
                  </div>
                  <p className="mt-1 text-xs text-[#94a3b8]">
                    Each block = one family assignment (main top + its splash set). All pieces stand vertically inside the crate.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(c.bundles || []).map((b) => (
                      <BundleAssembly key={b.bundle_id} bundle={b} />
                    ))}
                  </div>

                  {/* Target band text */}
                  {c.target_weight_kg && (
                    <p className="mt-4 text-xs text-[#64748b]">
                      Target band: {c.target_weight_kg.lo}–{c.target_weight_kg.hi} kg (ideal center{' '}
                      {c.target_weight_kg.ideal_center} kg) · Acceptable: {c.target_weight_kg.acceptable_lo}–
                      {c.target_weight_kg.acceptable_hi} kg
                    </p>
                  )}

                  {/* Underloaded pull suggestions */}
                  {c.status === 'UNDERLOADED' && !!(c.suggested_pulls || []).length && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                        Suggested pulls (nearest kitchen families)
                      </div>
                      <ul className="mt-2 space-y-1">
                        {(c.suggested_pulls || []).map((s) => (
                          <li key={s.bundle_id} className="flex items-start gap-2 text-xs text-amber-900">
                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>
                              {s.label}
                              {s.main_count > 0 && (
                                <span className="ml-1 text-amber-700">
                                  · {s.main_count} top{s.main_count !== 1 ? 's' : ''}
                                  {s.splash_count > 0 ? ` + ${s.splash_count} splash` : ''}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warnings */}
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
