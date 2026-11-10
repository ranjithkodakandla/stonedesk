import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// A plain, labeled row-by-row view of exactly what the backend packing
// schedule says — modeled directly on the factory's own packing drawings
// (see the Kitchen And Range Tops reference: one line per row, dimensions
// and quantity spelled out). Deliberately NOT a 3D scene or a generic
// decorative box: every row/dimension here comes straight from
// GET /projects/{id}/crates/{id}/packing-schedule, which is derived from
// the crate's actual persisted piece assignment — if this view is wrong,
// the underlying plan is wrong, there is nothing separate to go stale.
const LAYER_LABELS = { main: 'Countertop' };
export const layerLabel = (layer) => LAYER_LABELS[layer] || (layer.startsWith('splash_') ? `Splash (layer ${layer.split('_')[1]})` : layer);

export const fmtDim = (d) => {
  const l = d.length != null ? `${Number(d.length).toFixed(1)}"` : '—';
  const w = d.width != null ? `${Number(d.width).toFixed(1)}"` : '—';
  const t = d.thickness || '';
  return `${l} × ${w}${t ? ` × ${t}` : ''}`;
};

const CratePackingSchedule = ({ projectId, crateId, crateLabel }) => {
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !crateId) { setSchedule(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios.get(`${API_BASE}/projects/${projectId}/crates/${crateId}/packing-schedule`)
      .then((res) => { if (!cancelled) setSchedule(res.data); })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.detail || 'Failed to load packing schedule.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, crateId]);

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading packing schedule…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;
  if (!schedule || !schedule.rows?.length) return <div className="p-4 text-sm text-slate-400">No packing schedule for this crate yet.</div>;

  const { rows, unassigned_piece_ids: unassigned } = schedule;
  const maxLen = Math.max(1, ...rows.flatMap((r) => r.dimensions.map((d) => Number(d.length) || 0)));

  return (
    <div className="space-y-4">
      {/* Elevation: one labeled band per row, proportional to its pieces' lengths
          — the same shape as the reference packing drawing's side view. */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b] mb-3">
          Crate {crateLabel || schedule.crate_id} — packing elevation
        </div>
        <div className="space-y-1">
          {rows.map((row) => (
            <div key={row.row} className="flex items-center gap-2 text-xs">
              <div className="w-20 shrink-0 text-right font-mono text-[#64748b]">
                Row {row.row}{row.layer !== 'main' ? ` · ${layerLabel(row.layer)}` : ''}
              </div>
              <div className="flex-1 flex gap-1 h-8">
                {row.dimensions.map((d) => (
                  <div
                    key={d.piece_id}
                    className="h-full border border-[#1d4ed8]/40 bg-[#dbeafe] flex items-center justify-center text-[10px] font-medium text-[#1e3a8a] overflow-hidden whitespace-nowrap"
                    style={{ flexGrow: Math.max(1, Number(d.length) || 1), minWidth: 28 }}
                    title={`${d.part_no || d.piece_id}: ${fmtDim(d)}`}
                  >
                    {fmtDim(d)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Schedule table: Row / Layer / Piece / Dimensions / Qty / Sequence. */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#e2e8f0] text-[#64748b]">
              <th className="py-2 px-3">Row</th>
              <th className="py-2 px-3">Layer</th>
              <th className="py-2 px-3">Piece(s)</th>
              <th className="py-2 px-3">Dimensions</th>
              <th className="py-2 px-3">Qty</th>
              <th className="py-2 px-3">Sequence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row} className="border-b border-[#f1f5f9]">
                <td className="py-2 px-3 font-mono">{row.row}</td>
                <td className="py-2 px-3">{layerLabel(row.layer)}</td>
                <td className="py-2 px-3 font-mono">{row.dimensions.map((d) => d.part_no || d.piece_id).join(', ')}</td>
                <td className="py-2 px-3">{row.dimensions.map((d) => fmtDim(d)).join(' + ')}</td>
                <td className="py-2 px-3">{row.quantity}</td>
                <td className="py-2 px-3">{row.sequence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unassigned?.length > 0 && (
        <p className="text-xs text-amber-600">
          {unassigned.length} piece{unassigned.length === 1 ? '' : 's'} referenced by this crate could not be found and are not shown above — regenerate the plan.
        </p>
      )}
    </div>
  );
};

export default CratePackingSchedule;
