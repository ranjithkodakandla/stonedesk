import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';
import { weightBatchParts } from '../utils/crateEstimator';
import MultiSelectDropdown from './MultiSelectDropdown';
import TargetWeightControl from './TargetWeightControl';

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FILTER_DIMS = [
  { key: 'buildings', field: 'building', label: 'Building' },
  { key: 'floors', field: 'floor', label: 'Floor' },
  { key: 'lengths', field: 'length', label: 'Length (in)' },
  { key: 'widths', field: 'width', label: 'Width / Depth (in)' },
  { key: 'qtys', field: 'qty', label: 'Qty' },
  { key: 'thicknesses', field: 'thickness', label: 'Thickness' },
  { key: 'categories', field: 'category', label: 'Category' },
  { key: 'partTypes', field: 'part', label: 'Part Type' },
];

const EMPTY_FILTERS = FILTER_DIMS.reduce((acc, d) => ({ ...acc, [d.key]: [] }), {});

function partMatchesFilters(part, filters, exceptKey) {
  return FILTER_DIMS.every((d) => {
    if (d.key === exceptKey) return true;
    const sel = filters[d.key];
    if (!sel.length) return true;
    return sel.includes(String(part[d.field]));
  });
}

// Cascading facet options: for a given dimension, compute distinct values from
// parts that match every OTHER active filter (classic Excel AutoFilter behavior).
function facetOptions(parts, filters, dim) {
  const values = new Set();
  for (const p of parts) {
    if (partMatchesFilters(p, filters, dim.key)) values.add(String(p[dim.field]));
  }
  return [...values].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
  });
}

// ─── Category bucket ordering ─────────────────────────────────────────────────
// Kitchen Islands fill first, then remaining Kitchen (perimeter/range/splash),
// then Vanity, then everything else — mirrors dispatch-order used elsewhere
// (backend _PART_TYPE_TO_BUCKET) so auto-bucketing never interleaves categories.
const PART_TYPE_TO_BUCKET_ORDER = {
  'Kitchen - Island Tops': 0,
  'Kitchen - Perimeter Tops': 1,
  'Kitchen - Range Tops': 1,
  'Kitchen - Back Splash': 1,
  'Kitchen - Side Splash': 1,
  'Vanity - Top': 2,
  'Vanity - Back Splash': 2,
  'Vanity - Side Splash': 2,
  'Misc - Full Height Splash': 3,
  'Misc - Window Sill': 3,
  'Misc - Bar Top': 3,
};
const CATEGORY_TO_BUCKET_ORDER = { island: 0, perimeter: 1, range: 1, vanity: 2, misc: 3 };

function bucketOrderForPart(part) {
  const byType = PART_TYPE_TO_BUCKET_ORDER[String(part.part || '').trim()];
  if (byType != null) return byType;
  return CATEGORY_TO_BUCKET_ORDER[String(part.category || '').toLowerCase()] ?? 3;
}

function sortByBucketOrder(parts) {
  return [...parts].sort((a, b) => bucketOrderForPart(a) - bucketOrderForPart(b));
}

// ─── Crate dimension configuration ────────────────────────────────────────────
// Editable by the employee before auto-bucketing. Defaults per current spec:
// internal = raw part extents + margin (length/width each side, height total);
// external = internal + fixed add-on for length/width, plus a FIXED external
// height per crate class (islands are taller than kitchen/vanity horizontals).
const DEFAULT_DIM_CONFIG = {
  lengthMarginEachSide: 0.5,
  widthMarginEachSide: 0.5,
  heightMargin: 2,
  kvExternalLWAdd: 4,
  kvExternalHeight: 7,
  islandExternalLWAdd: 4,
  islandExternalHeight: 9,
};

const THICKNESS_INCH = { '2CM': 0.79, '3CM': 1.18, '4CM': 1.57 };
function thicknessInches(t) {
  const key = String(t || '').trim().toUpperCase().replace(' ', '');
  return THICKNESS_INCH[key] ?? 1.18;
}

function computeCrateDimensions(parts, dimConfig) {
  if (!parts.length) {
    return { internal_length: 0, internal_width: 0, internal_height: 0, external_length: 0, external_width: 0, external_height: 0 };
  }
  const rawLength = Math.max(...parts.map((p) => p.length || 0));
  const rawWidth = Math.max(...parts.map((p) => p.width || 0));
  const rawHeight = parts.reduce((s, p) => s + thicknessInches(p.thickness) * (p.qty || 1), 0);

  const internal_length = rawLength + dimConfig.lengthMarginEachSide * 2;
  const internal_width = rawWidth + dimConfig.widthMarginEachSide * 2;
  const internal_height = rawHeight + dimConfig.heightMargin;

  const isIsland = parts.some((p) => bucketOrderForPart(p) === 0);
  const extLWAdd = isIsland ? dimConfig.islandExternalLWAdd : dimConfig.kvExternalLWAdd;
  const extHeight = isIsland ? dimConfig.islandExternalHeight : dimConfig.kvExternalHeight;

  return {
    internal_length,
    internal_width,
    internal_height,
    external_length: internal_length + extLWAdd,
    external_width: internal_width + extLWAdd,
    external_height: extHeight,
  };
}

const DIM_CONFIG_FIELDS = [
  { key: 'lengthMarginEachSide', label: 'Length margin / side (in)' },
  { key: 'widthMarginEachSide', label: 'Width margin / side (in)' },
  { key: 'heightMargin', label: 'Internal height margin (in)' },
  { key: 'kvExternalLWAdd', label: 'Kitchen/Vanity ext. L/W add (in)' },
  { key: 'kvExternalHeight', label: 'Kitchen/Vanity ext. height (in)' },
  { key: 'islandExternalLWAdd', label: 'Island ext. L/W add (in)' },
  { key: 'islandExternalHeight', label: 'Island ext. height (in)' },
];

const TABLE_COLUMNS = [
  { key: 'part_no', label: 'Part #' },
  { key: 'part', label: 'Part Type' },
  { key: 'category', label: 'Category' },
  { key: 'drawing', label: 'Drawing' },
  { key: 'unit', label: 'Unit' },
  { key: 'building', label: 'Building' },
  { key: 'floor', label: 'Floor' },
  { key: 'flat', label: 'Flat' },
  { key: 'length', label: 'Length (in)', numeric: true },
  { key: 'width', label: 'Width (in)', numeric: true },
  { key: 'qty', label: 'Qty', numeric: true },
  { key: 'sqft', label: 'Sq Ft', numeric: true },
  { key: 'weight_kg', label: 'Weight (kg)', numeric: true },
];

function crateFromParts(crateNo, parts, dimConfig) {
  return {
    crate_no: crateNo,
    parts,
    total_weight_kg: parts.reduce((s, p) => s + (p.weight_kg || 0), 0),
    total_sqft: parts.reduce((s, p) => s + (p.sqft || 0), 0),
    ...computeCrateDimensions(parts, dimConfig),
  };
}

function CrateRow({ crate, crateOptions, onMovePart, onDeleteCrate, expandedDefault = false }) {
  const [open, setOpen] = useState(expandedDefault);

  return (
    <div className="rounded-[20px] border border-[#dbe4f0] bg-white overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
        <span className="text-sm font-bold text-[#0f172a]">Crate #{crate.crate_no}</span>
        <span className="text-xs text-[#64748b]">{crate.parts.length} parts</span>
        <span className="text-sm font-semibold text-[#1e293b]">{fmt(crate.total_weight_kg)} kg</span>
        <span className="text-xs text-[#94a3b8]">{fmt(crate.total_sqft)} ft²</span>
        <span className="text-xs text-[#94a3b8]">
          Int {fmt(crate.internal_length)}×{fmt(crate.internal_width)}×{fmt(crate.internal_height)}″
        </span>
        <span className="text-xs text-[#94a3b8]">
          Ext {fmt(crate.external_length)}×{fmt(crate.external_width)}×{fmt(crate.external_height)}″
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-medium text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
          >
            {open ? 'Hide' : `Details (${crate.parts.length} parts)`}
          </button>
          <button
            type="button"
            onClick={() => onDeleteCrate(crate.crate_no)}
            className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            Delete crate
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#f1f5f9] max-h-96 overflow-y-auto overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f8fafc] text-[#64748b] uppercase tracking-wide text-[9px]">
                {TABLE_COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 py-2 text-left whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left whitespace-nowrap">Move to</th>
              </tr>
            </thead>
            <tbody>
              {crate.parts.map((p) => (
                <tr key={p.id} className="border-t border-[#f8fafc] hover:bg-[#f8fafc]">
                  {TABLE_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap text-[#334155] ${c.numeric ? 'text-right font-medium' : ''}`}>
                      {c.numeric ? fmt(p[c.key]) : (p[c.key] || '—')}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onMovePart(p.id, crate.crate_no, e.target.value);
                        e.target.value = '';
                      }}
                      className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[11px] text-[#475569]"
                    >
                      <option value="" disabled>Move…</option>
                      {crateOptions.filter((cn) => cn !== crate.crate_no).map((cn) => (
                        <option key={cn} value={cn}>Crate #{cn}</option>
                      ))}
                      <option value="__new__">+ New crate</option>
                      <option value="__remove__">↩ Remove (back to pool)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CrateFilterPlanner = ({ projectId }) => {
  const [allParts, setAllParts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [targetWeightKg, setTargetWeightKg] = useState(1900);
  const [dimConfig, setDimConfig] = useState(DEFAULT_DIM_CONFIG);

  // crates: array of { crate_no, parts: [...] } — local editable state.
  const [crates, setCrates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    axios
      .get(`${API_BASE}/projects/${projectId}/dispatch-parts`)
      .then((res) => setAllParts(res.data || []))
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to load parts'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Try to restore a saved manual crate plan once parts are loaded.
  useEffect(() => {
    if (!projectId || !allParts.length) return;
    axios
      .get(`${API_BASE}/projects/${projectId}/manual-crate-plan`)
      .then((res) => {
        const plan = res.data?.plan;
        if (!plan || !plan.crates?.length) return;
        const partsById = new Map(allParts.map((p) => [p.id, p]));
        const restored = plan.crates
          .map((c) => crateFromParts(c.crate_no, (c.part_ids || []).map((id) => partsById.get(id)).filter(Boolean), DEFAULT_DIM_CONFIG))
          .filter((c) => c.parts.length > 0);
        if (restored.length) {
          setCrates(restored);
          setTargetWeightKg(plan.target_weight_kg || 1900);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, allParts.length]);

  // Parts already sitting in a crate never come back through the filter pool —
  // to remove one, go into its specific crate and use "Remove (back to pool)".
  const allocatedIds = useMemo(() => {
    const s = new Set();
    for (const c of crates) for (const p of c.parts) s.add(p.id);
    return s;
  }, [crates]);

  const availableParts = useMemo(
    () => allParts.filter((p) => !allocatedIds.has(p.id)),
    [allParts, allocatedIds],
  );

  const filteredParts = useMemo(
    () => availableParts.filter((p) => partMatchesFilters(p, filters, null)),
    [availableParts, filters],
  );

  const setFilter = (key, values) => setFilters((f) => ({ ...f, [key]: values }));

  const handleAutoBucket = useCallback(() => {
    if (!filteredParts.length) return;
    const ordered = sortByBucketOrder(filteredParts);
    const batches = weightBatchParts(ordered, targetWeightKg);
    setCrates((prev) => {
      let nextNo = prev.length ? Math.max(...prev.map((c) => c.crate_no)) + 1 : 1;
      const added = batches.map((parts) => crateFromParts(nextNo++, parts, dimConfig));
      return [...prev, ...added];
    });
  }, [filteredParts, targetWeightKg, dimConfig]);

  const handleMovePart = useCallback((partId, fromCrateNo, toCrateNoRaw) => {
    setCrates((prev) => {
      const part = prev.find((c) => c.crate_no === fromCrateNo)?.parts.find((p) => p.id === partId);
      if (!part) return prev;

      // Removing sends the part back to the unallocated pool — just drop it.
      if (toCrateNoRaw === '__remove__') {
        return prev
          .map((c) => (c.crate_no === fromCrateNo ? crateFromParts(c.crate_no, c.parts.filter((p) => p.id !== partId), dimConfig) : c))
          .filter((c) => c.parts.length > 0);
      }

      const toCrateNo = toCrateNoRaw === '__new__' ? Math.max(...prev.map((c) => c.crate_no)) + 1 : Number(toCrateNoRaw);

      let next = prev.map((c) => {
        if (c.crate_no === fromCrateNo) {
          const parts = c.parts.filter((p) => p.id !== partId);
          return crateFromParts(c.crate_no, parts, dimConfig);
        }
        return c;
      });

      const targetExists = next.some((c) => c.crate_no === toCrateNo);
      next = targetExists
        ? next.map((c) => (c.crate_no === toCrateNo ? crateFromParts(toCrateNo, [...c.parts, part], dimConfig) : c))
        : [...next, crateFromParts(toCrateNo, [part], dimConfig)];

      // Drop emptied crates.
      return next.filter((c) => c.parts.length > 0).sort((a, b) => a.crate_no - b.crate_no);
    });
  }, [dimConfig]);

  const handleDeleteCrate = useCallback((crateNo) => {
    setCrates((prev) => prev.filter((c) => c.crate_no !== crateNo));
  }, []);

  const handleDeleteAll = useCallback(() => {
    if (!crates.length) return;
    if (!window.confirm('Delete all crates and return every part to the pool?')) return;
    setCrates([]);
  }, [crates.length]);

  const handleSave = useCallback(() => {
    setSaving(true);
    axios
      .post(`${API_BASE}/projects/${projectId}/manual-crate-plan`, {
        target_weight_kg: targetWeightKg,
        filters,
        crates: crates.map((c) => ({ crate_no: c.crate_no, part_ids: c.parts.map((p) => p.id) })),
      })
      .then((res) => setSavedAt(res.data?.saved_at))
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to save crate plan'))
      .finally(() => setSaving(false));
  }, [projectId, crates, targetWeightKg, filters]);

  const handleDownload = useCallback(() => {
    if (!crates.length) return;
    setExporting(true);
    axios
      .post(
        `${API_BASE}/projects/${projectId}/manual-crate-plan/export`,
        { crates: crates.map((c) => ({ ...c, part_ids: c.parts.map((p) => p.id) })) },
        { responseType: 'blob' },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const disposition = res.headers['content-disposition'] || '';
        const match = disposition.match(/filename="?([^";]+)"?/);
        const link = document.createElement('a');
        link.href = url;
        link.download = match ? match[1] : 'CratePlan.xlsx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to export crate plan'))
      .finally(() => setExporting(false));
  }, [projectId, crates]);

  const crateOptions = useMemo(() => crates.map((c) => c.crate_no), [crates]);

  const filteredTotals = useMemo(() => ({
    part_count: filteredParts.length,
    weight_kg: filteredParts.reduce((s, p) => s + (p.weight_kg || 0), 0),
    sqft: filteredParts.reduce((s, p) => s + (p.sqft || 0), 0),
  }), [filteredParts]);

  return (
    <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Crate Planning</div>
        <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Filter parts and build crates</div>
        <div className="mt-1 text-sm text-[#64748b]">
          Multi-select any combination of filters, then auto-bucket by target weight. Allocated parts drop out of the
          pool automatically — repeat with a new filter (e.g. Kitchen Islands, then Kitchen, then Vanity) to build the
          rest. Remove a part from a specific crate to send it back to the pool.
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading && (
        <div className="rounded-[24px] border border-[#dbe4f0] bg-white px-5 py-12 text-center text-sm text-[#94a3b8]">
          Loading parts…
        </div>
      )}

      {!loading && allParts.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {FILTER_DIMS.map((d) => (
              <MultiSelectDropdown
                key={d.key}
                label={d.label}
                options={facetOptions(availableParts, filters, d)}
                selected={filters[d.key]}
                onChange={(vals) => setFilter(d.key, vals)}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center rounded-[20px] border border-[#dbe4f0] bg-[#f8fafc] px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8] mr-1 self-center">In scope (unallocated)</span>
            {[
              { l: 'Parts', v: filteredTotals.part_count },
              { l: 'Weight', v: `${fmt(filteredTotals.weight_kg)} kg` },
              { l: 'Sq ft', v: fmt(filteredTotals.sqft) },
            ].map(({ l, v }) => (
              <span key={l} className="flex flex-col items-center rounded-xl border border-[#e8edf3] bg-white px-3 py-1.5 min-w-[64px] text-center">
                <span className="text-[9px] uppercase tracking-wide text-[#94a3b8] leading-none">{l}</span>
                <span className="mt-0.5 text-sm font-semibold text-[#0f172a] leading-tight">{v}</span>
              </span>
            ))}
            <span className="ml-2 text-xs text-[#94a3b8]">{allocatedIds.size} parts already allocated</span>
          </div>

          <div className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Crate dimension configuration (applies to new auto-bucket rounds)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {DIM_CONFIG_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col text-[10px] text-[#64748b]">
                  <span className="flex min-h-[28px] items-end">{f.label}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={dimConfig[f.key]}
                    onChange={(e) => setDimConfig((c) => ({ ...c, [f.key]: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-3">
            <TargetWeightControl value={targetWeightKg} onChange={setTargetWeightKg} />
            <button
              type="button"
              onClick={handleAutoBucket}
              disabled={!filteredParts.length}
              className="ml-auto rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e40af] disabled:opacity-50"
            >
              Auto-bucket into crates
            </button>
          </div>

          {crates.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  {crates.length} crate{crates.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  className="rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                >
                  Delete all crates
                </button>
              </div>
              <div className="space-y-3">
                {crates.map((c) => (
                  <CrateRow
                    key={c.crate_no}
                    crate={c}
                    crateOptions={crateOptions}
                    onMovePart={handleMovePart}
                    onDeleteCrate={handleDeleteCrate}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[#0f172a] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e293b] disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save Crate Plan'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={exporting}
                  className="rounded-full border border-[#0f172a] bg-white px-6 py-3 text-sm font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-60"
                >
                  {exporting ? 'Exporting…' : 'Download Excel (2 sheets)'}
                </button>
                {savedAt && <span className="text-xs text-[#64748b]">Saved {new Date(savedAt).toLocaleString()}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default CrateFilterPlanner;
