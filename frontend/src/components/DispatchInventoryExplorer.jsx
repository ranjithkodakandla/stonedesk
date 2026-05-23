import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';

// ─── Operational bucket presentation (4 groups) ───────────────────────────────
// Maps the standardized Part Type → operational bucket key.
// Falls back to derived `category` for pieces not yet migrated.

const PART_TYPE_TO_BUCKET = {
  'Kitchen - Island Tops':     'kitchen_islands',
  'Kitchen - Perimeter Tops':  'kitchen',
  'Kitchen - Range Tops':      'kitchen',
  'Kitchen - Back Splash':     'kitchen',
  'Kitchen - Side Splash':     'kitchen',
  'Vanity - Top':              'vanity',
  'Vanity - Back Splash':      'vanity',
  'Vanity - Side Splash':      'vanity',
  'Misc - Full Height Splash': 'misc',
  'Misc - Window Sill':        'misc',
  'Misc - Bar Top':            'misc',
};

const CATEGORY_TO_BUCKET_FALLBACK = {
  island:    'kitchen_islands',
  perimeter: 'kitchen',
  range:     'kitchen',
  vanity:    'vanity',
  misc:      'misc',
};

const BUCKET = {
  kitchen_islands: { label: 'Kitchen — Islands', pill: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500',     header: 'text-blue-800'    },
  kitchen:         { label: 'Kitchen',           pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500',  header: 'text-emerald-800' },
  vanity:          { label: 'Vanity',            pill: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500',   header: 'text-violet-800'  },
  misc:            { label: 'Misc',              pill: 'bg-slate-100 text-slate-600',     dot: 'bg-slate-400',    header: 'text-slate-700'   },
};
const BUCKET_ORDER = ['kitchen_islands', 'kitchen', 'vanity', 'misc'];

const C = (bucketKey) => BUCKET[bucketKey] || BUCKET.misc;

// Derive bucket from a bundle: check main pieces' Part Type first, fall back to category.
function bucketForBundle(bundle) {
  // Backend pre-splits bundles by bucket — part_bucket is authoritative.
  if (bundle.part_bucket) return bundle.part_bucket;
  // Legacy fallback: derive from piece Part Types then category.
  const pieces = bundle.pieces || [];
  for (const p of pieces) {
    if (p.role !== 'splash') {
      const b = PART_TYPE_TO_BUCKET[String(p.part || '').trim()];
      if (b) return b;
    }
  }
  return CATEGORY_TO_BUCKET_FALLBACK[bundle.category] || 'misc';
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Aggregate response → 4 operational buckets (scope-level) ────────────────
// Collapses floor/category/flat hierarchy into 4 display rows keyed by bucket.
// Metrics are computed directly from individual pieces — never from bundle totals.

function aggregateByBucket(data) {
  if (!data?.floors?.length) return [];
  const bucketMap = new Map();

  for (const floor of data.floors) {
    for (const cat of floor.categories) {
      for (const flat of cat.flats || []) {
        for (const bundle of flat.bundles || []) {
          const bk = bucketForBundle(bundle);
          if (!bucketMap.has(bk)) {
            bucketMap.set(bk, {
              bucket: bk,
              bundles: [],
              flatGroups: [],
              total_weight_kg: 0,
              total_sqft: 0,
              part_count: 0,
            });
          }
          const entry = bucketMap.get(bk);
          entry.bundles.push(bundle);

          // Derive metrics directly from filtered parts, not bundle aggregates.
          const pieces = bundle.pieces || [];
          if (pieces.length > 0) {
            for (const p of pieces) {
              entry.total_weight_kg += p.weight_kg || 0;
              entry.total_sqft      += p.sqft      || 0;
              entry.part_count      += 1;
            }
          } else {
            // Fallback for bundles where piece detail is absent.
            entry.total_weight_kg += bundle.total_weight_kg || 0;
            entry.total_sqft      += bundle.total_sqft      || 0;
            entry.part_count      += bundle.part_count      || 0;
          }

          // Keep flat grouping for the detail view
          const fgKey = `${floor.floor}||${flat.flat}`;
          let fg = entry.flatGroups.find((f) => f._key === fgKey);
          if (!fg) {
            fg = { _key: fgKey, floor: floor.floor, flat: flat.flat, bundles: [] };
            entry.flatGroups.push(fg);
          }
          fg.bundles.push(bundle);
        }
      }
    }
  }

  return BUCKET_ORDER
    .filter((bk) => bucketMap.has(bk))
    .map((bk) => bucketMap.get(bk));
}

// ─── Part row ─────────────────────────────────────────────────────────────────

function PartRow({ piece }) {
  const isMain = piece.role === 'main';
  return (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-[#f8fafc] last:border-0">
      <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
        isMain ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'bg-amber-50 text-amber-700'
      }`}>
        {isMain ? 'Top' : 'Splash'}
      </span>
      <span className="font-mono text-[11px] text-[#334155] flex-1 min-w-0 truncate">
        {piece.part_no || piece.part || '—'}
      </span>
      <span className="text-[11px] text-[#64748b] flex-shrink-0 whitespace-nowrap">
        {piece.length > 0 && piece.width > 0 ? `${fmt(piece.length)} × ${fmt(piece.width)}″` : ''}
        {piece.thickness ? ` · ${piece.thickness}` : ''}
      </span>
      <span className="text-[11px] font-medium text-[#334155] flex-shrink-0 whitespace-nowrap">
        {fmt(piece.weight_kg)} kg
      </span>
    </div>
  );
}

// ─── Bundle card (detail view, no selection) ─────────────────────────────────

function BundleCard({ bundle, assignedTo }) {
  const [showParts, setShowParts] = useState(false);
  const st = C(bucketForBundle(bundle));
  const hasPieces = (bundle.pieces?.length ?? 0) > 0;

  return (
    <div className={`rounded-2xl border overflow-hidden ${
      assignedTo ? 'border-[#e2e8f0] bg-[#f8fafc]' : 'border-[#e8edf3] bg-white'
    }`}>
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2.5">
        {assignedTo && (
          <span className="mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[#f1f5f9] border border-[#e2e8f0] text-[#64748b] whitespace-nowrap">
            {assignedTo}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-semibold text-[#1e293b]">
              {bundle.family_id || (bundle.unit_id ? bundle.unit_id.slice(3, 11) : '—')}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.pill}`}>
              {st.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#64748b]">
            {bundle.main_count > 0 && <span>{bundle.main_count} top{bundle.main_count !== 1 ? 's' : ''}</span>}
            {bundle.splash_count > 0 && <span className="text-amber-600">+{bundle.splash_count} splash</span>}
            <span className="font-semibold text-[#1e293b]">{fmt(bundle.total_weight_kg)} kg</span>
            <span>{fmt(bundle.total_sqft)} ft²</span>
          </div>
          {bundle.main_part_nos?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              {bundle.main_part_nos.slice(0, 4).map((pn, i) => (
                <span key={i} className="font-mono text-[10px] text-[#94a3b8]">{pn}</span>
              ))}
              {bundle.main_part_nos.length > 4 && (
                <span className="text-[10px] text-[#94a3b8]">+{bundle.main_part_nos.length - 4}</span>
              )}
            </div>
          )}
        </div>
        {hasPieces && (
          <button
            type="button"
            onClick={() => setShowParts((s) => !s)}
            className="flex-shrink-0 self-start rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1 text-[10px] text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
          >
            {showParts ? '▴ Hide' : '▾ Parts'}
          </button>
        )}
      </div>
      {showParts && hasPieces && (
        <div className="border-t border-[#f1f5f9] px-3 pt-2 pb-3">
          {bundle.pieces.map((p, i) => <PartRow key={p.id ?? i} piece={p} />)}
        </div>
      )}
    </div>
  );
}

// ─── Bucket assembly row (scope-aggregated, 4 operational groups) ─────────────

const SELECT_STYLE = {
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2020/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

function BucketAssemblyRow({ bucketData, assignedBundleIds, draftCrates = [], onCreateCrate, onAddToCrate }) {
  const [showDetail, setShowDetail] = useState(false);
  const st = C(bucketData.bucket);
  const freeBundles = bucketData.bundles.filter((b) => !assignedBundleIds?.has(b.unit_id));
  const assignedBundles = bucketData.bundles.filter((b) => assignedBundleIds?.has(b.unit_id));
  const assignedPartCount = assignedBundles.reduce(
    (s, b) => s + (b.pieces?.length || b.part_count || 0), 0,
  );
  const allAssigned = freeBundles.length === 0 && bucketData.bundles.length > 0;

  const handleAddNew = () => {
    if (!freeBundles.length || !onCreateCrate) return;
    onCreateCrate(freeBundles);
  };

  const handleAddExisting = (e) => {
    const crateId = e.target.value;
    if (!crateId || !freeBundles.length || !onAddToCrate) return;
    onAddToCrate(crateId, freeBundles);
    e.target.value = '';
  };

  return (
    <div className="rounded-[20px] border border-[#dbe4f0] bg-white overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-5 py-4 flex-wrap">
        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${st.dot}`} />

        {/* Identity + metrics */}
        <div className="min-w-[150px]">
          <span className={`text-sm font-bold ${st.header}`}>{st.label}</span>
        </div>
        <span className="text-xs text-[#64748b]">
          {bucketData.part_count} parts
        </span>
        <span className="text-sm font-semibold text-[#1e293b]">{fmt(bucketData.total_weight_kg)} kg</span>
        <span className="text-xs text-[#94a3b8]">{fmt(bucketData.total_sqft)} ft²</span>
        {assignedPartCount > 0 && (
          <span className="rounded-full border border-[#e2e8f0] bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-medium text-[#64748b]">
            {assignedPartCount} parts in crate
          </span>
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0 flex-wrap">
          {allAssigned ? (
            <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-[11px] text-[#94a3b8]">
              All in crate
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={handleAddNew}
                className="rounded-full border border-[#0f172a] bg-[#0f172a] px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1e293b] active:scale-95 transition-all whitespace-nowrap"
              >
                + New Crate
              </button>
              {draftCrates.length > 0 && (
                <select
                  defaultValue=""
                  onChange={handleAddExisting}
                  className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#475569] hover:border-blue-300 transition-colors cursor-pointer appearance-none pr-7"
                  style={SELECT_STYLE}
                >
                  <option value="" disabled>Add to…</option>
                  {draftCrates.map((c) => (
                    <option key={c.id} value={c.id}>{c.id}</option>
                  ))}
                </select>
              )}
            </>
          )}
          {bucketData.bundles.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDetail((o) => !o)}
              className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-medium text-[#64748b] hover:bg-[#f1f5f9] transition-colors whitespace-nowrap"
            >
              {showDetail ? 'Hide' : `Details (${bucketData.part_count} parts)`}
            </button>
          )}
        </div>
      </div>

      {/* Detail: bundles grouped by flat */}
      {showDetail && (
        <div className="border-t border-[#f1f5f9] px-5 pb-4 pt-3 space-y-4">
          {bucketData.flatGroups.map((fg, i) => (
            <div key={fg._key || i}>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#94a3b8]">Flat</span>
                <span className="text-sm font-bold text-[#0f172a]">{fg.flat}</span>
                {fg.floor && fg.floor !== 'Unassigned' && (
                  <span className="text-xs text-[#94a3b8]">Floor {fg.floor}</span>
                )}
              </div>
              <div className="space-y-2 pl-3">
                {fg.bundles.map((b, j) => (
                  <BundleCard
                    key={b.unit_id || j}
                    bundle={b}
                    assignedTo={assignedBundleIds?.get(b.unit_id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Target weight control ────────────────────────────────────────────────────

const WEIGHT_PRESETS = [1800, 1900, 2000];

function TargetWeightControl({ value, onChange }) {
  const [custom, setCustom] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));

  const isPreset = WEIGHT_PRESETS.includes(value);

  const applyCustom = () => {
    const n = Number(inputVal);
    if (n > 0) onChange(n);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] self-center">Target weight</span>
      <div className="flex items-center gap-1">
        {WEIGHT_PRESETS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => { onChange(w); setCustom(false); }}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
              value === w && !custom
                ? 'bg-[#0f172a] text-white border border-[#0f172a]'
                : 'border border-[#e2e8f0] bg-white text-[#475569] hover:border-[#94a3b8]'
            }`}
          >
            {w.toLocaleString()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setCustom((s) => !s); setInputVal(String(value)); }}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
            !isPreset || custom
              ? 'bg-[#0f172a] text-white border border-[#0f172a]'
              : 'border border-[#e2e8f0] bg-white text-[#475569] hover:border-[#94a3b8]'
          }`}
        >
          Custom
        </button>
      </div>
      {(!isPreset || custom) && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={100}
            max={5000}
            step={50}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            className="w-24 rounded-xl border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] font-medium text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
          />
          <span className="text-[11px] text-[#94a3b8]">kg</span>
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-full border border-[#0f172a] bg-[#0f172a] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#1e293b]"
          >
            Set
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DispatchInventoryExplorer = ({ projectId, dispatchSelection, onCreateCrate, assignedBundleIds, draftCrates = [], onAddToCrate, targetWeightKg = 1900, onTargetWeightChange }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetchInventory = useCallback(() => {
    if (!projectId) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    axios
      .post(`${API_BASE}/projects/${projectId}/dispatch-inventory`, dispatchSelection || {}, {
        signal: ctrl.signal,
      })
      .then((res) => { setData(res.data); setLoading(false); })
      .catch((e) => {
        if (axios.isCancel(e)) return;
        setError(e?.response?.data?.detail || e.message || 'Failed to load inventory');
        setLoading(false);
      });
  }, [projectId, dispatchSelection]);

  useEffect(() => {
    fetchInventory();
    return () => abortRef.current?.abort();
  }, [fetchInventory]);

  const categories = useMemo(() => aggregateByBucket(data), [data]);
  const totals = data?.totals;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Step 2 — Crate Assembly</div>
          <div className="mt-0.5 text-xl font-semibold text-[#0f172a]">Select categories to crate</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onTargetWeightChange && (
            <div className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-2">
              <TargetWeightControl value={targetWeightKg} onChange={onTargetWeightChange} />
            </div>
          )}
          <button
            type="button"
            onClick={fetchInventory}
            disabled={loading}
            className="rounded-full border border-[#cbd5e1] bg-white px-4 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Scope totals */}
      {totals && (
        <div className="flex flex-wrap gap-2 items-center rounded-[20px] border border-[#dbe4f0] bg-[#f8fafc] px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8] mr-1 self-center">In scope</span>
          {[
            { l: 'Parts',  v: totals.part_count                       },
            { l: 'Weight', v: `${fmt(totals.total_weight_kg)} kg`  },
            { l: 'Sq ft',  v: fmt(totals.total_sqft)               },
          ].map(({ l, v }) => (
            <span key={l} className="flex flex-col items-center rounded-xl border border-[#e8edf3] bg-white px-3 py-1.5 min-w-[64px] text-center">
              <span className="text-[9px] uppercase tracking-wide text-[#94a3b8] leading-none">{l}</span>
              <span className="mt-0.5 text-sm font-semibold text-[#0f172a] leading-tight">{v}</span>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading && !data && (
        <div className="rounded-[24px] border border-[#dbe4f0] bg-white px-5 py-12 text-center text-sm text-[#94a3b8]">
          Loading inventory…
        </div>
      )}

      {/* Category assembly rows */}
      {data && (
        <div className="space-y-3">
          {categories.length === 0 ? (
            <div className="rounded-[24px] border border-[#dbe4f0] bg-white px-5 py-12 text-center text-sm text-[#94a3b8]">
              No pieces found for this dispatch selection.
            </div>
          ) : (
            categories.map((bucketData) => (
              <BucketAssemblyRow
                key={bucketData.bucket}
                bucketData={bucketData}
                assignedBundleIds={assignedBundleIds}
                draftCrates={draftCrates}
                onCreateCrate={onCreateCrate}
                onAddToCrate={onAddToCrate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default DispatchInventoryExplorer;
