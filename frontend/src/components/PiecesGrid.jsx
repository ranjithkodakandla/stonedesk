import React, { useCallback, useMemo, useRef, useState } from 'react';
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
const PART_CAT_MAP = {
  'Vanity Top': 'Vanity',
  'Kitchen Top': 'Kitchen',
  'Island Top': 'Island',
  'Laundry Top': 'Laundry',
  'Hearth Surround': 'Hearth',
  'Hearth Slab': 'Hearth',
  Mantle: 'Hearth',
  'Hearth Step': 'Hearth',
  'Bar Top': 'Bar',
  'Bar Back Splash': 'Bar',
  'Bar Side Splash': 'Bar',
  'Utility Top': 'Utility',
  Shelf: 'Utility',
  'Step Tread': 'Utility',
  'Counter Extension': 'Kitchen',
  'Range Top': 'Kitchen',
  'Kitchen Perimeter': 'Kitchen',
  'Kitchen Others': 'Kitchen',
  'Custom Part': 'Other',
  Other: 'Other',
};

const PART_THICKNESS_HINTS = [
  [/window sill/i, '2CM'],
  [/back splash/i, '2CM'],
  [/side splash/i, '2CM'],
  [/full height splash/i, '2CM'],
  [/splash/i, '2CM'],
  [/kitchen/i, '3CM'],
  [/island/i, '3CM'],
  [/vanity/i, '3CM'],
];

const suggestThicknessForPart = (part = '', category = '') => {
  const text = `${part || ''} ${category || ''}`.trim();
  for (const [pattern, thickness] of PART_THICKNESS_HINTS) {
    if (pattern.test(text)) return thickness;
  }
  return '';
};

export const MASTER_DESCRIPTIONS = [
  'Island Tops', 'Perimeter Kitchen Tops', 'Range Tops',
  'Kitchen Back Splash', 'Kitchen Side Splash',
  'Vanity Top', 'Vanity Back Splash', 'Vanity Side Splash',
  'Full Height Splash', 'Window Sill', 'Bar Top',
];

export const DEFAULT_THICKNESS_MAP = {
  'Island Tops': '3CM',
  'Perimeter Kitchen Tops': '3CM',
  'Range Tops': '3CM',
  'Kitchen Back Splash': '2CM',
  'Kitchen Side Splash': '2CM',
  'Vanity Top': '3CM',
  'Vanity Back Splash': '2CM',
  'Vanity Side Splash': '2CM',
  'Full Height Splash': '2CM',
  'Window Sill': '2CM',
  'Bar Top': '3CM',
};

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
const getAutoPrefix = (drawingNo) => (drawingNo ? `${drawingNo}-` : '');

const parseAutoPartNo = (partNo, drawingNo) => {
  const prefix = getAutoPrefix(drawingNo);
  if (!prefix || !String(partNo || '').startsWith(prefix)) return null;
  const suffix = String(partNo).slice(prefix.length);
  if (/^\d+$/.test(suffix)) return { kind: 'num', value: Number(suffix), width: suffix.length };
  if (/^[A-Z]$/.test(suffix)) return { kind: 'alpha', value: suffix.charCodeAt(0) - 64 };
  return null;
};

export const reindexAutoPartNos = (rows, drawingNo, options = {}) => {
  const forceReassign = Boolean(options.forceReassign);
  const prefix = getAutoPrefix(drawingNo);
  if (!prefix) return rows.map(row => (row._partNoAuto ? { ...row, part_no: '' } : row));

  if (forceReassign) {
    let numIdx = 0;
    let alphaIdx = 0;
    return rows.map(row => {
      if (!row._partNoAuto) return row;
      if (isSplashPart(row.part)) {
        alphaIdx += 1;
        return { ...row, part_no: `${prefix}${String.fromCharCode(64 + alphaIdx)}` };
      }
      numIdx += 1;
      return { ...row, part_no: `${prefix}${String(numIdx).padStart(2, '0')}` };
    });
  }

  let maxNum = 0;
  let maxAlpha = 0;
  rows.forEach(row => {
    if (!row._partNoAuto) return;
    const parsed = parseAutoPartNo(row.part_no, drawingNo);
    if (parsed?.kind === 'num') maxNum = Math.max(maxNum, parsed.value);
    if (parsed?.kind === 'alpha') maxAlpha = Math.max(maxAlpha, parsed.value);
  });

  return rows.map(row => {
    if (!row._partNoAuto) return row;
    const parsed = parseAutoPartNo(row.part_no, drawingNo);
    if (parsed) return row;
    if (isSplashPart(row.part)) {
      maxAlpha += 1;
      return { ...row, part_no: `${prefix}${String.fromCharCode(64 + maxAlpha)}` };
    }
    maxNum += 1;
    return { ...row, part_no: `${prefix}${String(maxNum).padStart(2, '0')}` };
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
  const thick = projectThickness || rowThickness || '3CM';
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

// ── Description Combobox ─────────────────────────────────────────────────────
const DescriptionCombobox = ({ value, onChange, options, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: Math.max(r.width, 200) });
    }
    setDraft('');
    setOpen(true);
  };

  const handleChange = (e) => {
    setDraft(e.target.value);
    onChange(e.target.value);
    if (!open) openDropdown();
  };

  const handleBlur = () => { setTimeout(() => setOpen(false), 150); };

  const handleSelect = (opt) => { onChange(opt); setDraft(''); setOpen(false); };

  const filtered = draft ? options.filter(o => o.toLowerCase().includes(draft.toLowerCase())) : options;

  return (
    <div>
      <input
        ref={inputRef}
        value={open ? draft : (value || '')}
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        className="grid-cell"
        placeholder={placeholder}
      />
      {open && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-md shadow-xl max-h-52 overflow-y-auto">
          {filtered.length === 0
            ? <div className="px-2 py-2 text-xs text-slate-400 italic">Custom text kept</div>
            : filtered.map(opt => (
              <button key={opt} type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(opt); }}
                className={`block w-full text-left px-3 py-1.5 text-xs transition-colors
                  ${opt === value ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                {opt}
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
};

// ── PiecesGrid ──────────────────────────────────────────────────────────────
const PiecesGrid = ({ rows, setRows, material, thickness, defaultThickness, onCategoryDetected, onThicknessSuggested, destinations, category, drawingNo, masterDescriptions, descriptionThicknessMap }) => {
  const [drawerRow, setDrawerRow] = useState(null);
  const [drawerScrollTo, setDrawerScrollTo] = useState(null);
  const descOptions = useMemo(() => masterDescriptions || MASTER_DESCRIPTIONS, [masterDescriptions]);

  const openDrawer = (row, section = null) => {
    setDrawerRow(row);
    setDrawerScrollTo(section);
  };

  const updateRow = useCallback((id, field, value) => {
    setRows(prev => {
      const updated = prev.map(r => {
        if (r._id !== id) return r;
        const next = { ...r, [field]: value };
        if (field === 'part_no') next._partNoAuto = false;
        if (field === 'part' && value) {
          const hint = (descriptionThicknessMap || DEFAULT_THICKNESS_MAP)[value];
          if (hint) next.thickness = hint;
        }
        return next;
      });
      if (field === 'part') return reindexAutoPartNos(updated, drawingNo, { forceReassign: true });
      return updated;
    });
  }, [setRows, drawingNo, descriptionThicknessMap]);

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
      const copy = { ...dupeRow(src), dest_qty_overrides: {} };
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
        return r;
      });
      if (parsed.length) {
        setRows(prev => {
          const empty = prev.length === 1 && !prev[0].part_no && !prev[0].part && !prev[0].length;
          return reindexAutoPartNos(empty ? parsed : [...prev, ...parsed], drawingNo);
        });
        const map = descriptionThicknessMap || DEFAULT_THICKNESS_MAP;
        const hint = parsed.map(r => map[r.part]).find(Boolean);
        if (hint) onThicknessSuggested?.(hint);
      }
  }, [setRows, onThicknessSuggested, defaultThickness, thickness, drawingNo, descriptionThicknessMap]);

  const activeDests = useMemo(() =>
    (destinations || []).filter(d => d.building || d.floor || d.flat),
    [destinations]
  );

  const computedDestQty = useMemo(() => {
    if (!activeDests.length) return null;
    return activeDests.reduce((s, d) => s + (d.matrixQty != null ? Number(d.matrixQty) : 1), 0);
  }, [activeDests]);

  const totalSqft = rows.reduce((s, r) => s + calcSqft(r.length, r.width, computedDestQty ?? r.qty), 0);
  const totalWt   = rows.reduce((s, r) => s + calcWeight(r.length, r.width, computedDestQty ?? r.qty, material, r.thickness, thickness), 0);
  const totalQty  = rows.reduce((s, r) => s + (computedDestQty ?? (Number(r.qty) || 1)), 0);

  return (
    <div className="mt-4">
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
              <th className="px-2 py-2 w-36 font-medium"></th>
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

                  {/* Description — searchable combobox */}
                  <td className="px-1 py-1">
                    <DescriptionCombobox
                      value={row.part || ''}
                      onChange={v => updateRow(row._id, 'part', v)}
                      options={descOptions}
                      placeholder="Description…"
                    />
                  </td>

                  <td className="px-1 py-1">
                    {computedDestQty != null ? (
                      <span className="block text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-100 px-1 py-0.5 tabular-nums" title="Qty set by destination count">
                        {computedDestQty}
                      </span>
                    ) : (
                      <input type="number" min="1" value={row.qty}
                        onChange={e => updateRow(row._id, 'qty', e.target.value)} className="grid-cell" />
                    )}
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
                    <input
                      value={row.thickness || defaultThickness || thickness || '3CM'}
                      readOnly
                      tabIndex={-1}
                      className="grid-cell text-[11px] bg-slate-50 text-slate-500 cursor-not-allowed"
                      aria-label="Thickness set by description mapping"
                    />
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
                      <button type="button" onClick={() => duplicateRow(row._id)} title="Copy row — duplicates piece properties, not destinations"
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50 hover:border-slate-400">
                        Copy
                      </button>
                      <button type="button" onClick={() => openDrawer(row)}
                        title="Edit destination and technical details"
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors
                          ${isActive
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'}`}>
                        {isActive ? '◀ Edit' : 'Edit'}
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
        &nbsp;— then paste anywhere in the grid. Click <span className="font-medium">Edit</span> or any badge to review destination and technical details.
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
