import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
// Editable by the employee before auto-bucketing, fully independent per crate
// class (Vanity/Kitchen vs Islands) — nothing is shared between the two.
// internal = raw part extents + margin (length/width each side, height total);
// external = internal + that class's own add-on for length/width, plus that
// class's own fixed external height.
const DEFAULT_CLASS_DIM_CONFIG = {
  lengthMargin: 0.5,
  widthMargin: 0.5,
  heightMargin: 2,
  extLengthAdd: 4,
  extWidthAdd: 4,
  extHeight: 7,
};

const DEFAULT_DIM_CONFIG = {
  kv: { ...DEFAULT_CLASS_DIM_CONFIG },
  island: { ...DEFAULT_CLASS_DIM_CONFIG, extHeight: 9 },
};

const THICKNESS_INCH = { '2CM': 0.79, '3CM': 1.18, '4CM': 1.57 };
function thicknessInches(t) {
  const key = String(t || '').trim().toUpperCase().replace(' ', '');
  return THICKNESS_INCH[key] ?? 1.18;
}

// Mirrors estimateHorizontalLayeredDimensions() in crateEstimator.js — the
// established packing model: bigger parts (tops) form one layer, back
// splashes another, side splashes another, stacked with a separator between
// each. A layer's height is its MAX piece thickness, not the sum of every
// piece in it — same-role parts sit side by side in the layer, not stacked
// on each other.
const LAYER_SEPARATOR_IN = 1.0;
function isBackSplashPart(p) {
  return /back.?splash/i.test(p.part || '');
}
function isSideSplashPart(p) {
  return /side.?splash/i.test(p.part || '');
}

function computeCrateDimensions(parts, dimConfig) {
  if (!parts.length) {
    return { internal_length: 0, internal_width: 0, internal_height: 0, external_length: 0, external_width: 0, external_height: 0 };
  }

  const isIsland = parts.some((p) => bucketOrderForPart(p) === 0);
  const cfg = isIsland ? dimConfig.island : dimConfig.kv;

  if (isIsland) {
    // Islands stand upright (cassette model) — a completely different axis
    // assignment than flat-lay kitchen/vanity crates: the piece's SHORT edge
    // becomes the crate's HEIGHT (it's standing on end), and thickness stacks
    // on the WIDTH/DEPTH axis (pieces lean side by side like books on a
    // shelf), not on height. Mirrors estimateLeanedCassetteDimensions() in
    // crateEstimator.js.
    let maxLongEdge = 0;
    let maxShortEdge = 0;
    for (const p of parts) {
      const L = p.length || 0;
      const W = p.width || 0;
      maxLongEdge = Math.max(maxLongEdge, Math.max(L, W));
      maxShortEdge = Math.max(maxShortEdge, L > 0 && W > 0 ? Math.min(L, W) : Math.max(L, W));
    }
    const stackDepth = parts.reduce((s, p) => s + thicknessInches(p.thickness) * (p.qty || 1), 0);

    const internal_length = maxLongEdge + cfg.lengthMargin * 2;
    const internal_width = stackDepth + cfg.widthMargin * 2;
    const internal_height = maxShortEdge + cfg.heightMargin;

    return {
      internal_length,
      internal_width,
      internal_height,
      external_length: internal_length + cfg.extLengthAdd,
      external_width: internal_width + cfg.extWidthAdd,
      external_height: internal_height + cfg.extHeight,
    };
  }

  // Kitchen/Vanity — flat-lay: length/width from footprint, height from
  // layered same-role groups (mirrors estimateHorizontalLayeredDimensions()).
  const rawLength = Math.max(...parts.map((p) => p.length || 0));
  const rawWidth = Math.max(...parts.map((p) => p.width || 0));

  const backSplash = parts.filter(isBackSplashPart);
  const sideSplash = parts.filter(isSideSplashPart);
  const mainTops = parts.filter((p) => !isBackSplashPart(p) && !isSideSplashPart(p));

  const mainH = mainTops.length ? Math.max(...mainTops.map((p) => thicknessInches(p.thickness))) : 0;
  const backH = backSplash.length ? Math.max(...backSplash.map((p) => thicknessInches(p.thickness))) : 0;
  const sideH = sideSplash.length ? Math.max(...sideSplash.map((p) => thicknessInches(p.thickness))) : 0;

  let stackedHeight = 0;
  if (mainH > 0) stackedHeight += mainH;
  if (backH > 0) stackedHeight += LAYER_SEPARATOR_IN + backH;
  if (sideH > 0) stackedHeight += LAYER_SEPARATOR_IN + sideH;

  const internal_length = rawLength + cfg.lengthMargin * 2;
  const internal_width = rawWidth + cfg.widthMargin * 2;
  const internal_height = stackedHeight + cfg.heightMargin;

  return {
    internal_length,
    internal_width,
    internal_height,
    external_length: internal_length + cfg.extLengthAdd,
    external_width: internal_width + cfg.extWidthAdd,
    external_height: internal_height + cfg.extHeight,
  };
}

const DIM_CLASS_SECTIONS = [
  { key: 'kv', label: 'Vanity / Kitchen' },
  { key: 'island', label: 'Islands' },
];

const DIM_CLASS_FIELDS = [
  { key: 'lengthMargin', label: 'Length — internal margin/side (in)' },
  { key: 'extLengthAdd', label: 'Length — external add (in)' },
  { key: 'widthMargin', label: 'Width — internal margin/side (in)' },
  { key: 'extWidthAdd', label: 'Width — external add (in)' },
  { key: 'heightMargin', label: 'Height — internal margin (in)' },
  { key: 'extHeight', label: 'Height — external add (in)' },
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

const CRATE_SUMMARY_COLUMNS = [
  { key: 'crate_no', label: 'Crate #' },
  { key: 'parts', label: 'Parts', numeric: true },
  { key: 'total_weight_kg', label: 'Weight (kg)', numeric: true },
  { key: 'total_sqft', label: 'Sq Ft', numeric: true },
  { key: 'internal_length', label: 'Int L', numeric: true },
  { key: 'internal_width', label: 'Int W', numeric: true },
  { key: 'internal_height', label: 'Int H', numeric: true },
  { key: 'external_length', label: 'Ext L', numeric: true },
  { key: 'external_width', label: 'Ext W', numeric: true },
  { key: 'external_height', label: 'Ext H', numeric: true },
];

// Excel-style summary — one row per crate, inline-scrolled (the container, not
// the page, scrolls), with View/Delete as inline links per row.
function CrateSummaryTable({ crates, onViewDetails, onDeleteCrate }) {
  return (
    <div className="rounded-[20px] border border-[#dbe4f0] bg-white overflow-hidden">
      <div className="max-h-[520px] overflow-y-auto overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#f8fafc] text-[#64748b] uppercase tracking-wide text-[10px]">
              {CRATE_SUMMARY_COLUMNS.map((c) => (
                <th key={c.key} className={`px-3 py-2 text-left whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-left whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {crates.map((c) => (
              <tr key={c.crate_no} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                <td className="px-3 py-2 whitespace-nowrap font-semibold text-[#0f172a]">#{c.crate_no}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#334155]">{c.parts.length}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-[#1e293b]">{fmt(c.total_weight_kg)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#334155]">{fmt(c.total_sqft)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.internal_length)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.internal_width)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.internal_height)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.external_length)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.external_width)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-[#64748b]">{fmt(c.external_height)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onViewDetails(c.crate_no)}
                    className="text-[#1d4ed8] font-medium hover:underline"
                  >
                    View details
                  </button>
                  <span className="mx-2 text-[#e2e8f0]">|</span>
                  <button
                    type="button"
                    onClick={() => onDeleteCrate(c.crate_no)}
                    className="text-red-600 font-medium hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Compact Excel-style column header filter — click the funnel to check/uncheck
// values; empty selection = show all (same convention as MultiSelectDropdown).
function ColumnFilterMenu({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const isAll = selected.length === 0;
  const active = !isAll;

  return (
    <span className="relative inline-block ml-1" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] ${active ? 'text-[#1d4ed8]' : 'text-[#94a3b8]'} hover:text-[#1d4ed8]`}
        title="Filter"
      >
        ▾
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-48 max-h-64 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg flex flex-col normal-case font-normal text-[11px]">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#f1f5f9]">
            <button type="button" className="text-blue-600 font-semibold" onClick={() => onChange([])}>All</button>
            <button
              type="button"
              className="text-[#94a3b8] font-semibold"
              onClick={() => onChange(options.length ? [`__nomatch__${Math.random()}`] : [])}
            >
              Clear
            </button>
          </div>
          <div className="overflow-y-auto p-1">
            {options.map((opt) => {
              const checked = isAll || selected.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#f8fafc] cursor-pointer text-[#334155]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (isAll) onChange(options.filter((o) => o !== opt));
                      else if (selected.includes(opt)) {
                        const next = selected.filter((v) => v !== opt);
                        onChange(next.length ? next : []);
                      } else onChange([...selected, opt]);
                    }}
                    className="rounded border-[#cbd5e1]"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

// Part-detail modal for a single crate — opened via "View details" in the
// summary table above. Each column header has an Excel-style filter.
function CrateDetailModal({ crate, crateOptions, onMovePart, onClose }) {
  const [columnFilters, setColumnFilters] = useState({});

  // Reset filters whenever a different crate is opened.
  useEffect(() => { setColumnFilters({}); }, [crate?.crate_no]);

  const matchesColumnFilters = useCallback((part, exceptKey) => {
    return TABLE_COLUMNS.every((c) => {
      if (c.key === exceptKey) return true;
      const sel = columnFilters[c.key] || [];
      if (!sel.length) return true;
      return sel.includes(String(part[c.key] ?? ''));
    });
  }, [columnFilters]);

  const columnOptions = useMemo(() => {
    if (!crate) return {};
    const out = {};
    for (const c of TABLE_COLUMNS) {
      const values = new Set();
      for (const p of crate.parts) {
        if (matchesColumnFilters(p, c.key)) values.add(String(p[c.key] ?? ''));
      }
      out[c.key] = [...values].sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
      });
    }
    return out;
  }, [crate, matchesColumnFilters]);

  const filteredParts = useMemo(
    () => (crate ? crate.parts.filter((p) => matchesColumnFilters(p, null)) : []),
    [crate, matchesColumnFilters],
  );

  if (!crate) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl max-h-[85vh] rounded-[20px] bg-white shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 px-5 py-4 border-b border-[#f1f5f9] flex-wrap">
          <span className="text-sm font-bold text-[#0f172a]">Crate #{crate.crate_no}</span>
          <span className="text-xs text-[#64748b]">
            {filteredParts.length === crate.parts.length ? `${crate.parts.length} parts` : `${filteredParts.length} of ${crate.parts.length} parts`}
          </span>
          <span className="text-sm font-semibold text-[#1e293b]">{fmt(crate.total_weight_kg)} kg</span>
          <span className="text-xs text-[#94a3b8]">{fmt(crate.total_sqft)} ft²</span>
          <span className="text-xs text-[#94a3b8]">
            Int {fmt(crate.internal_length)}×{fmt(crate.internal_width)}×{fmt(crate.internal_height)}″
          </span>
          <span className="text-xs text-[#94a3b8]">
            Ext {fmt(crate.external_length)}×{fmt(crate.external_width)}×{fmt(crate.external_height)}″
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-medium text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto overflow-x-auto flex-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f8fafc] text-[#64748b] uppercase tracking-wide text-[9px]">
                {TABLE_COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 py-2 text-left whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                    {c.label}
                    <ColumnFilterMenu
                      options={columnOptions[c.key] || []}
                      selected={columnFilters[c.key] || []}
                      onChange={(vals) => setColumnFilters((f) => ({ ...f, [c.key]: vals }))}
                    />
                  </th>
                ))}
                <th className="px-3 py-2 text-left whitespace-nowrap">Move to</th>
              </tr>
            </thead>
            <tbody>
              {filteredParts.map((p) => (
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
      </div>
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
  const [detailCrateNo, setDetailCrateNo] = useState(null);
  // Process labels load incrementally — a small batch renders immediately,
  // more batches fetch as the user scrolls, instead of blocking on every
  // page for the whole (possibly thousands-of-parts) project up front.
  const LABEL_BATCH_SIZE = 30;
  const [generatingLabels, setGeneratingLabels] = useState(false);
  const [labelBatches, setLabelBatches] = useState([]); // [{ url, count }]
  const [labelsTotalParts, setLabelsTotalParts] = useState(0);
  const [loadingMoreLabels, setLoadingMoreLabels] = useState(false);
  const [exportingLabels, setExportingLabels] = useState(false);
  const [exportElapsedSec, setExportElapsedSec] = useState(0);

  // Revoke every batch blob URL when the component unmounts.
  useEffect(() => () => { labelBatches.forEach((b) => window.URL.revokeObjectURL(b.url)); }, [labelBatches]);

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

  // Editing the dimension config must reflect immediately on every crate already
  // built, not just future auto-bucket rounds — recompute all of them in place.
  useEffect(() => {
    setCrates((prev) => prev.map((c) => crateFromParts(c.crate_no, c.parts, dimConfig)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimConfig]);

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

  const crateSpecs = useMemo(
    () => crates.map((c) => ({ crate_no: c.crate_no, part_ids: c.parts.map((p) => p.id) })),
    [crates],
  );

  const fetchLabelBatch = useCallback((offset) => {
    return axios
      .post(
        `${API_BASE}/projects/${projectId}/process-labels/export`,
        { crates: crateSpecs, offset, limit: LABEL_BATCH_SIZE },
        { responseType: 'blob' },
      )
      .then((res) => {
        const total = Number(res.headers['x-total-parts'] || 0);
        const returned = Number(res.headers['x-returned-parts'] || 0);
        const url = window.URL.createObjectURL(res.data);
        setLabelsTotalParts(total);
        setLabelBatches((prev) => [...prev, { url, count: returned }]);
      });
  }, [projectId, crateSpecs]);

  const handleGenerateLabels = useCallback(() => {
    if (!crates.length) return;
    labelBatches.forEach((b) => window.URL.revokeObjectURL(b.url));
    setLabelBatches([]);
    setLabelsTotalParts(0);
    setGeneratingLabels(true);
    fetchLabelBatch(0)
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to generate process labels'))
      .finally(() => setGeneratingLabels(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crates.length, fetchLabelBatch]);

  const labelsLoadedCount = useMemo(() => labelBatches.reduce((s, b) => s + b.count, 0), [labelBatches]);

  // "Load more" is an explicit button, not scroll-triggered — each batch is
  // its own embedded PDF viewer with its own internal scrollbar, which
  // captures mouse-wheel input before it ever reaches the outer container,
  // so a scroll-into-view sentinel below the iframe is unreachable by
  // scrolling over it. A button sidesteps that entirely.
  const handleLoadMoreLabels = useCallback(() => {
    if (loadingMoreLabels || labelsLoadedCount >= labelsTotalParts) return;
    setLoadingMoreLabels(true);
    fetchLabelBatch(labelsLoadedCount)
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to load more labels'))
      .finally(() => setLoadingMoreLabels(false));
  }, [loadingMoreLabels, labelsLoadedCount, labelsTotalParts, fetchLabelBatch]);

  const handleDownloadLabels = useCallback(() => {
    if (!crates.length) return;
    setExportingLabels(true);
    setExportElapsedSec(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setExportElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    axios
      .post(
        `${API_BASE}/projects/${projectId}/process-labels/export`,
        { crates: crateSpecs },
        { responseType: 'blob' },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ProcessLabels.pdf';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Failed to download process labels'))
      .finally(() => window.clearInterval(timer))
      .finally(() => setExportingLabels(false));
  }, [projectId, crates.length, crateSpecs]);

  const crateOptions = useMemo(() => crates.map((c) => c.crate_no), [crates]);
  const detailCrate = useMemo(() => crates.find((c) => c.crate_no === detailCrateNo) || null, [crates, detailCrateNo]);

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

          <div className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-3 space-y-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Crate dimension configuration — changes apply immediately to every crate below, and to new auto-bucket rounds
            </div>
            {DIM_CLASS_SECTIONS.map((section) => (
              <div key={section.key} className="space-y-2">
                <div className="text-[11px] font-semibold text-[#334155]">{section.label}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {DIM_CLASS_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col text-[10px] text-[#64748b]">
                      <span className="flex min-h-[28px] items-end">{f.label}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={dimConfig[section.key][f.key]}
                        onChange={(e) =>
                          setDimConfig((c) => ({
                            ...c,
                            [section.key]: { ...c[section.key], [f.key]: Number(e.target.value) },
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
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
              <CrateSummaryTable
                crates={crates}
                onViewDetails={setDetailCrateNo}
                onDeleteCrate={handleDeleteCrate}
              />
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

              {savedAt && (
                <div className="rounded-[16px] border border-[#dbe4f0] bg-[#f8fafc] px-4 py-4 space-y-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Next: process labels</div>
                    <div className="mt-1 text-sm text-[#475569]">
                      One process label per part, for every part currently in a crate — the fabrication reference sheet to print and stick on each piece.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleGenerateLabels}
                      disabled={generatingLabels}
                      className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e40af] disabled:opacity-50"
                    >
                      {generatingLabels ? 'Loading first labels…' : 'Preview process labels'}
                    </button>
                    {labelBatches.length > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadLabels}
                        disabled={exportingLabels}
                        className="rounded-full border border-[#0f172a] bg-white px-5 py-2 text-sm font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-50"
                      >
                        {exportingLabels ? `Generating all ${labelsTotalParts}… (${exportElapsedSec}s)` : `Download PDF (all ${labelsTotalParts})`}
                      </button>
                    )}
                    {exportingLabels && (
                      <span className="text-xs text-[#94a3b8]">
                        Large projects can take several minutes — keep this tab open.
                      </span>
                    )}
                    {labelBatches.length > 0 && (
                      <span className="text-xs text-[#94a3b8]">
                        Showing {labelsLoadedCount} of {labelsTotalParts} labels
                      </span>
                    )}
                  </div>
                  {labelBatches.length > 0 && (
                    <div className="rounded-[12px] border border-[#e2e8f0] overflow-hidden" style={{ height: 600 }}>
                      <div className="overflow-y-auto h-full">
                        {labelBatches.map((b, i) => (
                          <iframe
                            key={b.url}
                            title={`Process labels preview batch ${i + 1}`}
                            src={b.url}
                            style={{ width: '100%', height: 500, border: 'none', display: 'block' }}
                          />
                        ))}
                        {labelsLoadedCount < labelsTotalParts && (
                          <div className="py-4 flex justify-center">
                            <button
                              type="button"
                              onClick={handleLoadMoreLabels}
                              disabled={loadingMoreLabels}
                              className="rounded-full border border-[#0f172a] bg-white px-5 py-2 text-xs font-semibold text-[#0f172a] shadow-sm transition-all hover:bg-[#f1f5f9] disabled:opacity-50"
                            >
                              {loadingMoreLabels ? 'Loading…' : `Load ${Math.min(LABEL_BATCH_SIZE, labelsTotalParts - labelsLoadedCount)} more`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <CrateDetailModal
        crate={detailCrate}
        crateOptions={crateOptions}
        onMovePart={handleMovePart}
        onClose={() => setDetailCrateNo(null)}
      />
    </div>
  );
};

export default CrateFilterPlanner;
