import React, { useEffect, useMemo, useState } from 'react';
import { usePlannerStore } from '../store/plannerStore';
import {
  buildPiecesByCrate,
  formatNumber,
  getPieceWeight,
  groupCratesForWorkflow,
} from '../utils/plannerUtils';
import { scoreCrateCompatibility } from '../packing-engine/compatibilityEngine';
import { calculateCrateDimensions, defaultCalculatorParams } from '../packing-engine/crateCalculator';
import { getCrateConstruction } from '../packing-engine/crateConstruction';
import { analyzeCrateRisk } from '../packing-engine/crateRiskAnalyzer';
import { generateCrateReasoning, generateWarehouseMetadata } from '../packing-engine/crateReasoning';

// ────────── Sub-components ──────────

const Badge = ({ label, variant = 'gray' }) => {
  const cls = {
    green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    yellow: 'bg-amber-100 text-amber-800 border-amber-200',
    red:    'bg-rose-100 text-rose-700 border-rose-200',
    blue:   'bg-blue-100 text-blue-700 border-blue-200',
    purple: 'bg-violet-100 text-violet-700 border-violet-200',
    gray:   'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls[variant] || cls.gray}`}>
      {label}
    </span>
  );
};

const WeightBar = ({ value, max, warn = 80, danger = 95 }) => {
  const pct   = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const color = pct >= danger ? 'bg-rose-500' : pct >= warn ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const ScoreBar = ({ value, label, inverted = false }) => {
  // inverted: higher = worse (damage risk, handling difficulty)
  const pct   = Math.min(100, Math.max(0, value));
  const color = inverted
    ? (pct > 60 ? 'bg-rose-500' : pct > 30 ? 'bg-amber-400' : 'bg-emerald-500')
    : (pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-400' : 'bg-rose-500');
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-[#64748b]">{label}</span>
        <span className="font-bold text-[#0f172a]">{pct}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const OptSlider = ({ label, value, onChange, hint }) => (
  <div>
    <div className="flex items-center justify-between mb-0.5">
      <span className="text-xs font-medium text-[#334155]">{label}</span>
      <span className="text-xs font-bold text-[#1d4ed8] w-5 text-right">{value}</span>
    </div>
    <input
      type="range" min="1" max="10" step="1"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full h-1.5 accent-blue-600 cursor-pointer"
    />
    {hint && <div className="text-[10px] text-[#94a3b8] mt-0.5">{hint}</div>}
  </div>
);

const FLAG_DISPLAY = {
  FRAGILE:          { label: 'Fragile',           color: 'red' },
  FORKLIFT_REQUIRED:{ label: 'Forklift',          color: 'blue' },
  TEAM_LIFT:        { label: 'Team Lift',          color: 'yellow' },
  UPRIGHT_ONLY:     { label: 'Upright Only',       color: 'purple' },
  DO_NOT_STACK:     { label: 'No Stack',           color: 'red' },
  POLISHED_SURFACE: { label: 'Polished Surface',   color: 'purple' },
  CORNER_PROTECTED: { label: 'Corner Guards',      color: 'blue' },
};

const statusStyles = {
  green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red:    'bg-rose-100 text-rose-700 border-rose-200',
};

const COMPAT_SCORE_COLOR = (s) => s >= 70 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-rose-600';

const DEFAULT_WEIGHTS = {
  floor_grouping: 7, apartment_grouping: 8, weight_balance: 6,
  material_grouping: 5, fragility_separation: 4, packing_density: 7,
};

// ────────── Main component ──────────

const PlannerCrateTab = () => {
  const project    = usePlannerStore(s => s.project);
  const pieces     = usePlannerStore(s => s.pieces);
  const crates     = usePlannerStore(s => s.crates);
  const assignments = usePlannerStore(s => s.assignments);
  const insights   = usePlannerStore(s => s.insights);
  const selectedCrateId    = usePlannerStore(s => s.selectedCrateId);
  const setSelectedCrateId = usePlannerStore(s => s.setSelectedCrateId);
  const updateCrate        = usePlannerStore(s => s.updateCrate);
  const mergeCrates        = usePlannerStore(s => s.mergeCrates);
  const deleteCrate        = usePlannerStore(s => s.deleteCrate);
  const createCustomCrate  = usePlannerStore(s => s.createCustomCrate);
  const splitCrate         = usePlannerStore(s => s.splitCrate);
  const assignPiece        = usePlannerStore(s => s.assignPiece);
  const regenerateWithStrategy = usePlannerStore(s => s.regenerateWithStrategy);
  const isRefreshing       = usePlannerStore(s => s.isRefreshing);

  // ── Core state ──
  const [detailDraft, setDetailDraft]   = useState(null);
  const [selectedPieceIds, setSelectedPieceIds] = useState([]);
  const [dragPieceId, setDragPieceId]   = useState(null);
  const [centerTab, setCenterTab]       = useState('contents');
  const [searchQuery, setSearchQuery]   = useState('');
  const [strategy, setStrategy]         = useState('category');
  const [weights, setWeights]           = useState({ ...DEFAULT_WEIGHTS });
  const [showNewCrateModal, setShowNewCrateModal] = useState(false);
  const [newCrateName, setNewCrateName] = useState('');

  // ── Engine state ──
  const [crateParams, setCrateParams]         = useState({ ...defaultCalculatorParams });
  const [showCalculator, setShowCalculator]   = useState(false);
  const [showWarehouse, setShowWarehouse]     = useState(false);
  const [showReasoning, setShowReasoning]     = useState(false);
  const [computedDimsPreview, setComputedDimsPreview] = useState(null);

  // ── Core data ──
  const crateRows     = insights?.crates || [];
  const piecesByCrate = useMemo(() => buildPiecesByCrate(pieces, crates, assignments), [pieces, crates, assignments]);
  const pieceWeights  = useMemo(
    () => pieces.reduce((m, p) => ({ ...m, [p.id]: getPieceWeight(p, project) }), {}),
    [pieces, project]
  );

  const filteredCrateRows = useMemo(() => {
    if (!searchQuery.trim()) return crateRows;
    const q = searchQuery.toLowerCase();
    return crateRows.filter(c =>
      (c.crate_id || '').toLowerCase().includes(q) ||
      (c.name     || '').toLowerCase().includes(q) ||
      (c.destination_group || '').toLowerCase().includes(q)
    );
  }, [crateRows, searchQuery]);

  const selectedCrate       = crateRows.find(c => c.id === selectedCrateId) || crateRows[0] || null;
  const selectedCratePieces = selectedCrate ? (piecesByCrate.grouped[selectedCrate.id] || []) : [];

  const underfilledMap = useMemo(
    () => Object.fromEntries((insights?.underfilled_crates || []).map(c => [c.crate_id, c])),
    [insights]
  );

  // Stats
  const totalWeight = crateRows.reduce((s, c) => s + (c.gross_weight || 0), 0);
  const avgFill     = crateRows.length
    ? crateRows.reduce((s, c) => s + (c.fill_percent || 0), 0) / crateRows.length
    : 0;

  // ── Engine computations ──

  // Compatibility scores for every crate (O(n²) per crate, computed once per data change)
  const compatScores = useMemo(() => {
    const scores = {};
    crates.forEach(crate => {
      const cps = piecesByCrate.grouped[crate.id] || [];
      if (cps.length > 0) scores[crate.id] = scoreCrateCompatibility(cps);
    });
    return scores;
  }, [crates, piecesByCrate]);

  const selectedCrateCompat = useMemo(
    () => selectedCrate ? (compatScores[selectedCrate.id] || { score: 0, reasons: [], warnings: [] }) : null,
    [selectedCrate, compatScores]
  );

  // Full engine analysis for selected crate (recalculates when params or selection change)
  const selectedCrateEngine = useMemo(() => {
    if (!selectedCrate || !selectedCratePieces.length) return null;
    const gw           = selectedCrate.gross_weight || 0;
    const construction = getCrateConstruction(selectedCratePieces, gw);
    const risk         = analyzeCrateRisk(selectedCratePieces, selectedCrate, gw);
    const reasoning    = generateCrateReasoning(selectedCratePieces, selectedCrateCompat);
    const warehouse    = generateWarehouseMetadata(selectedCrate, selectedCratePieces, construction);
    return { construction, risk, reasoning, warehouse };
  }, [selectedCrate, selectedCratePieces, selectedCrateCompat]);

  // Live calculator — recomputes when crateParams change
  const liveCalcDims = useMemo(
    () => selectedCratePieces.length ? calculateCrateDimensions(selectedCratePieces, crateParams) : null,
    [selectedCratePieces, crateParams]
  );

  // ── Sync draft on selection change ──
  const selectedCrateIdStable = selectedCrate?.id;
  useEffect(() => {
    if (!selectedCrate) { setDetailDraft(null); return; }
    setDetailDraft({
      name: selectedCrate.name || '',
      max_weight: selectedCrate.max_weight || 1000,
      reserved_space_pct: selectedCrate.reserved_space_pct || 0,
      planner_notes: selectedCrate.planner_notes || '',
      dimension_mode: selectedCrate.dimension_mode || 'auto',
      internal_length: selectedCrate.internal_length || '',
      internal_width:  selectedCrate.internal_width  || '',
      internal_height: selectedCrate.internal_height || '',
      external_length: selectedCrate.external_length || '',
      external_width:  selectedCrate.external_width  || '',
      external_height: selectedCrate.external_height || '',
      locked: Boolean(selectedCrate.locked),
    });
    setSelectedPieceIds([]);
    setComputedDimsPreview(null);
  }, [selectedCrateIdStable]);

  // ── Helpers ──
  const buildPayload = (overrides = {}) => {
    if (!selectedCrate || !detailDraft) return null;
    const next = { ...detailDraft, ...overrides };
    const payload = {
      name: next.name,
      max_weight: Number(next.max_weight) || 1000,
      reserved_space_pct: Number(next.reserved_space_pct) || 0,
      planner_notes: next.planner_notes || '',
      locked: Boolean(next.locked),
      custom: Boolean(selectedCrate.custom),
      dimension_mode: next.dimension_mode || 'auto',
    };
    if (payload.dimension_mode === 'manual') {
      payload.internal_length = Number(next.internal_length) || 0;
      payload.internal_width  = Number(next.internal_width)  || 0;
      payload.internal_height = Number(next.internal_height) || 0;
      payload.external_length = Number(next.external_length) || 0;
      payload.external_width  = Number(next.external_width)  || 0;
      payload.external_height = Number(next.external_height) || 0;
    }
    return payload;
  };

  const commitDraft = async (overrides = {}) => {
    if (!selectedCrate) return;
    const payload = buildPayload(overrides);
    if (!payload) return;
    await updateCrate(selectedCrate.id, payload);
  };

  const handleSuggestedMerge = async () => {
    if (!selectedCrate) return;
    const candidateCode = underfilledMap[selectedCrate.crate_id]?.merge_candidates?.[0];
    const candidate = crateRows.find(c => c.crate_id === candidateCode);
    if (!candidate) return;
    await mergeCrates([selectedCrate.id, candidate.id], selectedCrate.id);
  };

  const handleSplitSelected = async () => {
    if (!selectedPieceIds.length || !selectedCrate) return;
    await splitCrate(selectedCrate.id, selectedPieceIds, `Split from ${selectedCrate.crate_id}`);
    setSelectedPieceIds([]);
  };

  const handleDeleteCrate = async () => {
    if (!selectedCrate) return;
    if (!window.confirm(`Delete crate ${selectedCrate.crate_id}? Assignments will be released.`)) return;
    await deleteCrate(selectedCrate.id);
  };

  const handleRegenerate     = () => regenerateWithStrategy(strategy, weights);
  const handleSmartOptimize  = () => regenerateWithStrategy(strategy, {
    floor_grouping: 9, apartment_grouping: 10, weight_balance: 8,
    material_grouping: 8, fragility_separation: 9, packing_density: 8,
  });

  const handleApplyComputedDims = async () => {
    if (!liveCalcDims || !selectedCrate) return;
    await updateCrate(selectedCrate.id, {
      ...buildPayload({ dimension_mode: 'manual' }),
      internal_length: liveCalcDims.internal_length,
      internal_width:  liveCalcDims.internal_width,
      internal_height: liveCalcDims.internal_height,
      external_length: liveCalcDims.external_length,
      external_width:  liveCalcDims.external_width,
      external_height: liveCalcDims.external_height,
    });
  };

  const handleCreateCrate = async () => {
    if (!newCrateName.trim()) return;
    await createCustomCrate({ name: newCrateName.trim(), max_weight: 1000, locked: false, custom: true });
    setNewCrateName('');
    setShowNewCrateModal(false);
  };

  const togglePiece = (id) =>
    setSelectedPieceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const setWeight = (key, val) => setWeights(prev => ({ ...prev, [key]: val }));

  // ── Empty state ──
  if (!insights || crateRows.length === 0) {
    return (
      <div className="rounded-[32px] border border-dashed border-[#cbd5e1] bg-white px-6 py-20 text-center shadow-sm">
        <div className="text-xl font-semibold text-[#0f172a]">No crate plan yet</div>
        <div className="mt-2 text-sm text-[#64748b]">Generate a crate plan from the Summary tab to begin review.</div>
      </div>
    );
  }

  if (!selectedCrate || !detailDraft) return null;

  const recommendationBundle = underfilledMap[selectedCrate.crate_id];
  const canMerge             = Boolean(recommendationBundle?.merge_candidates?.length);
  const quickWarnings        = (selectedCrate.warnings || []).slice(0, 5);
  const { construction, risk, reasoning, warehouse } = selectedCrateEngine || {};

  return (
    <div className="grid gap-6 xl:grid-cols-[0.32fr,0.48fr,0.2fr]">

      {/* ──── LEFT: Crate List ──── */}
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm flex flex-col gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2A</div>
          <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Crate List</div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Crates',    value: crateRows.length },
            { label: 'Total kg',  value: Math.round(totalWeight) },
            { label: 'Avg Fill',  value: `${avgFill.toFixed(0)}%` },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl bg-[#f8fafc] border border-[#e2e8f0] py-2 px-1">
              <div className="text-sm font-bold text-[#0f172a]">{stat.value}</div>
              <div className="text-[10px] text-[#94a3b8] uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search crates…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="input-field text-sm"
        />

        {/* Crate cards */}
        <div className="space-y-2 overflow-y-auto flex-1" style={{ maxHeight: '58vh' }}>
          {filteredCrateRows.map(crate => {
            const piecesInCrate = piecesByCrate.grouped[crate.id] || [];
            const wPct        = crate.max_weight > 0 ? (crate.gross_weight / crate.max_weight) * 100 : 0;
            const isOverloaded = wPct > 100;
            const isHeavy      = wPct > 85 && !isOverloaded;
            const isFragile    = (crate.warnings || []).some(w => /fragile|polished|glass/i.test(w));
            const compat       = compatScores[crate.id];
            return (
              <button
                key={crate.id}
                type="button"
                onClick={() => setSelectedCrateId(crate.id)}
                onDragOver={e => { if (!crate.locked && dragPieceId) e.preventDefault(); }}
                onDrop={async () => {
                  if (!dragPieceId || crate.locked) return;
                  await assignPiece(dragPieceId, crate.id);
                  setDragPieceId(null);
                }}
                className={`w-full rounded-[22px] border px-4 py-3 text-left transition-all ${
                  selectedCrate.id === crate.id
                    ? 'border-[#1d4ed8] bg-[#eff6ff] shadow-[0_0_0_3px_rgba(29,78,216,0.08)]'
                    : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe] hover:bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[#0f172a] text-sm">{crate.crate_id}</div>
                    <div className="text-[11px] text-[#64748b] truncate">{crate.destination_group || '—'}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {isOverloaded && <Badge label="Overloaded" variant="red" />}
                    {isHeavy      && <Badge label="Heavy"      variant="yellow" />}
                    {isFragile    && <Badge label="Fragile"    variant="purple" />}
                    {crate.locked && <Badge label="Locked"     variant="blue" />}
                  </div>
                </div>
                <div className="mt-2">
                  <WeightBar value={crate.gross_weight} max={crate.max_weight} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#475569]">
                  <span>{Math.round(crate.gross_weight || 0)} kg</span>
                  <span>{(crate.fill_percent || 0).toFixed(0)}% fill</span>
                  <span>{piecesInCrate.length} pcs</span>
                  {compat && (
                    <span className={`font-bold text-[10px] ${COMPAT_SCORE_COLOR(compat.score)}`}>
                      ⚡{compat.score}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <button type="button" onClick={() => setShowNewCrateModal(true)} className="btn-primary w-full text-sm">
          + New Crate
        </button>
      </div>

      {/* ──── CENTER: Detail Panel ──── */}
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm flex flex-col">

        {/* Header */}
        <div className="shrink-0">
          <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2B</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-2xl font-semibold text-[#0f172a]">{selectedCrate.crate_id}</div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[selectedCrate.efficiency_status] || statusStyles.yellow}`}>
              {selectedCrate.efficiency_status}
            </span>
            {selectedCrate.packing_mode && (
              <span className="rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-semibold text-[#166534]">
                {selectedCrate.packing_mode === 'flat' ? 'Flat-Based' : 'Category-Based'}
              </span>
            )}
            {selectedCrateCompat && (
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                selectedCrateCompat.score >= 70
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : selectedCrateCompat.score >= 45
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                ⚡ {selectedCrateCompat.score}/100 Compat
              </span>
            )}
            {selectedCrate.weight_band_status && (
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                selectedCrate.weight_band_status === 'ideal'
                  ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
                  : selectedCrate.weight_band_status === 'below_ideal'
                  ? 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'
                  : 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
              }`}>
                {selectedCrate.weight_band_status === 'ideal' ? 'Ideal Weight'
                  : selectedCrate.weight_band_status === 'below_ideal' ? 'Below Ideal' : 'Above Ideal'}
              </span>
            )}
          </div>
          {(selectedCrate.primary_flat || selectedCrate.grouping_reason) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-[#475569]">
              {selectedCrate.primary_flat && (
                <span className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1">
                  📍 {selectedCrate.primary_flat}
                  {selectedCrate.secondary_flats?.length > 0 && ` + ${selectedCrate.secondary_flats.join(', ')}`}
                </span>
              )}
              {selectedCrate.grouping_reason && (
                <span className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1">
                  {selectedCrate.grouping_reason}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mt-4 shrink-0 flex gap-0 border-b border-[#e2e8f0]">
          {['contents', 'settings', 'metrics'].map(tab => (
            <button key={tab} type="button" onClick={() => setCenterTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                centerTab === tab
                  ? 'border-[#1d4ed8] text-[#1d4ed8]'
                  : 'border-transparent text-[#64748b] hover:text-[#334155]'
              }`}
            >
              {tab}
              {tab === 'contents' && (
                <span className="ml-1.5 rounded-full bg-[#e2e8f0] px-1.5 py-0.5 text-[10px] text-[#475569]">
                  {selectedCratePieces.length}
                </span>
              )}
              {tab === 'metrics' && (quickWarnings.length > 0 || (risk?.damage_risk_level === 'high')) && (
                <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-600">!</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Contents Tab ── */}
        {centerTab === 'contents' && (
          <div className="mt-4 flex flex-col gap-3 flex-1 min-h-0">

            {/* Reasoning summary — expandable */}
            {reasoning && (
              <div className={`rounded-[18px] border px-4 py-3 text-xs transition-colors ${
                reasoning.score >= 70
                  ? 'border-emerald-200 bg-emerald-50'
                  : reasoning.score >= 45
                  ? 'border-amber-100 bg-amber-50'
                  : 'border-rose-100 bg-rose-50'
              }`}>
                <button type="button" onClick={() => setShowReasoning(p => !p)}
                  className="flex items-center justify-between w-full text-left">
                  <span className="font-semibold text-[#0f172a]">{reasoning.summary}</span>
                  <span className="text-[#94a3b8] ml-2">{showReasoning ? '▲' : '▼'}</span>
                </button>
                {showReasoning && (
                  <div className="mt-3 space-y-2">
                    {reasoning.reasons.length > 0 && (
                      <div className="space-y-1">
                        {reasoning.reasons.map(r => (
                          <div key={r} className="flex items-center gap-1.5 text-emerald-700">
                            <span>✓</span><span>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {reasoning.warnings.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-amber-200">
                        {reasoning.warnings.map(w => (
                          <div key={w} className="flex items-center gap-1.5 text-amber-700">
                            <span>⚠</span><span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Piece table header controls */}
            <div className="flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-[#0f172a]">
                {selectedPieceIds.length > 0 ? `${selectedPieceIds.length} selected` : 'Piece Contents'}
              </span>
              <div className="flex gap-2">
                {selectedPieceIds.length > 0 && (
                  <button type="button" onClick={handleSplitSelected}
                    className="rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-medium text-[#6d28d9]">
                    Split Selected ({selectedPieceIds.length})
                  </button>
                )}
                <button type="button" onClick={() => setSelectedPieceIds([])}
                  className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#475569]">
                  Clear
                </button>
              </div>
            </div>

            {/* Piece table */}
            <div
              className="overflow-auto rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] flex-1"
              onDragOver={e => e.preventDefault()}
              onDrop={async () => {
                if (!dragPieceId) return;
                await assignPiece(dragPieceId, selectedCrate.id);
                setDragPieceId(null);
              }}
            >
              {selectedCratePieces.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[#94a3b8]">
                  Empty — drag pieces here to assign
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#f1f5f9] z-10">
                    <tr className="border-b border-[#e2e8f0] text-[#94a3b8] uppercase tracking-wide">
                      <th className="py-2 pl-4 w-8">
                        <input type="checkbox"
                          checked={selectedPieceIds.length === selectedCratePieces.length && selectedCratePieces.length > 0}
                          onChange={e => setSelectedPieceIds(e.target.checked ? selectedCratePieces.map(p => p.id) : [])} />
                      </th>
                      <th className="py-2 px-2 text-left">Part #</th>
                      <th className="py-2 px-2 text-left">Category</th>
                      <th className="py-2 px-2 text-left">Dest</th>
                      <th className="py-2 px-2 text-right">L×W</th>
                      <th className="py-2 px-2 text-right">SqFt</th>
                      <th className="py-2 pr-4 text-right">kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCratePieces.map(piece => {
                      const sqft = ((Number(piece.length || 0) * Number(piece.width || 0)) / 144).toFixed(2);
                      const kg   = (pieceWeights[piece.id] || 0).toFixed(1);
                      const dest = [
                        piece.building && `B${piece.building}`,
                        piece.floor    && `F${piece.floor}`,
                        piece.flat,
                      ].filter(Boolean).join('/');
                      return (
                        <tr key={piece.id}
                          draggable={!selectedCrate.locked}
                          onDragStart={() => setDragPieceId(piece.id)}
                          onDragEnd={() => setDragPieceId(null)}
                          className="border-b border-[#f1f5f9] last:border-0 bg-white hover:bg-[#f8fafc] cursor-grab active:cursor-grabbing"
                        >
                          <td className="pl-4 py-2">
                            <input type="checkbox" checked={selectedPieceIds.includes(piece.id)}
                              onChange={() => togglePiece(piece.id)} />
                          </td>
                          <td className="px-2 py-2 font-medium text-[#0f172a]">{piece.part_no || '—'}</td>
                          <td className="px-2 py-2 text-[#475569]">{piece.part || '—'}</td>
                          <td className="px-2 py-2 text-[#475569]">{dest || '—'}</td>
                          <td className="px-2 py-2 text-right">{formatNumber(piece.length)}×{formatNumber(piece.width)}</td>
                          <td className="px-2 py-2 text-right">{sqft}</td>
                          <td className="pr-4 py-2 text-right font-medium">{kg}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Unassigned */}
            {piecesByCrate.unassigned.length > 0 && (
              <div className="shrink-0 rounded-[20px] border border-dashed border-[#cbd5e1] bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[#94a3b8] mb-2">
                  Unassigned ({piecesByCrate.unassigned.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {piecesByCrate.unassigned.map(piece => (
                    <button key={piece.id} type="button" draggable
                      onDragStart={() => setDragPieceId(piece.id)}
                      onDragEnd={() => setDragPieceId(null)}
                      className="rounded-full border border-[#dbe4f0] bg-[#f8fafc] px-2.5 py-1 text-[11px] text-[#334155] cursor-grab">
                      {piece.part || piece.part_no || 'Part'} · {(pieceWeights[piece.id] || 0).toFixed(1)} kg
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Settings Tab ── */}
        {centerTab === 'settings' && (
          <div className="mt-4 space-y-5 overflow-y-auto flex-1">

            {/* Standard fields */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label-text">Crate Name</label>
                <input className="input-field" value={detailDraft.name}
                  onChange={e => setDetailDraft(p => ({ ...p, name: e.target.value }))}
                  onBlur={() => commitDraft()} />
              </div>
              <div>
                <label className="label-text">Gross Limit (kg)</label>
                <input type="number" className="input-field" value={detailDraft.max_weight}
                  onChange={e => setDetailDraft(p => ({ ...p, max_weight: e.target.value }))}
                  onBlur={() => commitDraft()} />
              </div>
              <div>
                <label className="label-text">Reserved Space %</label>
                <input type="number" className="input-field" value={detailDraft.reserved_space_pct}
                  onChange={e => setDetailDraft(p => ({ ...p, reserved_space_pct: e.target.value }))}
                  onBlur={() => commitDraft()} />
              </div>
              <div>
                <label className="label-text">Dimension Mode</label>
                <select className="input-field" value={detailDraft.dimension_mode}
                  onChange={e => { const v = e.target.value; setDetailDraft(p => ({ ...p, dimension_mode: v })); commitDraft({ dimension_mode: v }); }}>
                  <option value="auto">Auto Dimensions</option>
                  <option value="manual">Manual Dimensions</option>
                </select>
              </div>
            </div>

            {detailDraft.dimension_mode === 'manual' && (
              <div className="grid gap-3 md:grid-cols-3">
                {[['internal_length','Int L'],['internal_width','Int W'],['internal_height','Int H'],
                  ['external_length','Ext L'],['external_width','Ext W'],['external_height','Ext H']].map(([field, label]) => (
                  <div key={field}>
                    <label className="label-text">{label}</label>
                    <input type="number" className="input-field" value={detailDraft[field]}
                      onChange={e => setDetailDraft(p => ({ ...p, [field]: e.target.value }))}
                      onBlur={() => commitDraft()} />
                  </div>
                ))}
              </div>
            )}

            {/* ── Live Crate Calculator ── */}
            <div className="rounded-[20px] border border-[#dbe4f0] p-4 space-y-3">
              <button type="button" onClick={() => setShowCalculator(p => !p)}
                className="flex items-center justify-between w-full text-sm font-semibold text-[#0f172a]">
                <span>Live Crate Calculator</span>
                <span className="text-[#94a3b8] text-[10px]">{showCalculator ? '▲' : '▼'}</span>
              </button>
              {showCalculator && (
                <div className="space-y-3">
                  <div className="grid gap-3 grid-cols-2">
                    {[
                      ['foamSeparatorThickness', 'Foam Sep. (in)'],
                      ['woodPanelThickness',     'Wood Panel (in)'],
                      ['edgeGuardThickness',     'Edge Guard (in)'],
                      ['forkliftClearance',      'Fork Clearance (in)'],
                      ['safetyMargin',           'Safety Margin (in)'],
                      ['cornerReinforcement',    'Corner Reinf. (in)'],
                    ].map(([key, lbl]) => (
                      <div key={key}>
                        <label className="label-text">{lbl}</label>
                        <input type="number" step="0.125" className="input-field"
                          value={crateParams[key]}
                          onChange={e => setCrateParams(p => ({ ...p, [key]: Number(e.target.value) }))} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="label-text">Orientation</label>
                    <select className="input-field" value={crateParams.orientation}
                      onChange={e => setCrateParams(p => ({ ...p, orientation: e.target.value }))}>
                      <option value="flat">Flat Stacking</option>
                      <option value="vertical">Vertical / A-Frame</option>
                    </select>
                  </div>
                  {liveCalcDims && (
                    <div className="rounded-xl bg-[#f0fdf4] border border-emerald-200 p-3 text-xs space-y-1">
                      <div className="font-semibold text-emerald-800 mb-1.5">Computed Dimensions</div>
                      <div className="grid grid-cols-2 gap-1 text-emerald-700">
                        <span>Int: {liveCalcDims.internal_length} × {liveCalcDims.internal_width} × {liveCalcDims.internal_height}"</span>
                        <span>Ext: {liveCalcDims.external_length} × {liveCalcDims.external_width} × {liveCalcDims.external_height}"</span>
                        <span>Shipping: {liveCalcDims.shipping_cube_cuft} cuft</span>
                        <span>Fill: {liveCalcDims.volume_fill_pct}%</span>
                      </div>
                      <button type="button" onClick={handleApplyComputedDims}
                        className="mt-2 btn-primary w-full text-xs py-1.5">
                        Apply These Dimensions
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Planner notes + lock */}
            <div>
              <label className="label-text">Planner Notes</label>
              <textarea className="input-field resize-none" rows={3} value={detailDraft.planner_notes}
                onChange={e => setDetailDraft(p => ({ ...p, planner_notes: e.target.value }))}
                onBlur={() => commitDraft()}
                placeholder="Handling instructions, fragile items, special care…" />
            </div>
            <label className={`flex items-center gap-2 cursor-pointer text-sm font-medium px-4 py-2.5 rounded-xl border transition-all w-fit ${
              detailDraft.locked
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-[#e2e8f0] text-[#475569] hover:border-[#cbd5e1]'
            }`}>
              <input type="checkbox" checked={detailDraft.locked}
                onChange={e => { setDetailDraft(p => ({ ...p, locked: e.target.checked })); commitDraft({ locked: e.target.checked }); }}
                className="accent-blue-600 w-4 h-4" />
              Lock this crate
            </label>
          </div>
        )}

        {/* ── Metrics Tab ── */}
        {centerTab === 'metrics' && (
          <div className="mt-4 space-y-4 overflow-y-auto flex-1">

            {/* Weight */}
            <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
              <div className="text-xs uppercase tracking-wide text-[#64748b]">Weight</div>
              <div className="flex justify-between text-sm">
                <span className="text-[#334155] font-medium">{formatNumber(selectedCrate.gross_weight, 1)} kg gross</span>
                <span className="text-[#94a3b8]">max {formatNumber(selectedCrate.max_weight, 0)} kg</span>
              </div>
              <WeightBar value={selectedCrate.gross_weight} max={selectedCrate.max_weight} />
              <div className="grid grid-cols-2 gap-3 text-xs text-[#475569]">
                <div>Tare: {formatNumber(selectedCrate.tare_weight, 1)} kg</div>
                <div>Net: {formatNumber((selectedCrate.gross_weight || 0) - (selectedCrate.tare_weight || 0), 1)} kg</div>
              </div>
            </div>

            {/* Volume fill */}
            <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="uppercase tracking-wide text-[#64748b]">Volume Fill</span>
                <span className="font-bold text-[#0f172a]">{formatNumber(selectedCrate.fill_percent, 0)}%</span>
              </div>
              <WeightBar value={selectedCrate.fill_percent} max={100} warn={70} danger={95} />
            </div>

            {/* Compatibility score */}
            {selectedCrateCompat && (
              <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
                <div className="text-xs uppercase tracking-wide text-[#64748b]">Compatibility Score</div>
                <ScoreBar value={selectedCrateCompat.score} label="Overall Compatibility" />
                {selectedCrateCompat.reasons.length > 0 && (
                  <div className="space-y-1">
                    {selectedCrateCompat.reasons.slice(0, 5).map(r => (
                      <div key={r} className="flex items-center gap-1.5 text-xs text-emerald-700">
                        <span>✓</span><span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedCrateCompat.warnings.length > 0 && (
                  <div className="space-y-1 border-t border-amber-100 pt-2">
                    {selectedCrateCompat.warnings.slice(0, 3).map(w => (
                      <div key={w} className="flex items-center gap-1.5 text-xs text-amber-700">
                        <span>⚠</span><span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Risk analysis */}
            {risk && (
              <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
                <div className="text-xs uppercase tracking-wide text-[#64748b]">Risk Analysis</div>
                <ScoreBar value={risk.damage_risk}          label="Damage Risk"           inverted />
                <ScoreBar value={risk.handling_difficulty}  label="Handling Difficulty"   inverted />
                <ScoreBar value={risk.production_efficiency} label="Production Efficiency" />
                <ScoreBar value={risk.shipping_efficiency}  label="Shipping Efficiency" />
                {risk.recommendations.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#e2e8f0]">
                    <div className="text-[10px] uppercase tracking-wide text-[#94a3b8]">Recommendations</div>
                    {risk.recommendations.map(r => (
                      <div key={r} className="rounded-xl bg-white border border-[#e2e8f0] px-3 py-2 text-xs text-[#475569]">
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Crate construction */}
            {construction && (
              <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-2">
                <div className="text-xs uppercase tracking-wide text-[#64748b]">Crate Construction</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#0f172a]">{construction.crate_type_label}</span>
                  <Badge label={`$${construction.estimated_cost_usd}`} variant="gray" />
                </div>
                <div className="text-[11px] text-[#64748b]">{construction.description}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#475569] mt-2">
                  <span>Wood: {construction.wood_thickness}"</span>
                  <span>Braces: {construction.brace_count}</span>
                  <span>Foam: {construction.foam_padding_sqft} sqft</span>
                  <span>Separators: {construction.separator_count}</span>
                  <span>Straps: {construction.strap_points}</span>
                  <span>Corners: {construction.corner_protectors ? 'Yes' : 'No'}</span>
                </div>
                {construction.handling_flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {construction.handling_flags.map(flag => {
                      const d = FLAG_DISPLAY[flag];
                      return d ? <Badge key={flag} label={d.label} variant={d.color} /> : null;
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Dimensions */}
            <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
              <div className="text-xs uppercase tracking-wide text-[#64748b] mb-2">Dimensions (in)</div>
              <div className="grid grid-cols-2 gap-2 text-sm text-[#334155]">
                <div>Ext: {formatNumber(selectedCrate.external_length)} × {formatNumber(selectedCrate.external_width)} × {formatNumber(selectedCrate.external_height)}</div>
                <div>Int: {formatNumber(selectedCrate.internal_length)} × {formatNumber(selectedCrate.internal_width)} × {formatNumber(selectedCrate.internal_height)}</div>
              </div>
            </div>

            {/* Handling */}
            <div className="rounded-[20px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
              <div className="text-xs uppercase tracking-wide text-[#64748b] mb-2">Handling</div>
              <div className="text-sm text-[#334155] space-y-1">
                <div>{selectedCrate.stackable ? 'Stackable' : 'Single layer — do not stack'}</div>
                {selectedCrate.forklift_entry && <div>Forklift: {selectedCrate.forklift_entry}</div>}
              </div>
            </div>

            {/* Warnings */}
            {quickWarnings.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-wide text-[#64748b]">Warnings</div>
                {quickWarnings.map(w => (
                  <div key={w} className="rounded-xl border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-xs font-medium text-[#be123c]">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ──── RIGHT: Optimization Engine ──── */}
      <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-5 shadow-sm flex flex-col gap-5 overflow-y-auto" style={{ maxHeight: '90vh' }}>
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2C</div>
          <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Optimizer</div>
        </div>

        {/* Strategy */}
        <div>
          <label className="label-text">Strategy</label>
          <select value={strategy} onChange={e => setStrategy(e.target.value)} className="input-field">
            <option value="category">Category-Based</option>
            <option value="flat">Apartment-Based</option>
          </select>
        </div>

        {/* Sliders */}
        <div className="space-y-3.5">
          <div className="text-xs uppercase tracking-wide text-[#64748b]">Optimization Weights</div>
          <OptSlider label="Floor Grouping"    value={weights.floor_grouping}       onChange={v => setWeight('floor_grouping', v)}       hint="Group pieces by floor level" />
          <OptSlider label="Apt Grouping"      value={weights.apartment_grouping}   onChange={v => setWeight('apartment_grouping', v)}   hint="Prioritize same-apartment loads" />
          <OptSlider label="Weight Balance"    value={weights.weight_balance}       onChange={v => setWeight('weight_balance', v)}       hint="Equalize crate weights" />
          <OptSlider label="Material Group"    value={weights.material_grouping}    onChange={v => setWeight('material_grouping', v)}    hint="Keep same material together" />
          <OptSlider label="Fragility Sep."    value={weights.fragility_separation} onChange={v => setWeight('fragility_separation', v)} hint="Separate fragile / polished pieces" />
          <OptSlider label="Pack Density"      value={weights.packing_density}      onChange={v => setWeight('packing_density', v)}      hint="Maximize crate fill rate" />
        </div>

        <button type="button" onClick={handleRegenerate} disabled={isRefreshing}
          className={`btn-primary w-full ${isRefreshing ? 'opacity-60 cursor-not-allowed' : ''}`}>
          {isRefreshing ? 'Regenerating…' : 'Regenerate Plan'}
        </button>

        {/* Smart Optimize */}
        <button type="button" onClick={handleSmartOptimize} disabled={isRefreshing}
          className={`w-full rounded-full border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition-colors ${isRefreshing ? 'opacity-60 cursor-not-allowed' : ''}`}>
          ⚡ Smart Optimize
        </button>

        {/* Quick Actions */}
        <div>
          <div className="text-xs uppercase tracking-wide text-[#64748b] mb-2.5">Quick Actions</div>
          <div className="space-y-2">
            <button type="button" onClick={handleSuggestedMerge} disabled={!canMerge}
              className={`btn-primary w-full text-sm ${!canMerge ? 'opacity-50 cursor-not-allowed' : ''}`}>
              Merge Suggested
              {canMerge && <span className="ml-1 text-[10px] font-normal opacity-80">+ {recommendationBundle.merge_candidates[0]}</span>}
            </button>

            <button type="button" onClick={() => commitDraft({ locked: !selectedCrate.locked })} className="btn-primary w-full text-sm">
              {selectedCrate.locked ? 'Unlock Crate' : 'Lock Crate'}
            </button>

            <button type="button"
              onClick={() => updateCrate(selectedCrate.id, { ...buildPayload(), reset_dimensions: true })}
              className="btn-primary w-full text-sm">
              Auto Resize
            </button>

            <button type="button" onClick={() => commitDraft({ reserved_space_pct: 10 })} className="btn-primary w-full text-sm">
              Reserve 10% Space
            </button>

            {selectedPieceIds.length > 0 && (
              <button type="button" onClick={handleSplitSelected} className="btn-primary w-full text-sm">
                Split Selected ({selectedPieceIds.length})
              </button>
            )}

            <button type="button" onClick={handleDeleteCrate}
              className="w-full rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100 transition-colors">
              Delete Crate
            </button>
          </div>
        </div>

        {/* Warehouse Metadata */}
        {warehouse && (
          <div className="border-t border-[#e2e8f0] pt-4">
            <button type="button" onClick={() => setShowWarehouse(p => !p)}
              className="flex items-center justify-between w-full text-xs uppercase tracking-wide text-[#64748b] mb-2">
              <span>Warehouse Metadata</span>
              <span>{showWarehouse ? '▲' : '▼'}</span>
            </button>
            {showWarehouse && (
              <div className="rounded-[18px] border border-[#e2e8f0] bg-[#f8fafc] p-3 space-y-2 text-xs text-[#475569]">
                <div className="flex items-center gap-2">
                  <span className="text-[#94a3b8]">Barcode</span>
                  <span className="font-mono font-bold text-[#0f172a]">{warehouse.barcode}</span>
                </div>
                <div><span className="text-[#94a3b8]">Label: </span>{warehouse.label}</div>
                <div><span className="text-[#94a3b8]">Type: </span>{warehouse.handling_type}</div>
                <div><span className="text-[#94a3b8]">Dest: </span>{warehouse.destination_note || '—'}</div>
                <div><span className="text-[#94a3b8]">Pieces: </span>{warehouse.piece_count}</div>
                {warehouse.handling_flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {warehouse.handling_flags.map(flag => {
                      const d = FLAG_DISPLAY[flag];
                      return d ? <Badge key={flag} label={d.label} variant={d.color} /> : null;
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ──── New Crate Modal ──── */}
      {showNewCrateModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowNewCrateModal(false)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-[28px] border border-[#dbe4f0] shadow-2xl p-6 w-80">
            <div className="text-lg font-semibold text-[#0f172a] mb-4">New Custom Crate</div>
            <label className="label-text">Crate Name</label>
            <input className="input-field mb-4" value={newCrateName}
              onChange={e => setNewCrateName(e.target.value)}
              placeholder="e.g., CR-CUSTOM-01"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreateCrate(); }} />
            <div className="flex gap-2">
              <button type="button" onClick={handleCreateCrate}
                disabled={!newCrateName.trim()}
                className={`btn-primary flex-1 ${!newCrateName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}>
                Create
              </button>
              <button type="button" onClick={() => { setShowNewCrateModal(false); setNewCrateName(''); }}
                className="flex-1 rounded-full border border-[#e2e8f0] px-4 py-2 text-sm text-[#475569] hover:bg-[#f8fafc]">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PlannerCrateTab;
