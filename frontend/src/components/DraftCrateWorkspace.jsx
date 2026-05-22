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

// ─── Category styles (shared subset) ─────────────────────────────────────────

const CAT = {
  island:    { label: 'Island',   pill: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500'   },
  perimeter: { label: 'Kitchen',  pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  range:     { label: 'Range',    pill: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500'  },
  vanity:    { label: 'Vanity',   pill: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  misc:      { label: 'Misc',     pill: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400'  },
};
const C = (cat) => CAT[cat] || CAT.misc;

function fmt(n, d = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ─── Dimension display row ────────────────────────────────────────────────────

function DimBlock({ label, dims, prefix }) {
  if (!dims || !dims[`${prefix}length`]) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[#94a3b8] w-16 flex-shrink-0">{label}</span>
      <span className="font-mono text-sm text-[#334155]">
        {fmt(dims[`${prefix}length`], 1)} × {fmt(dims[`${prefix}width`], 1)} × {fmt(dims[`${prefix}height`], 1)}″
      </span>
    </div>
  );
}

// ─── Part row inside bundle ───────────────────────────────────────────────────

function PartRowInCrate({ piece }) {
  const isMain = piece.role === 'main';
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-[#f8fafc] last:border-0">
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
      </span>
      <span className="text-[11px] font-medium text-[#334155] flex-shrink-0 whitespace-nowrap">
        {fmt(piece.weight_kg)} kg
      </span>
    </div>
  );
}

// ─── Bundle row inside draft crate ───────────────────────────────────────────

function BundleInCrate({ bundle, crateId, onRemove }) {
  const [showParts, setShowParts] = useState(false);
  const st = C(bundle.category);

  return (
    <div className="rounded-xl border border-[#e8edf3] bg-white overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${st.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-semibold text-[#1e293b]">
              {bundle.family_id || bundle.unit_id?.slice(3, 11) || '—'}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.pill}`}>
              {st.label}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#64748b]">
            {bundle.main_count > 0 && <span>{bundle.main_count} top{bundle.main_count !== 1 ? 's' : ''}</span>}
            {bundle.splash_count > 0 && <span className="text-amber-600">+{bundle.splash_count} splash</span>}
            <span className="font-semibold text-[#1e293b]">{fmt(bundle.total_weight_kg)} kg</span>
            <span>{fmt(bundle.total_sqft, 1)} ft²</span>
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
            title="Return bundle to inventory"
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
  const [showBundles, setShowBundles] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dims = crate.dimensions;
  const catEntries = Object.entries(crate.category_mix || {}).filter(([, n]) => n > 0);
  const status = getCrateOperationalStatus(crate);
  const statusStyle = STATUS_STYLE[status] || STATUS_STYLE.READY;

  return (
    <div className="rounded-[24px] border border-[#dbe4f0] bg-white shadow-sm overflow-hidden">
      {/* Crate header */}
      <div className="flex items-start gap-4 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base font-bold text-[#0f172a]">{crate.id}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusStyle.cls}`}>
              {statusStyle.label}
            </span>
            {catEntries.map(([cat, n]) => (
              <span key={cat} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${C(cat).pill}`}>
                {C(cat).label}{n > 1 ? ` ×${n}` : ''}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-[#64748b]">
            <span><strong className="text-[#0f172a]">{crate.bundle_count}</strong> bundle{crate.bundle_count !== 1 ? 's' : ''}</span>
            <span><strong className="text-[#0f172a]">{crate.part_count}</strong> parts</span>
            <span><strong className="text-[#0f172a]">{fmt(crate.total_weight_kg)}</strong> kg</span>
            <span><strong className="text-[#0f172a]">{fmt(crate.total_sqft, 0)}</strong> ft²</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowBundles((s) => !s)}
            className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f1f5f9] transition-colors"
          >
            {showBundles ? '▴ Hide contents' : '▾ View contents'}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { onDeleteCrate(crate.id); setConfirmDelete(false); }}
                className="rounded-full border border-red-300 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-[#e2e8f0] px-3 py-1.5 text-xs text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-full border border-[#fee2e2] bg-[#fff5f5] px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Dimensions row */}
      {dims && (dims.internal_length > 0 || dims.external_length > 0) && (
        <div className="mx-5 mb-3 rounded-2xl border border-[#e8edf3] bg-[#f8fafc] px-4 py-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] mb-2">
            Estimated dimensions — L × D × H (inches)
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

      {/* Bundle contents */}
      {showBundles && (
        <div className="border-t border-[#f1f5f9] px-5 pb-4 pt-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] mb-2">
            Bundles in crate
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

// ─── Draft crate workspace ────────────────────────────────────────────────────

const DraftCrateWorkspace = ({ draftCrates, onRemoveBundle, onDeleteCrate }) => {
  if (!draftCrates || draftCrates.length === 0) return null;

  const globalTotals = draftCrates.reduce(
    (acc, c) => ({
      crates:  acc.crates  + 1,
      bundles: acc.bundles + c.bundle_count,
      parts:   acc.parts   + c.part_count,
      weight:  acc.weight  + c.total_weight_kg,
    }),
    { crates: 0, bundles: 0, parts: 0, weight: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Step 3 — Draft Crates</div>
          <div className="mt-0.5 text-xl font-semibold text-[#0f172a]">
            {draftCrates.length} Draft Crate{draftCrates.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-right">
          {[
            { l: 'Crates',  v: globalTotals.crates  },
            { l: 'Bundles', v: globalTotals.bundles },
            { l: 'Parts',   v: globalTotals.parts   },
            { l: 'Weight',  v: `${fmt(globalTotals.weight)} kg` },
          ].map(({ l, v }) => (
            <span key={l} className="flex flex-col items-center rounded-xl border border-[#e8edf3] bg-white px-3 py-1.5 min-w-[64px] text-center">
              <span className="text-[9px] uppercase tracking-wide text-[#94a3b8]">{l}</span>
              <span className="text-sm font-semibold text-[#0f172a]">{v}</span>
            </span>
          ))}
        </div>
      </div>

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
