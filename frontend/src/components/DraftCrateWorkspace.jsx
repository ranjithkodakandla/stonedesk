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
        {fmt(piece.weight_kg, 1)} kg
      </span>
      {/* Sqft */}
      <span className="self-center text-[11px] text-[#64748b] whitespace-nowrap">
        {fmt(piece.sqft, 1)} ft²
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
            <span className="font-semibold text-[#1e293b]">{fmt(bundle.total_weight_kg, 1)} kg</span>
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
            <span><strong className="text-[#0f172a]">{fmt(crate.total_weight_kg, 1)}</strong> kg</span>
            <span><strong className="text-[#0f172a]">{fmt(crate.total_sqft, 1)}</strong> ft²</span>
          </div>
        </div>

        {/* Actions — only toggle + delete trigger (no confirm here) */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowContents((s) => !s)}
            className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f1f5f9] transition-colors whitespace-nowrap"
          >
            {showContents ? '▴ Hide contents' : '▾ View contents'}
          </button>
          {!confirmDelete && (
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

      {/* Delete confirmation — own full-width row, impossible to clip */}
      {confirmDelete && (
        <div className="mx-5 mb-3 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="flex-1 text-sm font-medium text-red-900">
            Delete {crate.id}? All parts return to inventory.
          </span>
          <button
            type="button"
            onClick={() => { onDeleteCrate(crate.id); setConfirmDelete(false); }}
            className="rounded-full border border-red-400 bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition-colors whitespace-nowrap"
          >
            Confirm delete {crate.id}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#f8fafc] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

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

// ─── Draft crate workspace ────────────────────────────────────────────────────

const DraftCrateWorkspace = ({ draftCrates, onRemoveBundle, onDeleteCrate, onSavePlan, savedAt }) => {
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
            { l: 'Crates', v: globalTotals.crates                    },
            { l: 'Parts',  v: globalTotals.parts                     },
            { l: 'Weight', v: `${fmt(globalTotals.weight, 1)} kg`    },
            { l: 'Sq ft',  v: fmt(globalTotals.sqft, 1)              },
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
