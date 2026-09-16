import React, { useRef, useState } from 'react';

let rowIdCounter = 1;
export const newGridRow = () => ({ id: rowIdCounter++, length: '', width: '', qty: 1, material: '', label: '' });

/** Parses "Width,Length,Qty[, ...]" CSV text (tolerant of a header row, extra
 * trailing columns, and a trailing "Grand Total" row) into grid rows. */
export function parseCutListCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',').map((c) => c.trim());
    const width = parseFloat(cols[0]);
    const length = parseFloat(cols[1]);
    const qty = parseInt(cols[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(length) || !Number.isFinite(qty)) continue; // header/footer row
    rows.push({ id: rowIdCounter++, length, width, qty, material: '', label: '' });
  }
  return rows;
}

/**
 * Editable Length/Width/Qty/Material/Label grid — shared shape for both the
 * "Panels" and "Stock sheets" tables in the cutlistoptimizer.com-style
 * layout the shop is used to. Rows can be typed directly, added, deleted,
 * and (Panels only) bulk-imported from a pasted/uploaded CSV.
 */
const CutListGrid = ({ title, icon, rows, setRows, allowCsvImport = false, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  const fileRef = useRef(null);

  const updateCell = (id, field, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, newGridRow()]);
  const deleteRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = parseCutListCsv(String(reader.result || ''));
      if (imported.length) setRows((prev) => [...prev.filter((r) => r.length || r.width), ...imported]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors">
        <span className="flex items-center gap-2 font-semibold text-slate-700">
          {icon} {title}
        </span>
        <span className="flex items-center gap-3">
          {allowCsvImport && open && (
            <span
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              ⇧ Import CSV
            </span>
          )}
          <span className="text-slate-500">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {allowCsvImport && (
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
      )}
      {open && (
        // Fixed-height scroll area instead of letting the table push the
        // page taller as rows are added/imported — the page stays the same
        // length regardless of whether there are 3 rows or 300.
        <div className="overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="text-left font-semibold text-slate-700 px-3 py-2 w-28 bg-white">Length</th>
                <th className="text-left font-semibold text-slate-700 px-3 py-2 w-28 bg-white">Width</th>
                <th className="text-left font-semibold text-slate-700 px-3 py-2 w-20 bg-white">Qty</th>
                <th className="text-left font-semibold text-slate-700 px-3 py-2 w-32 bg-white">Material</th>
                <th className="text-left font-semibold text-slate-700 px-3 py-2 w-32 bg-white">Label</th>
                <th className="w-10 bg-white"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-1 py-1">
                    <input type="number" step="0.001" value={row.length}
                      onChange={(e) => updateCell(row.id, 'length', e.target.value)}
                      className="grid-cell no-spinner" />
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" step="0.001" value={row.width}
                      onChange={(e) => updateCell(row.id, 'width', e.target.value)}
                      className="grid-cell no-spinner" />
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" min="0" step="1" value={row.qty}
                      onChange={(e) => updateCell(row.id, 'qty', e.target.value)}
                      className="grid-cell no-spinner" />
                  </td>
                  <td className="px-1 py-1">
                    <input value={row.material}
                      onChange={(e) => updateCell(row.id, 'material', e.target.value)}
                      className="grid-cell" placeholder="Material 1" />
                  </td>
                  <td className="px-1 py-1">
                    <input value={row.label}
                      onChange={(e) => updateCell(row.id, 'label', e.target.value)}
                      className="grid-cell" />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button type="button" onClick={() => deleteRow(row.id)}
                      className="text-slate-400 hover:text-rose-600" title="Delete row">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <button type="button" onClick={addRow}
          className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 border-t border-slate-100">
          + Add row
        </button>
      )}
    </div>
  );
};

export default CutListGrid;
