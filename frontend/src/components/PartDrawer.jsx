import React, { useState, useEffect, useRef } from 'react';
import { edgeAreaFromMap } from './PiecesGrid';

const EDGE_OPTIONS = ['none', 'polished', 'cut', 'manual'];
const EDGE_LABELS = { none: '—', polished: 'Polish', cut: 'Cut', manual: 'Manual' };
const EDGE_COLORS = {
  none: 'bg-slate-100 text-slate-400 border-slate-200',
  polished: 'bg-blue-100 text-blue-700 border-blue-300',
  cut: 'bg-amber-100 text-amber-700 border-amber-300',
  manual: 'bg-emerald-100 text-emerald-700 border-emerald-300',
};

const DEFAULT_EDGE_MAP = { top: 'none', bottom: 'none', left: 'none', right: 'none' };
const DEFAULT_RADIUS_CORNERS = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };

const Section = ({ id, title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
        <span>{title}</span>
        <span className="text-slate-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 space-y-0">{children}</div>}
    </div>
  );
};

const PartDrawer = ({ row, destinations, onUpdate, onClose, scrollTo }) => {
  const bodyRef = useRef(null);

  const hydrate = (r) => ({
    ...r,
    edge_map: (r.edge_map && Object.keys(r.edge_map).length) ? r.edge_map : { ...DEFAULT_EDGE_MAP },
    radius_corners: (r.radius_corners && Object.keys(r.radius_corners).length) ? r.radius_corners : { ...DEFAULT_RADIUS_CORNERS },
    radius_value: r.radius_value ?? '',
    shape_type: r.shape_type ?? '',
    edge_polish_manual: r.edge_polish_manual ?? '',
    dest_qty_overrides: r.dest_qty_overrides ?? {},
  });

  const [local, setLocal] = useState(() => hydrate(row));

  useEffect(() => {
    setLocal(hydrate(row));
    if (scrollTo && bodyRef.current) {
      setTimeout(() => {
        const el = bodyRef.current?.querySelector(`#section-${scrollTo}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [row._id, scrollTo]);

  const push = (next) => { setLocal(next); };
  const set = (k, v) => push({ ...local, [k]: v });
  const setEdge = (side, v) => {
    const newEdgeMap = { ...local.edge_map, [side]: v };
    push({ ...local, edge_map: newEdgeMap, edge_area: edgeAreaFromMap(newEdgeMap) });
  };
  const setCorner = (c, v) => push({ ...local, radius_corners: { ...local.radius_corners, [c]: v } });
  const setDestQty = (key, v) => {
    const overrides = { ...local.dest_qty_overrides };
    if (v === '' || v == null) delete overrides[key];
    else overrides[key] = Number(v);
    push({ ...local, dest_qty_overrides: overrides });
  };

  const em = local.edge_map || DEFAULT_EDGE_MAP;
  const rc = local.radius_corners || DEFAULT_RADIUS_CORNERS;
  const activeSides = Object.values(em).filter(v => v !== 'none').length;
  const activeCorners = Object.values(rc).filter(Boolean).length;
  const L = Number(local.length) || 0;
  const W = Number(local.width) || 0;

  const EdgeBtn = ({ side, label }) => {
    const val = em[side] || 'none';
    const cycle = () => setEdge(side, EDGE_OPTIONS[(EDGE_OPTIONS.indexOf(val) + 1) % EDGE_OPTIONS.length]);
    return (
      <button type="button" onClick={cycle}
        className={`text-[11px] font-medium border rounded-md px-3 py-2 transition-all select-none text-center ${EDGE_COLORS[val]}`}>
        <div className="text-[9px] font-normal opacity-70">{label}</div>
        <div className="font-bold">{EDGE_LABELS[val]}</div>
      </button>
    );
  };

  const CornerChk = ({ corner, label }) => (
    <label className={`flex items-center gap-2 text-xs font-medium cursor-pointer px-3 py-2.5 rounded-lg border transition-all
      ${rc[corner] ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
      <input type="checkbox" checked={rc[corner] || false} onChange={e => setCorner(corner, e.target.checked)}
        className="accent-violet-600 w-3.5 h-3.5" />
      {label}
    </label>
  );

  const validDests = (destinations || []).filter(d => d.building || d.floor || d.flat);
  const handleSave = () => {
    onUpdate?.(local);
    onClose?.();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">Part Details</span>
              {local.part_no && (
                <span className="font-mono text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{local.part_no}</span>
              )}
            </div>
            {local.part && <div className="text-xs text-slate-500 mt-0.5">{local.part}</div>}
            <div className="text-[10px] text-slate-400 mt-1">Matrix family review updates this same part row.</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors text-base">
            ✕
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">

          {/* Section 1 — Sink */}
          <Section id="section-sink" title="Sink">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-text">Sink Type</label>
                <select value={local.sink_type || 'No Sink'} onChange={e => set('sink_type', e.target.value)} className="input-field">
                  <option>No Sink</option>
                  <option>Single Bowl</option>
                  <option>Double Bowl</option>
                  <option>ADA</option>
                  <option>PL-VS3018</option>
                  <option>PL-3639</option>
                </select>
              </div>
              <div>
                <label className="label-text">Sink Cutouts #</label>
                <select value={local.sink_cut || '-'} onChange={e => set('sink_cut', e.target.value)} className="input-field">
                  {['-','0','1','2','3'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label-text">Tap Holes #</label>
                <select value={local.tap_holes || '-'} onChange={e => set('tap_holes', e.target.value)} className="input-field">
                  {['-','0','1','2','3','4','5','6'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label-text">Sink Grooves</label>
                <select value={local.grooves || '-'} onChange={e => set('grooves', e.target.value)} className="input-field">
                  {['-','0','1','2','3','4'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </Section>

          {/* Section 2 — Edge Polish */}
          <Section id="section-edge" title="Edge Polish">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Edge Type</label>
                  <select value={local.edge || 'None'} onChange={e => set('edge', e.target.value)} className="input-field">
                    <option>None</option>
                    <option>Machine</option>
                    <option>Manual</option>
                    <option>Both</option>
                  </select>
                </div>
                <div>
                  <label className="label-text">Sides</label>
                  <select value={local.edge_area || ''} onChange={e => set('edge_area', e.target.value)} className="input-field">
                    <option value="">—</option>
                    <option>4 Sides</option>
                    <option>3 Sides</option>
                    <option>2 Sides</option>
                    <option>1 Side</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label-text">Manual Polish Note</label>
                <input value={local.edge_polish_manual || ''} onChange={e => set('edge_polish_manual', e.target.value)}
                  className="input-field" placeholder="e.g., Ogee profile on front edge" />
              </div>
            </div>
          </Section>

          {/* Section 3 — Edge Dimensions */}
          <Section id="section-edge-dims" title="Edge Dimensions">
            <p className="text-[11px] text-slate-500 mb-4">Click a side to cycle: — → Polish → Cut → Manual → —<br />Top/Bottom = Length side. Left/Right = Width side.</p>
            <div className="flex flex-col items-center gap-2">
              <EdgeBtn side="top" label={`Top  (L${L > 0 ? ` = ${L.toFixed(1)}"` : ''})`} />
              <div className="flex items-stretch gap-2 w-full">
                <EdgeBtn side="left" label={`Left  (W${W > 0 ? ` = ${W.toFixed(1)}"` : ''})`} />
                <div className="flex-1 min-h-[64px] rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400 font-mono">
                  {L > 0 && W > 0 ? `${L.toFixed(1)}" × ${W.toFixed(1)}"` : 'PIECE'}
                </div>
                <EdgeBtn side="right" label={`Right  (W${W > 0 ? ` = ${W.toFixed(1)}"` : ''})`} />
              </div>
              <EdgeBtn side="bottom" label={`Bottom  (L${L > 0 ? ` = ${L.toFixed(1)}"` : ''})`} />
            </div>
            {activeSides > 0 && (
              <p className="mt-3 text-xs text-blue-600 font-medium">{activeSides} side{activeSides !== 1 ? 's' : ''} configured</p>
            )}
          </Section>

          {/* Section 4 — Radius / Corners */}
          <Section id="section-radius" title="Radius / Corners">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Radius (inches)</label>
                  <input type="number" step="0.25" min="0" value={local.radius_value || ''}
                    onChange={e => set('radius_value', e.target.value)} className="input-field" placeholder="e.g., 1.5" />
                </div>
                <div>
                  <label className="label-text">Active Corners</label>
                  <div className="input-field bg-slate-50 text-slate-600 text-center select-none">
                    {activeCorners > 0 ? activeCorners : '—'}
                  </div>
                </div>
              </div>
              <div>
                <label className="label-text block mb-2">Corner Selection</label>
                <div className="grid grid-cols-2 gap-2">
                  <CornerChk corner="top_left"     label="↖ Top Left" />
                  <CornerChk corner="top_right"    label="↗ Top Right" />
                  <CornerChk corner="bottom_left"  label="↙ Bottom Left" />
                  <CornerChk corner="bottom_right" label="↘ Bottom Right" />
                </div>
                {activeCorners > 0 && local.radius_value && (
                  <p className="mt-2 text-xs text-violet-600 font-medium">
                    R{local.radius_value}" applied to {activeCorners} corner{activeCorners !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Section 5 — Shape */}
          <Section id="section-shape" title="Shape" defaultOpen={false}>
            <div>
              <label className="label-text">Shape Type</label>
              <select value={local.shape_type || ''} onChange={e => set('shape_type', e.target.value)} className="input-field">
                <option value="">Rectangle (default)</option>
                <option>L-Shape</option>
                <option>U-Shape</option>
                <option>Ogee</option>
                <option>Custom</option>
              </select>
            </div>
          </Section>

          {/* Destination Qty Overrides */}
          {validDests.length > 0 && (
            <Section id="section-dest" title="Matrix Family / Destination Review" defaultOpen={false}>
              <p className="text-[11px] text-slate-500 mb-3">
                Override qty per destination. Leave blank to use default qty
                <span className="font-bold text-slate-700"> ({local.qty ?? 1})</span>.
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {validDests.map(dest => {
                  const key = [dest.building, dest.floor, dest.flat].filter(Boolean).join('/');
                  const label = [
                    dest.building && `Bldg ${dest.building}`,
                    dest.floor    && `Fl ${dest.floor}`,
                    dest.flat     && `Flat ${dest.flat}`,
                  ].filter(Boolean).join(' · ');
                  const override = (local.dest_qty_overrides || {})[key];
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 flex-1 truncate">{label}</span>
                      <input type="number" min="0" value={override ?? ''}
                        onChange={e => setDestQty(key, e.target.value)}
                        className="input-field w-16 text-center text-xs py-1"
                        placeholder={local.qty ?? 1} />
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Notes */}
          <Section id="section-notes" title="Notes">
            <textarea value={local.notes || ''} onChange={e => set('notes', e.target.value)}
              className="input-field resize-none w-full" rows={3}
              placeholder="Special instructions, part notes..." />
          </Section>

        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            Changes are applied when you click Save.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-primary bg-white text-slate-700 border border-slate-200 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} className="btn-primary">
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PartDrawer;
