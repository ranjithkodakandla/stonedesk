import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { usePlannerStore } from '../store/plannerStore';
import { API_BASE, bundleRowKey, formatNumber } from '../utils/plannerUtils';

// ── Category metadata ─────────────────────────────────────────────────────────
const CATEGORY_META = {
  island:    { label: 'Island',      minKg: 1400, maxKg: 2200, idealLo: 1800, idealHi: 2000, dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700 border-blue-200' },
  perimeter: { label: 'Perimeter',   minKg: 1400, maxKg: 2200, idealLo: 1800, idealHi: 2000, dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  range:     { label: 'Range Top',   minKg: 800,  maxKg: 1800, idealLo: 1200, idealHi: 1500, dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  vanity:    { label: 'Vanity',      minKg: 700,  maxKg: 1600, idealLo: 1000, idealHi: 1300, dot: 'bg-violet-500',  badge: 'bg-violet-100 text-violet-700 border-violet-200' },
  misc:      { label: 'Misc',        minKg: 400,  maxKg: 1200, idealLo: 600,  idealHi: 1000, dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const CRATE_TYPES = [
  { key: 'island',    label: 'Island',                    packing_family: 'island',    max_weight: 2200, idealLo: 1800, idealHi: 2000 },
  { key: 'perimeter', label: 'Perimeter Kitchen',         packing_family: 'perimeter', max_weight: 2200, idealLo: 1800, idealHi: 2000 },
  { key: 'range',     label: 'Range Top',                 packing_family: 'range',     max_weight: 1800, idealLo: 1200, idealHi: 1500 },
  { key: 'vanity',    label: 'Vanity',                    packing_family: 'vanity',    max_weight: 1600, idealLo: 1000, idealHi: 1300 },
  { key: 'mixed_pr',  label: 'Mixed (Perimeter + Range)', packing_family: 'mixed_pr',  max_weight: 2200, idealLo: 1800, idealHi: 2000 },
];

// ── FIX 3: Explicit compatibility matrix ─────────────────────────────────────
// Allowed sets (as sorted join of category names):
//   island            — island only
//   perimeter         — perimeter only
//   perimeter|range   — ONLY allowed cross-category mix
//   range             — range only
//   vanity            — vanity only
//   misc              — misc only
// Everything else is blocked deterministically.
const ALLOWED_CAT_KEYS = new Set([
  'island',
  'misc',
  'perimeter',
  'perimeter|range',
  'range',
  'vanity',
]);

function getBlockReason(existingCats, incomingCats) {
  const combined = [...new Set([...existingCats, ...incomingCats])].filter(Boolean);
  if (combined.length === 0) return null;
  const key = [...new Set(combined)].sort().join('|');
  if (ALLOWED_CAT_KEYS.has(key)) return null;

  // Specific actionable messages
  if (key.includes('island') && key !== 'island')
    return 'Island cannot be mixed with any other category.';
  if (key.includes('vanity') && key !== 'vanity')
    return 'Vanity cannot be mixed with any other category.';
  if ((key.includes('perimeter') || key.includes('range')) && key.includes('misc'))
    return 'Misc pieces must be packed separately from kitchen/range pieces.';
  return `Incompatible mix: ${[...new Set(combined)].map(c => CATEGORY_META[c]?.label || c).join(' + ')}. Only Perimeter + Range may be combined.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function weightBandLabel(kg, meta) {
  if (!meta || kg === 0) return '—';
  if (kg < meta.minKg)  return 'Underweight';
  if (kg > meta.maxKg)  return 'Overweight';
  if (kg >= meta.idealLo && kg <= meta.idealHi) return 'Ideal ✓';
  return kg < meta.idealLo ? 'Below Ideal' : 'Above Ideal';
}
function weightBandCls(kg, meta) {
  if (!meta || kg === 0) return 'text-slate-400';
  if (kg < meta.minKg || kg > meta.maxKg) return 'text-rose-600 font-semibold';
  if (kg >= meta.idealLo && kg <= meta.idealHi) return 'text-emerald-600 font-semibold';
  return 'text-amber-600 font-semibold';
}
function locLabel(f) {
  return [f.building && `B${f.building}`, f.floor && `F${f.floor}`, f.flat || null]
    .filter(Boolean).join(' / ') || f.flat_key || '—';
}

const CategoryBadge = ({ category }) => {
  const meta = CATEGORY_META[category] || CATEGORY_META.misc;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
};

// ── FIX 1: Batch Summary Panel ────────────────────────────────────────────────
const BatchSummaryPanel = ({ families, crateRows }) => {
  const summary = useMemo(() => {
    const buildings = new Set(families.map(f => f.building).filter(Boolean));
    const floors    = new Set(families.map(f => [f.building, f.floor].filter(Boolean).join('/')).filter(Boolean));
    const flats     = new Set(families.map(f => f.flat_key));
    const pieces    = families.reduce((s, f) => s + f.total_pieces, 0);
    const weight    = families.reduce((s, f) => s + f.total_weight_kg, 0);
    const assigned  = families.filter(f => f.current_crate_db_id).length;
    const status    = families.length === 0   ? 'No data'
                    : assigned === 0           ? 'Not Started'
                    : assigned === families.length ? 'Complete'
                    : `In Progress (${assigned}/${families.length})`;
    const statusCls = assigned === families.length && families.length > 0 ? 'text-emerald-600' :
                      assigned > 0 ? 'text-amber-600' : 'text-slate-400';
    return { buildings: buildings.size, floors: floors.size, flats: flats.size,
             totalFamilies: families.length, pieces, weight: Math.round(weight),
             crates: crateRows.length, assigned, status, statusCls };
  }, [families, crateRows]);

  const kpis = [
    { label: 'Buildings',  value: summary.buildings },
    { label: 'Floors',     value: summary.floors },
    { label: 'Flats',      value: summary.flats },
    { label: 'Families',   value: summary.totalFamilies },
    { label: 'Pieces',     value: summary.pieces },
    { label: 'Weight',     value: `${summary.weight.toLocaleString()} kg` },
    { label: 'Crates',     value: summary.crates },
    { label: 'Status',     value: summary.status, cls: summary.statusCls },
  ];

  return (
    <div className="rounded-[28px] border border-[#dbe4f0] bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Dispatch Batch</div>
          <div className="text-lg font-semibold text-[#0f172a]">Batch Overview</div>
        </div>
      </div>
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-3">
        {kpis.map(({ label, value, cls }) => (
          <div key={label} className="rounded-2xl bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2 text-center">
            <div className={`text-sm font-bold ${cls || 'text-[#0f172a]'}`}>{value}</div>
            <div className="text-[10px] text-[#94a3b8] uppercase tracking-wide mt-0.5">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── FIX 2: Pinned Group Card ──────────────────────────────────────────────────
const PinnedGroupCard = ({ group, families, selected, onToggleGroup, onUnpin }) => {
  const [expanded, setExpanded] = useState(false);
  const groupFamilies = families.filter(f => group.familyIds.includes(bundleRowKey(f)));
  const allSelected   = group.familyIds.every(fid => selected.has(fid));
  const anySelected   = group.familyIds.some(fid => selected.has(fid));
  const totalWeight   = groupFamilies.reduce((s, f) => s + f.total_weight_kg, 0);
  const cats          = [...new Set(groupFamilies.map(f => f.category))];
  const crateLabel    = groupFamilies[0]?.current_crate_label || null;
  const allAssigned   = groupFamilies.every(f => f.current_crate_db_id);
  const allSameCrate  = groupFamilies.length > 0 && groupFamilies.every(f => f.current_crate_db_id === groupFamilies[0].current_crate_db_id);

  return (
    <div className={`rounded-[18px] border transition-all ${
      allSelected ? 'border-orange-400 bg-orange-50 shadow-[0_0_0_2px_rgba(251,146,60,0.15)]' :
      anySelected ? 'border-orange-300 bg-orange-50/50' :
      'border-orange-200 bg-[#fff7ed]'
    }`}>
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={() => onToggleGroup(group.id)}>
        <input type="checkbox" checked={allSelected} onChange={() => onToggleGroup(group.id)}
          onClick={e => e.stopPropagation()} className="accent-orange-500 shrink-0 mt-0.5" />
        <span className="text-[11px]">📌</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-[#0f172a]">{group.label}</span>
            <span className="rounded-full bg-orange-100 border border-orange-200 px-1.5 text-[10px] text-orange-700 font-semibold">
              {group.familyIds.length} families
            </span>
            {cats.map(c => <CategoryBadge key={c} category={c} />)}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[#64748b]">
            <span className="font-semibold text-[#475569]">{Math.round(totalWeight)} kg</span>
            {allSameCrate && crateLabel ? (
              <span className="rounded bg-[#f1f5f9] px-1.5 text-[#475569]">{crateLabel}</span>
            ) : allAssigned ? (
              <span className="text-amber-600">Split across crates</span>
            ) : (
              <span className="text-amber-600">Not fully assigned</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={e => { e.stopPropagation(); onUnpin(group.id); }}
            className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600 hover:bg-rose-100 transition-colors">
            Unpin
          </button>
          <button type="button" onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
            className="rounded-full p-1 text-[#94a3b8] hover:bg-orange-100 text-[10px]">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 border-t border-orange-100 space-y-1 pt-2">
          {groupFamilies.map(f => (
            <div key={bundleRowKey(f)} className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#0f172a]">{locLabel(f)}</span>
              <span className="text-[#64748b]">{f.family_id}</span>
              <span className="text-[#64748b]">{f.total_weight_kg} kg</span>
              {f.current_crate_label
                ? <span className="rounded bg-[#f1f5f9] px-1.5 text-[#475569]">{f.current_crate_label}</span>
                : <span className="text-amber-600">Unassigned</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Family Card ───────────────────────────────────────────────────────────────
const FamilyCard = ({ family, selected, onToggle, onDragStart, onDragEnd, isPinned, pinLabel }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[family.category] || CATEGORY_META.misc;
  const loc  = locLabel(family);
  const pct  = Math.min(100, meta.maxKg > 0 ? (family.total_weight_kg / meta.maxKg) * 100 : 0);
  const idealPctLo = (meta.idealLo / meta.maxKg) * 100;
  const idealPctHi = (meta.idealHi / meta.maxKg) * 100;
  const barCls =
    family.total_weight_kg > meta.maxKg ? 'bg-rose-500' :
    family.total_weight_kg >= meta.idealLo ? 'bg-emerald-500' : 'bg-amber-400';

  return (
    <div draggable onDragStart={() => onDragStart(family)} onDragEnd={onDragEnd}
      className={`rounded-[18px] border transition-all select-none ${
        selected
          ? 'border-blue-400 bg-blue-50 shadow-[0_0_0_2px_rgba(59,130,246,0.15)]'
          : family.current_crate_db_id
          ? 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white'
          : 'border-dashed border-[#cbd5e1] bg-white hover:border-blue-300'
      }`}
    >
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2 cursor-pointer" onClick={() => onToggle(bundleRowKey(family))}>
        <input type="checkbox" checked={selected} onChange={() => onToggle(bundleRowKey(family))}
          onClick={e => e.stopPropagation()} className="mt-0.5 accent-blue-600 shrink-0" />
        <div className="min-w-0 flex-1">
          {/* Location — primary, large */}
          <div className="text-sm font-bold text-[#0f172a] leading-tight">{loc}</div>
          {/* Family ID + badges */}
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-[#475569] font-medium">{family.family_id}</span>
            <CategoryBadge category={family.category} />
            {isPinned && (
              <span className="rounded-full bg-orange-100 border border-orange-200 px-1.5 text-[10px] text-orange-700 font-semibold">
                📌 {pinLabel}
              </span>
            )}
            {family.is_split && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[10px] text-rose-600">Split</span>
            )}
          </div>
          {/* Weight bar */}
          <div className="mt-1.5 relative h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className="absolute h-full bg-emerald-100" style={{ left: `${idealPctLo}%`, width: `${idealPctHi - idealPctLo}%` }} />
            <div className={`absolute h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
          </div>
          {/* Stats row */}
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className={weightBandCls(family.total_weight_kg, meta)}>{family.total_weight_kg} kg</span>
            <span className="text-[#64748b]">
              {family.total_pieces} pcs{family.splash_count > 0 && ` (${family.main_count}M+${family.splash_count}S)`}
            </span>
            {family.current_crate_label
              ? <span className="rounded bg-[#f1f5f9] px-1.5 text-[#475569]">{family.current_crate_label}</span>
              : <span className="text-amber-600 font-medium">Unassigned</span>}
          </div>
        </div>
        {/* Expand parts toggle */}
        <button type="button" onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          className="shrink-0 mt-0.5 rounded-full p-1 text-[#94a3b8] hover:bg-[#e2e8f0] transition-colors text-[10px]">
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {/* Expanded part numbers */}
      {expanded && (
        <div className="px-4 pb-2.5 border-t border-[#f1f5f9] space-y-1 pt-2 text-[11px]">
          {family.main_part_nos?.length > 0 && (
            <div>
              <span className="text-[#94a3b8] uppercase tracking-wide text-[10px]">Main: </span>
              {family.main_part_nos.map(pn => (
                <span key={pn} className="mr-1.5 font-mono font-medium text-[#0f172a]">{pn || '—'}</span>
              ))}
            </div>
          )}
          {family.splash_part_nos?.length > 0 && (
            <div>
              <span className="text-[#94a3b8] uppercase tracking-wide text-[10px]">Splashes: </span>
              {family.splash_part_nos.map(pn => (
                <span key={pn} className="mr-1.5 font-mono font-medium text-violet-700">{pn || '—'}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Create Empty Crate modal ──────────────────────────────────────────────────
const CreateCrateModal = ({ onClose, onCreated }) => {
  const createCustomCrate = usePlannerStore(s => s.createCustomCrate);
  const [selectedType, setSelectedType] = useState(CRATE_TYPES[1]);
  const [creating, setCreating]         = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createCustomCrate({
        name: `${selectedType.label} — manual`,
        packing_family: selectedType.packing_family,
        max_weight: selectedType.max_weight,
        locked: false,
        custom: true,
      });
      onCreated();
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-[28px] border border-[#dbe4f0] shadow-2xl p-6 w-[360px]">
        <div className="text-lg font-semibold text-[#0f172a] mb-1">Create Empty Crate</div>
        <div className="text-xs text-[#64748b] mb-5">Choose a type, then assign families manually.</div>
        <div className="space-y-2 mb-5">
          {CRATE_TYPES.map(t => {
            const meta = CATEGORY_META[t.packing_family] || CATEGORY_META.misc;
            const isSelected = selectedType.key === t.key;
            return (
              <button key={t.key} type="button" onClick={() => setSelectedType(t)}
                className={`w-full rounded-[18px] border px-4 py-3 text-left transition-all ${
                  isSelected ? 'border-blue-400 bg-blue-50' : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[#0f172a]">{t.label}</span>
                  {t.packing_family !== 'mixed_pr' && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-[#64748b]">
                  Max {t.max_weight} kg · Ideal {t.idealLo}–{t.idealHi} kg
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleCreate} disabled={creating}
            className="flex-1 rounded-full bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {creating ? 'Creating…' : 'Create Crate'}
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 rounded-full border border-[#e2e8f0] py-2 text-sm text-[#475569] hover:bg-[#f8fafc]">
            Cancel
          </button>
        </div>
      </div>
    </>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const FamilyBuilderPanel = () => {
  const projectId    = usePlannerStore(s => s.projectId);
  const crateRows = usePlannerStore((s) => {
    const ic = s.insights?.crates;
    if (Array.isArray(ic) && ic.length > 0) return ic;
    const raw = s.crates || [];
    return raw.map((c) => {
      const stone = Number(c.weight) || 0;
      const gw = Number(c.gross_weight);
      const tw = Number(c.tare_weight) || 0;
      const gross = stone > 0 ? stone + tw : (Number.isFinite(gw) && gw > 0 ? gw : stone);
      const mx = Number(c.max_weight) || 0;
      const fill = mx > 0 && stone > 0 ? Math.min(100, (stone / mx) * 100) : Number(c.fill_percent) || 0;
      return {
        ...c,
        gross_weight: gross,
        fill_percent: fill,
      };
    });
  });
  const isRefreshing = usePlannerStore(s => s.isRefreshing);
  const assignFamily = usePlannerStore(s => s.assignFamily);

  const [families, setFamilies]               = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [selected, setSelected]               = useState(new Set());
  const [targetCrateId, setTargetCrateId]     = useState(null);
  const [filterStatus, setFilterStatus]       = useState('all');
  const [filterCategory, setFilterCategory]   = useState('all');
  const [flatSearch, setFlatSearch]           = useState('');
  const [dragFamily, setDragFamily]           = useState(null);
  const [assigning, setAssigning]             = useState(false);
  const [blockError, setBlockError]           = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // ── FIX 2: Pin groups — client-side only ──
  const [pinGroups, setPinGroups] = useState([]);

  // bundle row key (unit_id / family_ui_key) → pin group id
  const familyToPinGroup = useMemo(() => {
    const map = {};
    pinGroups.forEach(pg => pg.familyIds.forEach(fid => { map[fid] = pg.id; }));
    return map;
  }, [pinGroups]);

  const loadFamilies = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/projects/${projectId}/families`);
      setFamilies(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRefreshing) loadFamilies();
  }, [projectId, isRefreshing]);  // eslint-disable-line

  useEffect(() => {
    if (targetCrateId && !crateRows.some(c => c.id === targetCrateId)) {
      setTargetCrateId(crateRows[0]?.id || null);
    }
    if (!targetCrateId && crateRows.length > 0) setTargetCrateId(crateRows[0].id);
  }, [crateRows]);  // eslint-disable-line

  // ── Filtering ──
  const pinnedFamilyIds = useMemo(() => new Set(pinGroups.flatMap(pg => pg.familyIds)), [pinGroups]);

  const filtered = useMemo(() => {
    const q = flatSearch.trim().toLowerCase();
    return families.filter(f => {
      if (pinnedFamilyIds.has(bundleRowKey(f))) return false; // pinned shown separately
      if (filterStatus === 'unassigned' && f.current_crate_db_id) return false;
      if (filterStatus === 'assigned'   && !f.current_crate_db_id) return false;
      if (filterCategory !== 'all' && f.category !== filterCategory) return false;
      if (q) {
        const loc = [f.building, f.floor, f.flat].filter(Boolean).join(' ').toLowerCase();
        const idHay = `${f.family_id || ''} ${f.unit_id || ''} ${f.family_ui_key || ''}`.toLowerCase();
        if (!loc.includes(q) && !idHay.includes(q)) return false;
      }
      return true;
    });
  }, [families, filterStatus, filterCategory, flatSearch, pinnedFamilyIds]);

  const selectedFamilies = useMemo(() => families.filter(f => selected.has(bundleRowKey(f))), [families, selected]);

  // ── Target crate ──
  const targetCrate      = crateRows.find(c => c.id === targetCrateId) || null;
  const familiesInTarget = useMemo(() => families.filter(f => f.current_crate_db_id === targetCrateId), [families, targetCrateId]);

  const targetCatMeta = useMemo(() => {
    if (!targetCrate) return null;
    const pf = targetCrate.packing_family;
    if (pf === 'mixed_pr') return { label: 'Mixed (Perim+Range)', minKg: 1400, maxKg: 2200, idealLo: 1800, idealHi: 2000 };
    return CATEGORY_META[pf] || null;
  }, [targetCrate]);

  const addedWeight   = useMemo(() =>
    selectedFamilies.filter(f => f.current_crate_db_id !== targetCrateId).reduce((s, f) => s + f.total_weight_kg, 0),
    [selectedFamilies, targetCrateId]
  );
  const previewWeight = (targetCrate?.gross_weight || 0) + addedWeight;
  const incomingCats  = selectedFamilies.filter(f => f.current_crate_db_id !== targetCrateId).map(f => f.category);
  const existingCats  = familiesInTarget.map(f => f.category);

  // ── Pin operations ──
  const pinSelected = () => {
    if (selected.size < 2) return;
    const familyIds = [...selected].filter(fid => families.some(f => bundleRowKey(f) === fid));
    // Remove these family IDs from any existing pin groups (clean up)
    const cleaned = pinGroups
      .map(pg => ({ ...pg, familyIds: pg.familyIds.filter(fid => !familyIds.includes(fid)) }))
      .filter(pg => pg.familyIds.length >= 1);
    const label = `Group ${pinGroups.length + 1}`;
    setPinGroups([...cleaned, { id: `pin_${Date.now()}`, familyIds, label }]);
    setSelected(new Set());
    setBlockError(null);
  };

  const unpinGroup = (groupId) => {
    setPinGroups(prev => prev.filter(pg => pg.id !== groupId));
  };

  const togglePinGroup = (groupId) => {
    const pg = pinGroups.find(p => p.id === groupId);
    if (!pg) return;
    const allSel = pg.familyIds.every(fid => selected.has(fid));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSel) pg.familyIds.forEach(fid => next.delete(fid));
      else pg.familyIds.forEach(fid => next.add(fid));
      return next;
    });
    setBlockError(null);
  };

  // Expand selected with their pin-group companions
  const expandWithPins = (baseFamilies) => {
    const expanded = new Set(baseFamilies.map(f => bundleRowKey(f)));
    baseFamilies.forEach(f => {
      const pgId = familyToPinGroup[bundleRowKey(f)];
      if (pgId) {
        const pg = pinGroups.find(p => p.id === pgId);
        if (pg) pg.familyIds.forEach(fid => expanded.add(fid));
      }
    });
    return families.filter(f => expanded.has(bundleRowKey(f)));
  };

  // ── Validation helper ──
  const validateForCrate = (famiesToAssign, crateId) => {
    const targetFams = families.filter(f => f.current_crate_db_id === crateId);
    const eCats = targetFams.map(f => f.category);
    const nCats = famiesToAssign.filter(f => f.current_crate_db_id !== crateId).map(f => f.category);
    return getBlockReason(eCats, nCats);
  };

  // ── Actions ──
  const toggleFamily = (familyId) => {
    setBlockError(null);
    setSelected(prev => {
      const next = new Set(prev);
      next.has(familyId) ? next.delete(familyId) : next.add(familyId);
      return next;
    });
  };

  const toggleAll = () => {
    setBlockError(null);
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(f => bundleRowKey(f))));
  };

  const doAssign = async (crateId) => {
    if (selectedFamilies.length === 0) return;
    const batch = expandWithPins(selectedFamilies);
    const reason = validateForCrate(batch, crateId);
    if (reason) { setBlockError(reason); return; }
    setBlockError(null);
    setAssigning(true);
    try {
      for (const fam of batch) await assignFamily(fam.all_piece_ids, crateId);
      setSelected(new Set());
    } finally {
      setAssigning(false);
    }
  };

  const doUnassign = async () => {
    if (selectedFamilies.length === 0) return;
    const batch = expandWithPins(selectedFamilies);
    setBlockError(null);
    setAssigning(true);
    try {
      for (const fam of batch) await assignFamily(fam.all_piece_ids, null);
      setSelected(new Set());
    } finally {
      setAssigning(false);
    }
  };

  const handleDrop = async (crateId) => {
    if (!dragFamily) return;
    const reason = getBlockReason(
      families.filter(f => f.current_crate_db_id === crateId).map(f => f.category),
      [dragFamily.category]
    );
    if (reason) { setBlockError(reason); setDragFamily(null); return; }
    setBlockError(null);
    setAssigning(true);
    try {
      await assignFamily(dragFamily.all_piece_ids, crateId);
    } finally {
      setDragFamily(null);
      setAssigning(false);
    }
  };

  const categories = [...new Set(families.map(f => f.category))];

  return (
    <div className="space-y-5">

      {/* FIX 1 — Dispatch Batch Summary */}
      <BatchSummaryPanel families={families} crateRows={crateRows} />

      {/* Main two-column grid */}
      <div className="grid xl:grid-cols-[1fr,0.55fr] gap-5">

        {/* ── LEFT: Family list ── */}
        <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm flex flex-col gap-4">
          <div className="shrink-0 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Family Builder</div>
              <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Available Families</div>
              <div className="mt-0.5 text-xs text-[#64748b]">
                {families.length} families · {families.filter(f => !f.current_crate_db_id).length} unassigned
              </div>
            </div>
            <button type="button" onClick={() => setShowCreateModal(true)}
              className="shrink-0 rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
              + Create Empty Crate
            </button>
          </div>

          {/* Filters */}
          <div className="shrink-0 flex flex-wrap gap-2">
            {['all', 'unassigned', 'assigned'].map(s => (
              <button key={s} type="button" onClick={() => setFilterStatus(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  filterStatus === s ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-[#e2e8f0] text-[#475569] hover:bg-[#f8fafc]'
                }`}>{s}</button>
            ))}
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#475569] bg-white focus:outline-none">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{CATEGORY_META[c]?.label || c}</option>)}
            </select>
            <input type="text" value={flatSearch} onChange={e => setFlatSearch(e.target.value)}
              placeholder="Search building / floor / flat…"
              className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#334155] bg-white focus:outline-none w-44" />
          </div>

          {/* Bulk actions + pin button */}
          {(filtered.length > 0 || selected.size > 0) && (
            <div className="shrink-0 flex items-center justify-between flex-wrap gap-2">
              <label className="flex items-center gap-2 text-xs text-[#475569] cursor-pointer select-none">
                <input type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleAll} className="accent-blue-600" />
                {selected.size > 0 ? `${selected.size} selected` : 'Select all visible'}
              </label>
              {selected.size > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {selected.size >= 2 && (
                    <button type="button" onClick={pinSelected}
                      className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-colors">
                      📌 Pin Together ({selected.size})
                    </button>
                  )}
                  <button type="button" onClick={doUnassign} disabled={assigning}
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                    Unassign
                  </button>
                  {targetCrateId && (
                    <button type="button" onClick={() => doAssign(targetCrateId)} disabled={assigning}
                      className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                      {assigning ? '…' : `→ ${targetCrate?.crate_id || 'Crate'}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Block error */}
          {blockError && (
            <div className="shrink-0 rounded-[14px] border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
              🚫 {blockError}
            </div>
          )}

          {/* Scrollable list */}
          <div className="space-y-2 overflow-y-auto flex-1" style={{ maxHeight: '60vh' }}>
            {loading && <div className="py-10 text-center text-xs text-[#94a3b8]">Loading families…</div>}

            {/* Pinned groups section */}
            {!loading && pinGroups.length > 0 && (
              <div className="space-y-2 pb-2 border-b border-[#f1f5f9] mb-1">
                <div className="text-[10px] uppercase tracking-wide text-[#94a3b8] px-1">Pinned Groups</div>
                {pinGroups.map(pg => (
                  <PinnedGroupCard
                    key={pg.id}
                    group={pg}
                    families={families}
                    selected={selected}
                    onToggleGroup={togglePinGroup}
                    onUnpin={unpinGroup}
                  />
                ))}
              </div>
            )}

            {/* Individual families */}
            {!loading && filtered.length === 0 && pinGroups.length === 0 && (
              <div className="py-10 text-center text-xs text-[#94a3b8]">No families match filters.</div>
            )}
            {!loading && filtered.map(fam => (
              <FamilyCard
                key={`${fam.flat_key}__${bundleRowKey(fam)}`}
                family={fam}
                selected={selected.has(bundleRowKey(fam))}
                onToggle={toggleFamily}
                onDragStart={setDragFamily}
                onDragEnd={() => {}}
                isPinned={!!familyToPinGroup[bundleRowKey(fam)]}
                pinLabel={pinGroups.find(pg => pg.familyIds.includes(bundleRowKey(fam)))?.label || ''}
              />
            ))}
          </div>
        </div>

        {/* ── RIGHT: Target crate ── */}
        <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm flex flex-col gap-4 overflow-y-auto" style={{ maxHeight: '90vh' }}>
          <div className="shrink-0">
            <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Assignment Target</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Target Crate</div>
          </div>

          {/* Crate selector */}
          <select value={targetCrateId || ''} onChange={e => { setTargetCrateId(Number(e.target.value)); setBlockError(null); }}
            className="w-full rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:border-blue-400">
            {crateRows.map(c => (
              <option key={c.id} value={c.id}>
                {c.crate_id} · {formatNumber(c.gross_weight || 0)} kg · {formatNumber(c.fill_percent || 0)}%
              </option>
            ))}
          </select>

          {/* Drop zone */}
          <div onDragOver={e => { if (dragFamily) e.preventDefault(); }}
            onDrop={() => { if (dragFamily && targetCrateId) handleDrop(targetCrateId); }}
            className={`rounded-[20px] border-2 border-dashed p-3 text-center text-xs transition-colors ${
              dragFamily ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-[#cbd5e1] text-[#94a3b8]'
            }`}>
            {dragFamily ? <>Drop <strong>{dragFamily.family_id}</strong> here</> : 'Drag a family here to assign'}
          </div>

          {targetCrate && (
            <>
              {/* Live fill status */}
              {(() => {
                const currentKg = targetCrate.gross_weight || 0;
                const displayKg = addedWeight > 0 ? previewWeight : currentKg;
                const maxKg     = targetCrate.max_weight || targetCatMeta?.maxKg || 2200;
                const pct       = Math.min(100, (displayKg / maxKg) * 100);
                const barCls    = displayKg > maxKg ? 'bg-rose-500' :
                  targetCatMeta && displayKg >= targetCatMeta.idealLo && displayKg <= targetCatMeta.idealHi ? 'bg-emerald-500' : 'bg-amber-400';
                return (
                  <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-[#64748b]">Live Fill Status</div>
                    <div className="flex justify-between text-sm font-semibold">
                      <span className={weightBandCls(displayKg, targetCatMeta)}>
                        {Math.round(displayKg)} kg
                        {addedWeight > 0 && <span className="ml-1 text-xs font-normal text-blue-600">(+{Math.round(addedWeight)} preview)</span>}
                      </span>
                      <span className="text-[#94a3b8] text-xs font-normal">max {Math.round(maxKg)} kg</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className={weightBandCls(displayKg, targetCatMeta)}>{weightBandLabel(displayKg, targetCatMeta)}</span>
                      {targetCatMeta && <span className="text-[#64748b]">Target {targetCatMeta.idealLo}–{targetCatMeta.idealHi} kg</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Category mix + compatibility */}
              {(existingCats.length > 0 || incomingCats.length > 0) && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-[#64748b] mb-1.5">Category Mix</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set([...existingCats, ...incomingCats])].map(c => <CategoryBadge key={c} category={c} />)}
                  </div>
                  {getBlockReason(existingCats, incomingCats) && (
                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                      🚫 {getBlockReason(existingCats, incomingCats)}
                    </div>
                  )}
                </div>
              )}

              {/* Families in target */}
              <div className="flex-1 min-h-0">
                <div className="text-xs uppercase tracking-wide text-[#64748b] mb-2">
                  Families in {targetCrate.crate_id} ({familiesInTarget.length})
                </div>
                <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '26vh' }}>
                  {familiesInTarget.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#e2e8f0] py-4 text-center text-xs text-[#94a3b8]">
                      No families assigned yet
                    </div>
                  ) : familiesInTarget.map(fam => (
                    <div key={`${fam.flat_key}__${bundleRowKey(fam)}`}
                      className="flex items-center justify-between rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CategoryBadge category={fam.category} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#0f172a] truncate">{locLabel(fam)}</div>
                          <div className="text-[10px] text-[#64748b]">{fam.family_id}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-[#94a3b8] shrink-0 ml-2">{fam.total_weight_kg} kg</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assign button */}
              {selected.size > 0 && (
                <button type="button" onClick={() => doAssign(targetCrateId)} disabled={assigning}
                  className="w-full rounded-full bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {assigning ? 'Assigning…' : `Assign ${selected.size} famil${selected.size === 1 ? 'y' : 'ies'} → ${targetCrate.crate_id}`}
                </button>
              )}
            </>
          )}

          {crateRows.length === 0 && (
            <div className="flex-1 rounded-[20px] border border-dashed border-[#cbd5e1] py-10 text-center text-xs text-[#94a3b8]">
              No crates yet — generate a plan or create an empty crate first
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateCrateModal onClose={() => setShowCreateModal(false)} onCreated={loadFamilies} />
      )}
    </div>
  );
};

export default FamilyBuilderPanel;
