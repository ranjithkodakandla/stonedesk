import React, { useState } from 'react';
import { getCrateOperationalStatus } from '../utils/crateEstimator';

// ─── Operational status badge styles ─────────────────────────────────────────

const STATUS_STYLE = {
  READY:       { label: 'Ready',       cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  UNDERLOADED: { label: 'Underloaded', cls: 'border-amber-200  bg-amber-50  text-amber-700'    },
  OVERWEIGHT:  { label: 'Overweight',  cls: 'border-red-200    bg-red-50    text-red-600'       },
  REVIEW:      { label: 'Review',      cls: 'border-violet-200 bg-violet-50 text-violet-700'    },
  ERROR:       { label: 'Invalid',     cls: 'border-red-300    bg-red-100   text-red-700'       },
};

// ─── Crate class display ──────────────────────────────────────────────────────

const CRATE_CLASS_STYLE = {
  island_vertical:  { label: 'Island cassette',    cls: 'bg-blue-50 text-blue-700 border-blue-200'          },
  kitchen_vertical: { label: 'Kitchen horizontal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vanity_vertical:  { label: 'Vanity horizontal',  cls: 'bg-violet-50 text-violet-700 border-violet-200'    },
  misc:             { label: 'Misc',               cls: 'bg-slate-50 text-slate-600 border-slate-200'       },
};

// ─── Part Type → bucket + display ────────────────────────────────────────────

const PART_TYPE_BUCKET = {
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

const BUCKET_PILL = {
  kitchen_islands: 'bg-blue-100 text-blue-700',
  kitchen:         'bg-emerald-100 text-emerald-700',
  vanity:          'bg-violet-100 text-violet-700',
  misc:            'bg-slate-100 text-slate-600',
};

const BUCKET_DOT = {
  kitchen_islands: 'bg-blue-500',
  kitchen:         'bg-emerald-500',
  vanity:          'bg-violet-500',
  misc:            'bg-slate-400',
};

function partTypePill(pt) {
  return BUCKET_PILL[PART_TYPE_BUCKET[pt] || 'misc'] || BUCKET_PILL.misc;
}

function bucketDot(bk) {
  return BUCKET_DOT[bk || 'misc'] || BUCKET_DOT.misc;
}

// Show full numeric precision — no rounding, no truncation.
// maximumFractionDigits:8 shows all significant digits without floating-point noise.
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-AU', { maximumFractionDigits: 8 });
}

// ─── Dimension display row ────────────────────────────────────────────────────

function DimBlock({ label, dims, prefix }) {
  if (!dims || !dims[`${prefix}length`]) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[#94a3b8] w-16 flex-shrink-0">{label}</span>
      <span className="font-mono text-sm text-[#334155]">
        {fmt(dims[`${prefix}length`])} × {fmt(dims[`${prefix}width`])} × {fmt(dims[`${prefix}height`])}″
      </span>
    </div>
  );
}

// ─── Part row inside crate (full detail) ─────────────────────────────────────

function PartRowInCrate({ piece }) {
  const isMain = piece.role === 'main';
  const meta = [piece.drawing, piece.unit].filter(Boolean).join(' · ');
  return (
    <div className="grid gap-x-3 gap-y-0.5 py-1.5 border-b border-[#f8fafc] last:border-0"
         style={{ gridTemplateColumns: 'auto 1fr auto auto auto' }}>
      {/* Role */}
      <span className={`self-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
        isMain ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'bg-amber-50 text-amber-700'
      }`}>
        {isMain ? 'Top' : 'Splash'}
      </span>
      {/* Part Type + Part # + Drawing/Unit */}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-[#1e293b] truncate">{piece.part || '—'}</div>
        <div className="flex gap-2 text-[10px] text-[#94a3b8]">
          {piece.part_no && <span className="font-mono">{piece.part_no}</span>}
          {meta && <span>{meta}</span>}
        </div>
      </div>
      {/* Dimensions */}
      <span className="self-center text-[11px] text-[#64748b] whitespace-nowrap">
        {piece.length > 0 && piece.width > 0 ? `${fmt(piece.length)} × ${fmt(piece.width)}″` : '—'}
      </span>
      {/* Weight */}
      <span className="self-center text-[11px] font-medium text-[#334155] whitespace-nowrap">
        {fmt(piece.weight_kg)} kg
      </span>
      {/* Sqft */}
      <span className="self-center text-[11px] text-[#64748b] whitespace-nowrap">
        {fmt(piece.sqft)} ft²
      </span>
    </div>
  );
}

// ─── Bundle group inside draft crate ─────────────────────────────────────────

function BundleInCrate({ bundle, crateId, onRemove }) {
  const [showParts, setShowParts] = useState(false);
  const bk = bundle.part_bucket || 'misc';
  // Derive displayed Part Types from pieces (full names, no aliases)
  const partTypes = [...new Set(
    (bundle.pieces || []).map((p) => String(p.part || '').trim()).filter(Boolean),
  )];

  return (
    <div className="rounded-xl border border-[#e8edf3] bg-white overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={`mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full ${bucketDot(bk)}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-semibold text-[#1e293b]">
              {bundle.family_id || bundle.unit_id?.slice(3, 11) || '—'}
            </span>
            {partTypes.map((pt) => (
              <span key={pt} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${partTypePill(pt)}`}>
                {pt}
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#64748b]">
            <span>{bundle.part_count || bundle.pieces?.length || 0} parts</span>
            <span className="font-semibold text-[#1e293b]">{fmt(bundle.total_weight_kg)} kg</span>
            <span>{fmt(bundle.total_sqft)} ft²</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {(bundle.pieces?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowParts((s) => !s)}
              className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1 text-[10px] text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
            >
              {showParts ? '▴ Hide' : '▾ Parts'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(crateId, bundle.unit_id)}
            className="rounded-lg border border-[#fee2e2] bg-[#fff5f5] px-2 py-1 text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors"
            title="Return to inventory"
          >
            Return
          </button>
        </div>
      </div>

      {showParts && (bundle.pieces?.length ?? 0) > 0 && (
        <div className="border-t border-[#f1f5f9] px-3 pt-2 pb-2.5">
          {bundle.pieces.map((p, i) => (
            <PartRowInCrate key={p.id ?? i} piece={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Warning chip ─────────────────────────────────────────────────────────────

function WarningChip({ text }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-amber-800">
      <span className="flex-shrink-0 mt-0.5 text-amber-500">⚠</span>
      <span>{text}</span>
    </div>
  );
}

// ─── Draft crate card ─────────────────────────────────────────────────────────

function DraftCrateCard({ crate, onRemoveBundle, onDeleteCrate }) {
  const [showContents, setShowContents] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dims = crate.dimensions;
  const ptm = crate.part_type_mix || {};
  const ptEntries = Object.entries(ptm).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const status = getCrateOperationalStatus(crate);
  const statusStyle = STATUS_STYLE[status] || STATUS_STYLE.READY;

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDeleteCrate(crate.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className="rounded-[24px] border border-[#dbe4f0] bg-white shadow-sm">
      {/* Crate header */}
      <div className="flex items-start gap-4 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base font-bold text-[#0f172a]">{crate.id}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusStyle.cls}`}>
              {statusStyle.label}
            </span>
            {crate.crate_class && CRATE_CLASS_STYLE[crate.crate_class] && (
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${CRATE_CLASS_STYLE[crate.crate_class].cls}`}>
                {CRATE_CLASS_STYLE[crate.crate_class].label}
              </span>
            )}
            {/* Full Part Type chips — no aliases, no shortened names */}
            {ptEntries.map(([pt, n]) => (
              <span key={pt} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${partTypePill(pt)}`}>
                {pt}{n > 1 ? ` ×${n}` : ''}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-[#64748b]">
            <span><strong className="text-[#0f172a]">{crate.part_count}</strong> parts</span>
            <span><strong className="text-[#0f172a]">{fmt(crate.total_weight_kg)}</strong> kg</span>
            <span><strong className="text-[#0f172a]">{fmt(crate.total_sqft)}</strong> ft²</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowContents((s) => !s)}
            className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f1f5f9] transition-colors whitespace-nowrap"
          >
            {showContents ? '▴ Hide contents' : '▾ View contents'}
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              confirmDelete
                ? 'border-red-500 bg-red-600 text-white font-bold hover:bg-red-700'
                : 'border-[#fee2e2] bg-[#fff5f5] text-red-500 hover:bg-red-50'
            }`}
          >
            {confirmDelete ? `Confirm delete ${crate.id}` : 'Delete'}
          </button>
          {confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f8fafc] transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Dimensions row */}
      {dims && (dims.internal_length > 0 || dims.external_length > 0) && (
        <div className="mx-5 mb-3 rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] mb-2">
            {crate.crate_class === 'island_vertical'
              ? 'Estimated dimensions — L × D × H (cassette, inches)'
              : 'Estimated dimensions — L × W × H (flat-lay, inches)'}
          </div>
          <DimBlock label="Internal" dims={dims} prefix="internal_" />
          <DimBlock label="External" dims={dims} prefix="external_" />
        </div>
      )}

      {/* Warnings */}
      {crate.warnings?.length > 0 && (
        <div className="mx-5 mb-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 space-y-1.5">
          {crate.warnings.map((w, i) => (
            <WarningChip key={i} text={w} />
          ))}
        </div>
      )}

      {/* Crate contents — groups + full piece rows */}
      {showContents && (
        <div className="border-t border-[#f1f5f9] px-5 pb-4 pt-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] mb-2">
            Crate contents — {crate.part_count} parts
          </div>
          <div className="space-y-2">
            {crate.bundles.map((b, i) => (
              <BundleInCrate
                key={b.unit_id || i}
                bundle={b}
                crateId={crate.id}
                onRemove={onRemoveBundle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary & Insights panel ─────────────────────────────────────────────────

const PART_TYPE_TO_CRATE_CLASS = {
  'Kitchen - Island Tops':     'island_vertical',
  'Kitchen - Perimeter Tops':  'kitchen_vertical',
  'Kitchen - Range Tops':      'kitchen_vertical',
  'Kitchen - Back Splash':     'kitchen_vertical',
  'Kitchen - Side Splash':     'kitchen_vertical',
  'Vanity - Top':              'vanity_vertical',
  'Vanity - Back Splash':      'vanity_vertical',
  'Vanity - Side Splash':      'vanity_vertical',
  'Misc - Full Height Splash': 'misc',
  'Misc - Window Sill':        'misc',
  'Misc - Bar Top':            'misc',
};

const CLASS_LABEL = {
  island_vertical:  'Island',
  kitchen_vertical: 'Kitchen',
  vanity_vertical:  'Vanity',
  misc:             'Misc',
};

function CratePlanSummary({ draftCrates, targetWeightKg }) {
  if (!draftCrates || draftCrates.length === 0) return null;

  const totalCrates   = draftCrates.length;
  const totalParts    = draftCrates.reduce((s, c) => s + (c.part_count || 0), 0);
  const totalWeight   = draftCrates.reduce((s, c) => s + (c.total_weight_kg || 0), 0);
  const totalSqft     = draftCrates.reduce((s, c) => s + (c.total_sqft || 0), 0);

  // Utilization per crate
  const utilizations  = draftCrates.map((c) => (c.total_weight_kg || 0) / targetWeightKg);
  const avgUtil       = utilizations.length > 0 ? utilizations.reduce((s, u) => s + u, 0) / utilizations.length : 0;

  // Warnings summary
  const overweight    = draftCrates.filter((c) => (c.total_weight_kg || 0) > targetWeightKg);
  const underloaded   = draftCrates.filter((c) => (c.total_weight_kg || 0) < 300);
  const withWarnings  = draftCrates.filter((c) => (c.warnings?.length || 0) > 0);

  // Crate type distribution
  const typeCounts = {};
  for (const c of draftCrates) {
    const lbl = CLASS_LABEL[c.crate_class] || 'Misc';
    typeCounts[lbl] = (typeCounts[lbl] || 0) + 1;
  }

  // Part Type distribution across entire plan
  const ptCounts = {};
  for (const c of draftCrates) {
    for (const [pt, n] of Object.entries(c.part_type_mix || {})) {
      ptCounts[pt] = (ptCounts[pt] || 0) + n;
    }
  }

  // Insights
  const heaviest   = draftCrates.reduce((a, b) => (b.total_weight_kg > a.total_weight_kg ? b : a), draftCrates[0]);
  const largest    = draftCrates.reduce((a, b) => (b.part_count > a.part_count ? b : a), draftCrates[0]);
  const mostSqft   = draftCrates.reduce((a, b) => (b.total_sqft > a.total_sqft ? b : a), draftCrates[0]);
  const leastFull  = draftCrates.reduce((a, b) => (b.total_weight_kg < a.total_weight_kg ? b : a), draftCrates[0]);
  const mixedCrates = draftCrates.filter((c) => {
    const classes = new Set(
      Object.keys(c.part_type_mix || {}).filter((k) => (c.part_type_mix[k] || 0) > 0).map((pt) => PART_TYPE_TO_CRATE_CLASS[pt] || 'misc'),
    );
    return classes.size > 1;
  });

  return (
    <div className="rounded-[24px] border border-[#dbe4f0] bg-white p-5 shadow-sm space-y-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Crate Plan Summary</div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Crates',        value: totalCrates },
          { label: 'Parts',         value: totalParts },
          { label: 'Total weight',  value: `${fmt(totalWeight)} kg` },
          { label: 'Total sq ft',   value: fmt(totalSqft) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[#94a3b8]">{label}</div>
            <div className="mt-1 text-lg font-semibold text-[#0f172a]">{value}</div>
          </div>
        ))}
      </div>

      {/* Utilization */}
      <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3">
        <div className="text-[10px] uppercase tracking-wide text-[#94a3b8] mb-2">
          Weight utilisation (target {fmt(targetWeightKg)} kg/crate)
        </div>
        <div className="flex flex-wrap gap-2">
          {draftCrates.map((c) => {
            const pct = Math.min(((c.total_weight_kg || 0) / targetWeightKg) * 100, 100);
            const bar = (c.total_weight_kg || 0) > targetWeightKg ? 'bg-red-400' : pct < 30 ? 'bg-amber-300' : 'bg-emerald-400';
            return (
              <div key={c.id} className="flex flex-col items-center gap-1 min-w-[48px]">
                <div className="w-full h-16 bg-[#e8edf3] rounded-lg overflow-hidden flex items-end">
                  <div className={`w-full ${bar} rounded-lg transition-all`} style={{ height: `${Math.max(pct, 4)}%` }} />
                </div>
                <span className="text-[9px] font-mono text-[#64748b]">{c.id}</span>
                <span className="text-[9px] text-[#94a3b8]">{fmt(c.total_weight_kg)} kg</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-[#64748b]">
          Avg utilisation: <strong className="text-[#0f172a]">{fmt(avgUtil * 100)}%</strong>
          {overweight.length > 0 && <span className="ml-3 text-red-600">{overweight.length} over target</span>}
          {underloaded.length > 0 && <span className="ml-3 text-amber-600">{underloaded.length} underloaded (&lt; 300 kg)</span>}
        </div>
      </div>

      {/* Distribution */}
      <div className="grid sm:grid-cols-2 gap-3">
        {/* Crate type distribution */}
        <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[#94a3b8] mb-2">Crate type distribution</div>
          <div className="space-y-1">
            {Object.entries(typeCounts).map(([t, n]) => (
              <div key={t} className="flex items-center justify-between text-xs">
                <span className="text-[#334155]">{t}</span>
                <span className="font-semibold text-[#0f172a]">{n}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Part type distribution */}
        <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[#94a3b8] mb-2">Part type distribution</div>
          <div className="space-y-1">
            {Object.entries(ptCounts).sort((a, b) => b[1] - a[1]).map(([pt, n]) => (
              <div key={pt} className="flex items-center justify-between text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${partTypePill(pt)}`}>{pt}</span>
                <span className="font-semibold text-[#0f172a]">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[#94a3b8] mb-2">Insights</div>
        <div className="space-y-1 text-sm text-[#334155]">
          <div>Heaviest crate: <strong className="text-[#0f172a]">{heaviest?.id}</strong> — {fmt(heaviest?.total_weight_kg)} kg</div>
          <div>Largest crate: <strong className="text-[#0f172a]">{largest?.id}</strong> — {largest?.part_count} parts</div>
          <div>Highest sq ft: <strong className="text-[#0f172a]">{mostSqft?.id}</strong> — {fmt(mostSqft?.total_sqft)} ft²</div>
          <div>Lightest crate: <strong className="text-[#0f172a]">{leastFull?.id}</strong> — {fmt(leastFull?.total_weight_kg)} kg</div>
          {withWarnings.length > 0 && (
            <div className="text-amber-700">
              {withWarnings.length} crate{withWarnings.length !== 1 ? 's' : ''} with warnings: {withWarnings.map((c) => c.id).join(', ')}
            </div>
          )}
          {mixedCrates.length > 0 && (
            <div className="text-violet-700">
              {mixedCrates.length} mixed-type crate{mixedCrates.length !== 1 ? 's' : ''}: {mixedCrates.map((c) => c.id).join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Draft crate workspace ────────────────────────────────────────────────────

const DraftCrateWorkspace = ({ draftCrates, onRemoveBundle, onDeleteCrate, onSavePlan, onDownloadXlsx, savedAt, targetWeightKg = 1900 }) => {
  const [showSummary, setShowSummary] = useState(false);

  if (!draftCrates || draftCrates.length === 0) return null;

  const globalTotals = draftCrates.reduce(
    (acc, c) => ({
      crates: acc.crates + 1,
      parts:  acc.parts  + c.part_count,
      weight: acc.weight + c.total_weight_kg,
      sqft:   acc.sqft   + c.total_sqft,
    }),
    { crates: 0, parts: 0, weight: 0, sqft: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Step 3 — Draft Crates</div>
          <div className="mt-0.5 text-xl font-semibold text-[#0f172a]">
            {draftCrates.length} Draft Crate{draftCrates.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Download button */}
          {onDownloadXlsx && (
            <button
              type="button"
              onClick={onDownloadXlsx}
              className="rounded-full border border-[#1d4ed8] bg-[#eff6ff] px-4 py-1.5 text-xs font-semibold text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors whitespace-nowrap"
            >
              Download XLSX
            </button>
          )}
          {/* Summary toggle */}
          <button
            type="button"
            onClick={() => setShowSummary((s) => !s)}
            className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-4 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f1f5f9] transition-colors whitespace-nowrap"
          >
            {showSummary ? 'Hide summary' : 'View summary'}
          </button>
          {/* Save button */}
          {onSavePlan && (
            <button
              type="button"
              onClick={onSavePlan}
              className="rounded-full border border-[#0f172a] bg-[#0f172a] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b] transition-colors whitespace-nowrap"
            >
              Save Crate Plan
            </button>
          )}
          {savedAt && (
            <span className="text-[11px] text-[#94a3b8]">
              Saved {new Date(savedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* Totals chips */}
          {[
            { l: 'Crates', v: globalTotals.crates                   },
            { l: 'Parts',  v: globalTotals.parts                    },
            { l: 'Weight', v: `${fmt(globalTotals.weight)} kg`      },
            { l: 'Sq ft',  v: fmt(globalTotals.sqft)                },
          ].map(({ l, v }) => (
            <span key={l} className="flex flex-col items-center rounded-xl border border-[#e8edf3] bg-white px-3 py-1.5 min-w-[64px] text-center">
              <span className="text-[9px] uppercase tracking-wide text-[#94a3b8]">{l}</span>
              <span className="text-sm font-semibold text-[#0f172a]">{v}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Summary & Insights panel */}
      {showSummary && (
        <CratePlanSummary draftCrates={draftCrates} targetWeightKg={targetWeightKg} />
      )}

      {/* Crate cards */}
      <div className="space-y-4">
        {draftCrates.map((c) => (
          <DraftCrateCard
            key={c.id}
            crate={c}
            onRemoveBundle={onRemoveBundle}
            onDeleteCrate={onDeleteCrate}
          />
        ))}
      </div>
    </div>
  );
};

export default DraftCrateWorkspace;
