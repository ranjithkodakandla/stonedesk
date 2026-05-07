import React, { useCallback, useState } from 'react';
import PartDrawer from './PartDrawer';

// ── Part options ────────────────────────────────────────────────────────────
const PART_OPTIONS = {
  Vanity:   ['Vanity Top', 'Back Splash', 'Side Splash', 'Main Top', 'Side Panel', 'Window Sill', 'Threshold'],
  Kitchen:  ['Kitchen Top', 'Back Splash', 'Side Splash', 'Island Top', 'Window Sill', 'Waterfall', 'Counter Extension', 'Range Top', 'Kitchen Perimeter', 'Kitchen Others'],
  Laundry:  ['Laundry Top', 'Back Splash', 'Side Splash', 'Window Sill', 'Threshold'],
  Island:   ['Island Top', 'Back Splash', 'Side Splash', 'Waterfall', 'Side Panel'],
  Splashes: ['Back Splash', 'Side Splash', 'Full Height Splash'],
  Hearth:   ['Hearth Surround', 'Hearth Slab', 'Mantle', 'Hearth Step', 'Side Panel'],
  Bar:      ['Bar Top', 'Bar Back Splash', 'Bar Side Splash'],
  Utility:  ['Utility Top', 'Shelf', 'Step Tread', 'Window Sill', 'Threshold'],
  Other:    ['Custom Part', 'Bar Top', 'Laundry Top', 'Other'],
};
const ALL_PART_OPTIONS = Object.values(PART_OPTIONS).flat();
const PART_CAT_MAP = {};
Object.entries(PART_OPTIONS).forEach(([cat, parts]) => parts.forEach(p => { PART_CAT_MAP[p] = cat; }));

// ── Row factory ─────────────────────────────────────────────────────────────
const DEFAULT_EDGE_MAP     = { top: 'none', bottom: 'none', left: 'none', right: 'none' };
const DEFAULT_RADIUS_CORNERS = { top_left: false, top_right: false, bottom_left: false, bottom_right: false };

const EMPTY_ROW = {
  part_no: '', part: '', length: '', width: '', thickness: '3CM', qty: 1,
  sink_type: 'No Sink', sink_cut: '-', tap_holes: '-', grooves: '-',
  edge: 'None', edge_area: '',
  edge_map: null,           // will be set in newRow()
  edge_polish_manual: '',
  radius: '-',
  radius_value: '',
  radius_corners: null,     // will be set in newRow()
  shape_type: '',
  notes: '',
  dest_qty_overrides: {},
  _partNoAuto: true,        // false when user manually edits Part #
};

let rowIdCounter = 1;
export const newRow = (defaultThickness = '3CM') => ({
  ...EMPTY_ROW,
  thickness: defaultThickness,
  edge_map: { ...DEFAULT_EDGE_MAP },
  radius_corners: { ...DEFAULT_RADIUS_CORNERS },
  dest_qty_overrides: {},
  _id: rowIdCounter++,
});

// Smart Part # increment: "1051-01" → "1051-02", "VS-203-04" → "VS-203-05"
const incrementPartNo = (partNo) => {
  const s = String(partNo || '');
  const m = s.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return s;
};

// Splash parts (Back Splash, Side Splash, etc.) get letter suffixes (A, B, C…)
export const isSplashPart = (part) => /splash/i.test(part || '');

// Reindex all _partNoAuto rows: splash → letter suffix (A,B,C), others → number suffix (01,02,03)
export const reindexAutoPartNos = (rows, drawingNo) => {
  let numIdx = 0, alphaIdx = 0;
  return rows.map(row => {
    if (!row._partNoAuto) return row;
    if (isSplashPart(row.part)) {
      alphaIdx++;
      return { ...row, part_no: drawingNo ? `${drawingNo}-${String.fromCharCode(64 + alphaIdx)}` : '' };
    } else {
      numIdx++;
      return { ...row, part_no: drawingNo ? `${drawingNo}-${String(numIdx).padStart(2, '0')}` : '' };
    }
  });
};

export const dupeRow = (row) => ({
  ...row,
  part_no: incrementPartNo(row.part_no),
  edge_map: row.edge_map ? { ...row.edge_map } : { ...DEFAULT_EDGE_MAP },
  radius_corners: row.radius_corners ? { ...row.radius_corners } : { ...DEFAULT_RADIUS_CORNERS },
  dest_qty_overrides: { ...(row.dest_qty_overrides || {}) },
  _id: rowIdCounter++,
});

// ── Calculations ─────────────────────────────────────────────────────────────
const calcSqft = (l, w, qty) => {
  const ll = Number(l) || 0, ww = Number(w) || 0, q = Number(qty) || 1;
  return ll > 0 && ww > 0 ? (ll * ww / 144) * q : 0;
};

const WEIGHT_FACTORS = {
  Granite: { '2CM': 5.5, '3CM': 7.5, Mixed: 6.5 },
  Quartz:  { '2CM': 4.75, '3CM': 6.75, Mixed: 5.75 },
  Marble:  { '2CM': 6.0, '3CM': 8.0, Mixed: 7.0 },
};

const calcWeight = (l, w, qty, material, rowThickness, projectThickness) => {
  const thick = rowThickness || projectThickness || '3CM';
  const f = (WEIGHT_FACTORS[material] || WEIGHT_FACTORS.Granite)[thick] || 7.5;
  return calcSqft(l, w, qty) * f;
};

const calcEdge = (l, w, area) => {
  const ll = Number(l) || 0, ww = Number(w) || 0;
  if (!ll || !ww || !area) return 0;
  if (area === '4 Sides' || area === 'Perimeter') return 2 * (ll + ww);
  if (area === '3 Sides') return 2 * Math.max(ll, ww) + Math.min(ll, ww);
  if (area === '2 Sides') return 2 * Math.max(ll, ww);
  if (area === '1 Side') return Math.max(ll, ww);
  return 0;
};

const calcEdgeFromMap = (l, w, edgeMap) => {
  const ll = Number(l) || 0, ww = Number(w) || 0;
  if (!ll || !ww) return 0;
  const em = edgeMap || {};
  return (em.top !== 'none' ? ll : 0) + (em.bottom !== 'none' ? ll : 0)
       + (em.left !== 'none' ? ww : 0) + (em.right !== 'none' ? ww : 0);
};

const edgeAreaFromMap = (edgeMap) => {
  const active = Object.values(edgeMap || {}).filter(v => v !== 'none').length;
  if (active === 4) return '4 Sides';
  if (active === 3) return '3 Sides';
  if (active === 2) return '2 Sides';
  if (active === 1) return '1 Side';
  return '';
};

// ── Compact grid badges ───────────────────────────────────────────────────
const SinkBadge = ({ row, onClick }) => {
  const hasSink = row.sink_type && row.sink_type !== 'No Sink';
  if (!hasSink) return <span className="text-[10px] text-slate-300 cursor-pointer select-none" onClick={onClick}>—</span>;
  const abbr = row.sink_type.replace('Single Bowl','Single').replace('Double Bowl','Double');
  return (
    <span onClick={onClick}
      className="inline-block text-[10px] font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-200 select-none leading-tight">
      {abbr}
    </span>
  );
};

const EdgeBadge = ({ row, onClick }) => {
  const hasMap = Object.values(row.edge_map || {}).some(v => v !== 'none');
  const hasEdge = hasMap || (row.edge && row.edge !== 'None');
  if (!hasEdge) return <span className="text-[10px] text-slate-300 cursor-pointer select-none" onClick={onClick}>—</span>;
  const sides = hasMap ? Object.values(row.edge_map).filter(v => v !== 'none').length : null;
  const label = sides != null ? `${row.edge !== 'None' ? row.edge : 'Edge'} · ${sides}s` : row.edge;
  return (
    <span onClick={onClick}
      className="inline-block text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-200 select-none leading-tight">
      {label}
    </span>
  );
};

// RadiusBadge is replaced by an inline input — kept only as a corner-count indicator
const CornersBadge = ({ row, onClick }) => {
  const n = Object.values(row.radius_corners || {}).filter(Boolean).length;
  if (!n) return <span className="text-[10px] text-slate-300 cursor-pointer select-none" onClick={onClick} title="Click to select corners">—</span>;
  return (
    <span onClick={onClick}
      className="inline-block text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-violet-200 select-none leading-tight"
      title="Click to edit corners">
      ×{n}
    </span>
  );
};

// ── PiecesGrid ──────────────────────────────────────────────────────────────
const PiecesGrid = ({ rows, setRows, material, thickness, defaultThickness, onCategoryDetected, destinations, category, drawingNo }) => {
  const [drawerRow, setDrawerRow] = useState(null);
  const [drawerScrollTo, setDrawerScrollTo] = useState(null);

  const openDrawer = (row, section = null) => {
    setDrawerRow(row);
    setDrawerScrollTo(section);
  };

  const updateRow = useCallback((id, field, value) => {
    setRows(prev => {
      const updated = prev.map(r => {
        if (r._id !== id) return r;
        const next = { ...r, [field]: value };
        if (field === 'part' && PART_CAT_MAP[value]) onCategoryDetected?.(PART_CAT_MAP[value]);
        if (field === 'part_no') next._partNoAuto = false; // user manually edited — protect from auto-updates
        return next;
      });
      // When description changes, reindex so splash/non-splash suffix updates immediately
      if (field === 'part') return reindexAutoPartNos(updated, drawingNo);
      return updated;
    });
  }, [setRows, onCategoryDetected, drawingNo]);

  const updateRowFull = useCallback((updated) => {
    setRows(prev => prev.map(r => r._id === updated._id ? updated : r));
    setDrawerRow(prev => prev?._id === updated._id ? updated : prev);
  }, [setRows]);

  const deleteRow = useCallback((id) => {
    setRows(prev => {
      if (prev.length <= 1) return prev;
      return reindexAutoPartNos(prev.filter(r => r._id !== id), drawingNo);
    });
    setDrawerRow(prev => prev?._id === id ? null : prev);
  }, [setRows, drawingNo]);

  const addRow = useCallback(() => {
    setRows(prev => reindexAutoPartNos([...prev, newRow(defaultThickness || thickness || '3CM')], drawingNo));
  }, [setRows, defaultThickness, thickness, drawingNo]);

  const duplicateRow = useCallback((id) => {
    setRows(prev => {
      const src = prev.find(r => r._id === id);
      if (!src) return prev;
      const copy = dupeRow(src);
      const next = [...prev];
      next.splice(prev.indexOf(src) + 1, 0, copy);
      return reindexAutoPartNos(next, drawingNo);
    });
  }, [setRows, drawingNo]);

  const handlePaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const parsed = lines.map(line => {
      const c = line.split('\t');
      const r = newRow();
      // Column order: Part #, Description, Length, Width, Thickness, Qty, Sink, Cuts, Taps, Grooves, Edge, Area, Radius, Notes
      r.part_no     = c[0]?.trim() || '';
      r._partNoAuto = !r.part_no; // treat as auto only if pasted Part # was empty
      r.part      = c[1]?.trim() || '';
      r.length    = c[2]?.trim() || '';
      r.width     = c[3]?.trim() || '';
      r.thickness = c[4]?.trim() || defaultThickness || thickness || '3CM';
      r.qty       = Number(c[5]?.trim()) || 1;
      r.sink_type = c[6]?.trim() || 'No Sink';
      r.sink_cut  = c[7]?.trim() || '-';
      r.tap_holes = c[8]?.trim() || '-';
      r.grooves   = c[9]?.trim() || '-';
      r.edge      = c[10]?.trim() || 'None';
      r.edge_area = c[11]?.trim() || '';
      r.radius    = c[12]?.trim() || '-';
      r.notes     = c[13]?.trim() || '';
      if (r.part && PART_CAT_MAP[r.part]) onCategoryDetected?.(PART_CAT_MAP[r.part]);
      return r;
    });
    if (parsed.length) {
      setRows(prev => {
        const empty = prev.length === 1 && !prev[0].part_no && !prev[0].part && !prev[0].length;
        return empty ? parsed : [...prev, ...parsed];
      });
    }
  }, [setRows, onCategoryDetected]);

  const totalSqft = rows.reduce((s, r) => s + calcSqft(r.length, r.width, r.qty), 0);
  const totalWt   = rows.reduce((s, r) => s + calcWeight(r.length, r.width, r.qty, material, r.thickness, thickness), 0);
  const totalQty  = rows.reduce((s, r) => s + (Number(r.qty) || 1), 0);

  return (
    <div className="mt-4">
      {/* Datalist filtered by active drawing category */}
      <datalist id="part-descriptions">
        {(PART_OPTIONS[category] || ALL_PART_OPTIONS).map(p => <option key={p} value={p} />)}
      </datalist>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-900">
          Pieces in this Drawing
          <span className="ml-2 text-xs font-normal text-slate-500">
            {rows.length} row{rows.length !== 1 ? 's' : ''} · {totalQty} pcs · {totalSqft.toFixed(1)} sqft · {totalWt.toFixed(0)} kg
          </span>
        </div>
        <button type="button" onClick={addRow}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          + Add Row
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-slate-200" onPaste={handlePaste}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left w-7 font-medium">#</th>
              <th className="px-2 py-2 text-left min-w-[108px] font-medium">Part #</th>
              <th className="px-2 py-2 text-left min-w-[130px] font-medium">Description</th>
              <th className="px-2 py-2 text-left w-12 font-medium">Qty</th>
              <th className="px-2 py-2 text-left w-16 font-medium">Length</th>
              <th className="px-2 py-2 text-left w-16 font-medium">Width</th>
              <th className="px-2 py-2 text-left w-16 font-medium">Thick.</th>
              <th className="px-2 py-2 text-left w-14 font-medium">Sq Ft</th>
              <th className="px-2 py-2 text-left w-14 font-medium">Wt kg</th>
              <th className="px-2 py-2 text-left w-20 font-medium">Sink</th>
              <th className="px-2 py-2 text-left w-24 font-medium">Edge</th>
              <th className="px-2 py-2 text-left w-24 font-medium">Radius</th>
              <th className="px-2 py-2 text-left min-w-[90px] font-medium">Notes</th>
              <th className="px-2 py-2 w-24 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const sqft = calcSqft(row.length, row.width, row.qty);
              const wt   = calcWeight(row.length, row.width, row.qty, material, row.thickness, thickness);
              const isActive = drawerRow?._id === row._id;

              return (
                <tr key={row._id}
                  className={`border-t border-slate-100 ${isActive ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>

                  <td className="px-2 py-1 text-slate-400">{idx + 1}</td>

                  {/* Part # — free text, monospace, critical */}
                  <td className="px-1 py-1">
                    <input
                      value={row.part_no || ''}
                      onChange={e => updateRow(row._id, 'part_no', e.target.value)}
                      className="grid-cell font-mono"
                      placeholder="1051-01"
                      title="Manual part number (e.g., 1051-01, KITCH-A-01)"
                    />
                  </td>

                  {/* Description — text with datalist suggestions */}
                  <td className="px-1 py-1">
                    <input
                      list="part-descriptions"
                      value={row.part || ''}
                      onChange={e => updateRow(row._id, 'part', e.target.value)}
                      className="grid-cell"
                      placeholder="Vanity Top…"
                    />
                  </td>

                  <td className="px-1 py-1">
                    <input type="number" min="1" value={row.qty}
                      onChange={e => updateRow(row._id, 'qty', e.target.value)} className="grid-cell" />
                  </td>

                  <td className="px-1 py-1">
                    <input type="number" step="0.125" value={row.length}
                      onChange={e => updateRow(row._id, 'length', e.target.value)} className="grid-cell" placeholder="L" />
                  </td>

                  <td className="px-1 py-1">
                    <input type="number" step="0.125" value={row.width}
                      onChange={e => updateRow(row._id, 'width', e.target.value)} className="grid-cell" placeholder="W" />
                  </td>

                  <td className="px-1 py-1">
                    <select
                      value={row.thickness || '3CM'}
                      onChange={e => updateRow(row._id, 'thickness', e.target.value)}
                      className="grid-cell text-[11px]">
                      <option>2CM</option>
                      <option>3CM</option>
                      <option>Mixed</option>
                    </select>
                  </td>

                  <td className="px-2 py-1 text-slate-500 tabular-nums">{sqft > 0 ? sqft.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1 text-slate-500 tabular-nums">{wt > 0 ? wt.toFixed(0) : '—'}</td>

                  <td className="px-2 py-1">
                    <SinkBadge row={row} onClick={() => openDrawer(row, 'sink')} />
                  </td>
                  <td className="px-2 py-1">
                    <EdgeBadge row={row} onClick={() => openDrawer(row, 'edge')} />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={row.radius_value || ''}
                        onChange={e => updateRow(row._id, 'radius_value', e.target.value)}
                        className="grid-cell w-14"
                        placeholder="R"
                        title="Radius in inches"
                      />
                      <CornersBadge row={row} onClick={() => openDrawer(row, 'radius')} />
                    </div>
                  </td>

                  <td className="px-1 py-1">
                    <input value={row.notes || ''} onChange={e => updateRow(row._id, 'notes', e.target.value)}
                      className="grid-cell" placeholder="Notes…" />
                  </td>

                  {/* Actions */}
                  <td className="px-1 py-1">
                    <div className="flex gap-1 items-center">
                      <button type="button" onClick={() => openDrawer(row)}
                        title="Open advanced details"
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors
                          ${isActive
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'}`}>
                        {isActive ? '◀ Open' : 'Edit ›'}
                      </button>
                      <button type="button" onClick={() => duplicateRow(row._id)} title="Duplicate row"
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100">
                        ⧉
                      </button>
                      <button type="button" onClick={() => deleteRow(row._id)} title="Delete row"
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-50">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-1 text-[10px] text-slate-400">
        Paste from Excel: <span className="font-mono">Part #, Description, Length, Width, Thickness, Qty, Sink, Cuts, Taps, Grooves, Edge, Area, Radius, Notes</span>
        &nbsp;— then paste anywhere in the grid. Click <span className="font-medium">Edit ›</span> or any badge to open advanced details.
      </p>

      {/* Part Details Drawer */}
      {drawerRow && (
        <PartDrawer
          row={drawerRow}
          destinations={destinations}
          onUpdate={updateRowFull}
          onClose={() => setDrawerRow(null)}
          scrollTo={drawerScrollTo}
        />
      )}
    </div>
  );
};

export { PART_CAT_MAP, calcEdge, calcEdgeFromMap, edgeAreaFromMap };
export default PiecesGrid;
