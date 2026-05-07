import React, { useCallback } from 'react';

const PART_OPTIONS = {
  Vanity: ['Vanity Top', 'Back Splash', 'Side Splash', 'Main Top'],
  Kitchen: ['Kitchen Perimeter', 'Kitchen Others', 'Island', 'Range Tops', 'Window Sills'],
  Other: ['Laundry Top', 'Bar Top', 'Other'],
};
const PART_CAT_MAP = {};
Object.entries(PART_OPTIONS).forEach(([cat, parts]) => parts.forEach(p => { PART_CAT_MAP[p] = cat; }));

const EMPTY_ROW = {
  part: '', length: '', width: '', qty: 1,
  sink_type: 'No Sink', sink_cut: '-', tap_holes: '-', grooves: '-',
  edge: 'None', edge_area: '', radius: '-', notes: '',
};

let rowIdCounter = 1;
export const newRow = () => ({ ...EMPTY_ROW, _id: rowIdCounter++ });
export const dupeRow = (row) => ({ ...row, _id: rowIdCounter++ });

const calcSqft = (l, w, qty) => {
  const ll = Number(l) || 0, ww = Number(w) || 0, q = Number(qty) || 1;
  return ll > 0 && ww > 0 ? (ll * ww / 144) * q : 0;
};

const calcWeight = (l, w, qty, material, thickness) => {
  const factors = {
    Granite: { '2CM': 5.5, '3CM': 7.5, Mixed: 6.5 },
    Quartz: { '2CM': 4.75, '3CM': 6.75, Mixed: 5.75 },
    Marble: { '2CM': 6.0, '3CM': 8.0, Mixed: 7.0 },
  };
  const f = (factors[material] || factors.Granite)[thickness] || 7.5;
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

const Sel = ({ value, onChange, children, className = '' }) => (
  <select value={value} onChange={onChange} className={`grid-cell ${className}`}>{children}</select>
);

const PiecesGrid = ({ rows, setRows, material, thickness, onCategoryDetected }) => {
  const updateRow = useCallback((id, field, value) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r;
      const next = { ...r, [field]: value };
      if (field === 'part' && PART_CAT_MAP[value]) {
        onCategoryDetected?.(PART_CAT_MAP[value]);
      }
      return next;
    }));
  }, [setRows, onCategoryDetected]);

  const deleteRow = useCallback((id) => {
    setRows(prev => prev.length <= 1 ? prev : prev.filter(r => r._id !== id));
  }, [setRows]);

  const addRow = useCallback(() => setRows(prev => [...prev, newRow()]), [setRows]);

  const duplicateRow = useCallback((id) => {
    setRows(prev => {
      const src = prev.find(r => r._id === id);
      if (!src) return prev;
      const idx = prev.indexOf(src);
      const copy = dupeRow(src);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, [setRows]);

  const handlePaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const parsed = lines.map(line => {
      const cols = line.split('\t');
      const r = newRow();
      r.part = cols[0]?.trim() || '';
      r.length = cols[1]?.trim() || '';
      r.width = cols[2]?.trim() || '';
      r.qty = Number(cols[3]?.trim()) || 1;
      r.sink_type = cols[4]?.trim() || 'No Sink';
      r.sink_cut = cols[5]?.trim() || '-';
      r.tap_holes = cols[6]?.trim() || '-';
      r.grooves = cols[7]?.trim() || '-';
      r.edge = cols[8]?.trim() || 'None';
      r.edge_area = cols[9]?.trim() || '';
      r.radius = cols[10]?.trim() || '-';
      r.notes = cols[11]?.trim() || '';
      if (r.part && PART_CAT_MAP[r.part]) onCategoryDetected?.(PART_CAT_MAP[r.part]);
      return r;
    });
    if (parsed.length) setRows(prev => {
      const empty = prev.length === 1 && !prev[0].part && !prev[0].length;
      return empty ? parsed : [...prev, ...parsed];
    });
  }, [setRows, onCategoryDetected]);

  const totalSqft = rows.reduce((s, r) => s + calcSqft(r.length, r.width, r.qty), 0);
  const totalWt = rows.reduce((s, r) => s + calcWeight(r.length, r.width, r.qty, material, thickness), 0);
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 1), 0);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-[#0f172a]">
          Pieces in this Drawing
          <span className="ml-2 text-xs font-normal text-[#64748b]">
            {rows.length} row{rows.length !== 1 ? 's' : ''} • {totalQty} pcs • {totalSqft.toFixed(1)} sqft • {totalWt.toFixed(0)} kg
          </span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={addRow}
            className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]">
            + Add Row
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]" onPaste={handlePaste}>
        <table className="w-full text-xs">
          <thead className="bg-[#f1f5f9] text-[#475569]">
            <tr>
              <th className="px-2 py-2 text-left w-8">#</th>
              <th className="px-2 py-2 text-left min-w-[140px]">Part</th>
              <th className="px-2 py-2 text-left w-20">Length</th>
              <th className="px-2 py-2 text-left w-20">Depth</th>
              <th className="px-2 py-2 text-left w-14">Qty</th>
              <th className="px-2 py-2 text-left w-16">Sq Ft</th>
              <th className="px-2 py-2 text-left w-16">Wt kg</th>
              <th className="px-2 py-2 text-left min-w-[100px]">Sink</th>
              <th className="px-2 py-2 text-left w-14">Cuts</th>
              <th className="px-2 py-2 text-left w-14">Taps</th>
              <th className="px-2 py-2 text-left w-14">Grvs</th>
              <th className="px-2 py-2 text-left w-20">Edge</th>
              <th className="px-2 py-2 text-left w-20">Area</th>
              <th className="px-2 py-2 text-left w-14">Rad</th>
              <th className="px-2 py-2 text-left min-w-[100px]">Notes</th>
              <th className="px-2 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const sqft = calcSqft(row.length, row.width, row.qty);
              const wt = calcWeight(row.length, row.width, row.qty, material, thickness);
              return (
                <tr key={row._id} className="border-t border-[#e2e8f0] hover:bg-[#f8fafc]">
                  <td className="px-2 py-1 text-[#94a3b8]">{idx + 1}</td>
                  <td className="px-1 py-1">
                    <select value={row.part} onChange={e => updateRow(row._id, 'part', e.target.value)} className="grid-cell">
                      <option value="">Select...</option>
                      {Object.entries(PART_OPTIONS).map(([cat, parts]) => (
                        <optgroup label={cat} key={cat}>{parts.map(p => <option key={p}>{p}</option>)}</optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input type="number" step="0.125" value={row.length} onChange={e => updateRow(row._id, 'length', e.target.value)} className="grid-cell" /></td>
                  <td className="px-1 py-1"><input type="number" step="0.125" value={row.width} onChange={e => updateRow(row._id, 'width', e.target.value)} className="grid-cell" /></td>
                  <td className="px-1 py-1"><input type="number" min="1" value={row.qty} onChange={e => updateRow(row._id, 'qty', e.target.value)} className="grid-cell" /></td>
                  <td className="px-2 py-1 text-[#475569]">{sqft > 0 ? sqft.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1 text-[#475569]">{wt > 0 ? wt.toFixed(0) : '—'}</td>
                  <td className="px-1 py-1">
                    <Sel value={row.sink_type} onChange={e => updateRow(row._id, 'sink_type', e.target.value)}>
                      <option>No Sink</option><option>Single Bowl</option><option>Double Bowl</option><option>ADA</option>
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.sink_cut} onChange={e => updateRow(row._id, 'sink_cut', e.target.value)}>
                      {['-','0','1','2','3'].map(v => <option key={v} value={v}>{v}</option>)}
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.tap_holes} onChange={e => updateRow(row._id, 'tap_holes', e.target.value)}>
                      {['-','0','1','2','3','4','5','6'].map(v => <option key={v} value={v}>{v}</option>)}
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.grooves} onChange={e => updateRow(row._id, 'grooves', e.target.value)}>
                      {['-','0','1','2','3','4'].map(v => <option key={v} value={v}>{v}</option>)}
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.edge} onChange={e => updateRow(row._id, 'edge', e.target.value)}>
                      <option>None</option><option>Machine</option><option>Manual</option><option>Both</option>
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.edge_area} onChange={e => updateRow(row._id, 'edge_area', e.target.value)}>
                      <option value="">—</option><option>4 Sides</option><option>3 Sides</option><option>2 Sides</option><option>1 Side</option>
                    </Sel>
                  </td>
                  <td className="px-1 py-1">
                    <Sel value={row.radius} onChange={e => updateRow(row._id, 'radius', e.target.value)}>
                      {['-','1','2','3','4'].map(v => <option key={v} value={v}>{v}</option>)}
                    </Sel>
                  </td>
                  <td className="px-1 py-1"><input value={row.notes} onChange={e => updateRow(row._id, 'notes', e.target.value)} className="grid-cell" /></td>
                  <td className="px-1 py-1">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => duplicateRow(row._id)} title="Duplicate"
                        className="rounded border border-[#e2e8f0] bg-white px-1.5 py-0.5 text-[10px] text-[#64748b] hover:bg-[#f1f5f9]">⧉</button>
                      <button type="button" onClick={() => deleteRow(row._id)} title="Delete"
                        className="rounded border border-[#e2e8f0] bg-white px-1.5 py-0.5 text-[10px] text-rose-500 hover:bg-rose-50">✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[10px] text-[#94a3b8]">
        Paste from Excel: copy rows with columns Part, Length, Width, Qty, Sink, Cuts, Taps, Grooves, Edge, Area, Radius, Notes — then paste anywhere in the grid.
      </div>
    </div>
  );
};

export { PART_CAT_MAP, calcEdge };
export default PiecesGrid;
