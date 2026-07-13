import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { calcWeight } from '../utils/pieceCalc';

// ── Column definitions ────────────────────────────────────────────────────────
// Computed columns' `fn` receives (row, ctx) where ctx = { material, thickness }
// (project-level context passed down from UploadWorkspace) -- mirrors the live
// Sq Ft / Wt kg estimates Manual Entry (PiecesGrid) already shows, so parsed
// rows get the same automatic calculation without the user typing anything in.
export const UPLOAD_COLUMNS = [
  { id: 'drawing',   label: 'Drawing',    w: 78,  type: 'text' },
  { id: 'unit',      label: 'Unit',       w: 68,  type: 'text' },
  { id: 'building',  label: 'Bldg',       w: 46,  type: 'text' },
  { id: 'floor',     label: 'Floor',      w: 46,  type: 'text' },
  { id: 'flat',      label: 'Flat',       w: 52,  type: 'text' },
  { id: 'part_no',   label: 'Part #',     w: 80,  type: 'text' },
  { id: 'part',      label: 'Description',w: 130, type: 'text' },
  { id: 'category',  label: 'Category',   w: 88,  type: 'select',
    options: ['Vanity','Kitchen','Laundry','Island','Splashes','Hearth','Bar','Utility','Other'] },
  { id: 'length',    label: 'Length',     w: 56,  type: 'number' },
  { id: 'width',     label: 'Width',      w: 56,  type: 'number' },
  { id: 'thickness', label: 'Thick.',     w: 54,  type: 'select',
    options: ['2CM','3CM','Mixed'] },
  { id: 'qty',       label: 'Qty',        w: 40,  type: 'number' },
  { id: '_sqft',     label: 'Sq Ft',      w: 52,  type: 'computed',
    fn: (r) => r.length && r.width ? (parseFloat(r.length)*parseFloat(r.width)/144*(parseInt(r.qty)||1)).toFixed(1) : '' },
  { id: '_est_weight', label: 'Wt (kg)',  w: 56,  type: 'computed',
    fn: (r, ctx = {}) => {
      const wt = calcWeight(r.length, r.width, r.qty, ctx.material, r.thickness, ctx.thickness);
      return wt > 0 ? wt.toFixed(1) : '';
    } },
  { id: 'weight_kg', label: 'Wt Override',w: 66,  type: 'number' },
  { id: 'sink_type', label: 'Sink',       w: 90,  type: 'select',
    options: ['No Sink','Single Bowl','Double Bowl','Bar Sink','Undermount'] },
  { id: 'sink_cut',  label: 'Cutouts',    w: 64,  type: 'text' },
  { id: 'tap_holes', label: 'Taps',       w: 46,  type: 'text' },
  { id: 'grooves',   label: 'Grooves',    w: 58,  type: 'text' },
  { id: 'edge',      label: 'Edge',       w: 74,  type: 'select',
    options: ['None','Eased','Bullnose','Bevel','Ogee','Miter','Waterfall','Laminate'] },
  { id: 'edge_area', label: 'Edge Sides', w: 68,  type: 'text' },
  { id: 'radius',    label: 'Radius',     w: 54,  type: 'text' },
  { id: 'notes',     label: 'Notes',      w: 120, type: 'text' },
];

const EDITABLE_COLS = UPLOAD_COLUMNS.filter(c => c.type !== 'computed');
const EDITABLE_IDS  = EDITABLE_COLS.map(c => c.id);

let rowIdSeq = 1;
export const blankRow = () => ({
  _id: rowIdSeq++, _confidence: {}, _source: 'manual',
  drawing:'', unit:'', building:'', floor:'', flat:'',
  part_no:'', part:'', category:'Vanity',
  length:'', width:'', thickness:'3CM', qty:'1', weight_kg:'',
  sink_type:'No Sink', sink_cut:'-', tap_holes:'-', grooves:'-',
  edge:'None', edge_area:'', radius:'-', notes:'',
});

// ── Confidence helpers ────────────────────────────────────────────────────────
const confClass = (conf) => {
  if (conf === undefined || conf === null) return '';
  if (conf >= 0.8) return '';
  if (conf >= 0.5) return 'bg-amber-50';
  return 'bg-orange-50';
};
const confDot = (conf) => (conf !== undefined && conf < 0.5 && conf > 0) ? (
  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 opacity-70" />
) : null;

// ── Validation ────────────────────────────────────────────────────────────────
const validateRow = (row) => {
  const errs = [];
  if (!row.part && !row.part_no) errs.push('part');
  if (!row.length || isNaN(parseFloat(row.length))) errs.push('length');
  if (!row.width  || isNaN(parseFloat(row.width)))  errs.push('width');
  return errs;
};

// ── UploadGrid ────────────────────────────────────────────────────────────────
const UploadGrid = React.forwardRef(({ initialRows = [], onChange, filterText = '', material, thickness, checkedIds, onToggleChecked, onToggleAllChecked }, ref) => {
  const calcCtx = useMemo(() => ({ material, thickness }), [material, thickness]);
  const [rows, setRowsRaw] = useState(() => initialRows.map(r => ({ ...blankRow(), ...r })));
  const [anchor, setAnchor] = useState(null);   // {r, c} index into filteredRows
  const [cursor, setCursor] = useState(null);   // {r, c}
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [sortBy, setSortBy] = useState(null);   // {col, asc}
  const histRef = useRef({ past: [], future: [] });
  const containerRef = useRef(null);
  const editInputRef = useRef(null);

  // Sync initial rows when parent provides new data (after parse)
  useEffect(() => {
    if (initialRows.length > 0) {
      setRowsRaw(initialRows.map(r => ({ ...blankRow(), ...r })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent on change
  const setRows = useCallback((updater) => {
    setRowsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  // Push to undo history
  const pushHistory = useCallback((newRows) => {
    histRef.current.past.push(rows);
    if (histRef.current.past.length > 100) histRef.current.past.shift();
    histRef.current.future = [];
    setRows(newRows);
  }, [rows, setRows]);

  const undo = useCallback(() => {
    if (!histRef.current.past.length) return;
    histRef.current.future.push(rows);
    const prev = histRef.current.past.pop();
    setRows(prev);
  }, [rows, setRows]);

  const redo = useCallback(() => {
    if (!histRef.current.future.length) return;
    histRef.current.past.push(rows);
    const next = histRef.current.future.pop();
    setRows(next);
  }, [rows, setRows]);

  // Expose rows to parent
  useImperativeHandle(ref, () => ({
    getRows: () => rows,
    setRows: (newRows) => {
      pushHistory(newRows.map(r => ({ ...blankRow(), ...r })));
    },
  }));

  // ── Filtered / sorted view ─────────────────────────────────────────────────
  const displayRows = useMemo(() => {
    let r = rows;
    if (filterText) {
      const ft = filterText.toLowerCase();
      r = r.filter(row => EDITABLE_IDS.some(id => String(row[id] || '').toLowerCase().includes(ft)));
    }
    if (sortBy) {
      r = [...r].sort((a, b) => {
        const av = String(a[sortBy.col] || '');
        const bv = String(b[sortBy.col] || '');
        const n = parseFloat(av) - parseFloat(bv);
        const cmp = !isNaN(n) ? n : av.localeCompare(bv);
        return sortBy.asc ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, filterText, sortBy]);

  const colIdx = (colId) => UPLOAD_COLUMNS.findIndex(c => c.id === colId);

  const allVisibleChecked = displayRows.length > 0 && displayRows.every(r => checkedIds.has(r._id));

  // ── Selection helpers ──────────────────────────────────────────────────────
  const selRange = useMemo(() => {
    if (!anchor || !cursor) return null;
    return {
      r1: Math.min(anchor.r, cursor.r), r2: Math.max(anchor.r, cursor.r),
      c1: Math.min(anchor.c, cursor.c), c2: Math.max(anchor.c, cursor.c),
    };
  }, [anchor, cursor]);

  const isSel = (r, c) => selRange && r >= selRange.r1 && r <= selRange.r2 && c >= selRange.c1 && c <= selRange.c2;
  const isAnchor = (r, c) => anchor && anchor.r === r && anchor.c === c;

  // ── Cell value update ──────────────────────────────────────────────────────
  const updateCell = useCallback((rowId, colId, value) => {
    setRows(prev => prev.map(r => {
      if (r._id !== rowId) return r;
      const conf = { ...r._confidence, [colId]: undefined }; // clear confidence on manual edit
      return { ...r, [colId]: value, _confidence: conf, _source: 'manual' };
    }));
  }, [setRows]);

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const startEdit = useCallback((r, c) => {
    const col = UPLOAD_COLUMNS[c];
    if (!col || col.type === 'computed') return;
    const row = displayRows[r];
    if (!row) return;
    setEditCell({ r, c });
    setEditValue(String(row[col.id] ?? ''));
    setTimeout(() => editInputRef.current?.focus?.(), 0);
  }, [displayRows]);

  const commitEdit = useCallback((value) => {
    if (!editCell) return;
    const col = UPLOAD_COLUMNS[editCell.c];
    const row = displayRows[editCell.r];
    if (!col || !row) { setEditCell(null); return; }
    // Push to real rows (displayRows may be filtered)
    setRows(prev => prev.map(r => {
      if (r._id !== row._id) return r;
      const conf = { ...r._confidence, [col.id]: undefined };
      return { ...r, [col.id]: value, _confidence: conf, _source: 'manual' };
    }));
    histRef.current.past.push(rows);
    histRef.current.future = [];
    setEditCell(null);
  }, [editCell, displayRows, setRows, rows]);

  const cancelEdit = () => setEditCell(null);

  // ── Row operations ─────────────────────────────────────────────────────────
  const addRow = useCallback(() => {
    const newRow = blankRow();
    pushHistory([...rows, newRow]);
    setAnchor({ r: rows.length, c: 0 });
    setCursor({ r: rows.length, c: 0 });
  }, [rows, pushHistory]);

  const duplicateRow = useCallback((id) => {
    const idx = rows.findIndex(r => r._id === id);
    if (idx < 0) return;
    const copy = { ...rows[idx], _id: Date.now() + Math.random() };
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    pushHistory(next);
  }, [rows, pushHistory]);

  // ── Copy / Paste ──────────────────────────────────────────────────────────
  const copySelection = useCallback(() => {
    if (!selRange) return '';
    const lines = [];
    for (let ri = selRange.r1; ri <= selRange.r2; ri++) {
      const row = displayRows[ri];
      if (!row) continue;
      const cells = [];
      for (let ci = selRange.c1; ci <= selRange.c2; ci++) {
        const col = UPLOAD_COLUMNS[ci];
        cells.push(col.type === 'computed' ? (col.fn(row, calcCtx) || '') : String(row[col.id] ?? ''));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }, [selRange, displayRows]);

  const applyPastedText = useCallback((text) => {
    if (!anchor) return;
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l !== '');
    const grid = lines.map(l => l.split('\t'));
    const newRows = rows.map(r => ({ ...r }));
    // find real indices for filtered view
    for (let ri = 0; ri < grid.length; ri++) {
      const viewRow = displayRows[anchor.r + ri];
      if (!viewRow) continue;
      const realIdx = newRows.findIndex(r => r._id === viewRow._id);
      if (realIdx < 0) continue;
      for (let ci = 0; ci < grid[ri].length; ci++) {
        const col = UPLOAD_COLUMNS[anchor.c + ci];
        if (!col || col.type === 'computed') continue;
        newRows[realIdx] = { ...newRows[realIdx], [col.id]: grid[ri][ci], _confidence: { ...newRows[realIdx]._confidence, [col.id]: undefined } };
      }
    }
    pushHistory(newRows);
  }, [anchor, displayRows, rows, pushHistory]);

  // ── Fill down ──────────────────────────────────────────────────────────────
  const fillDown = useCallback(() => {
    if (!selRange || selRange.r2 === selRange.r1) return;
    const srcRow = displayRows[selRange.r1];
    if (!srcRow) return;
    const newRows = rows.map(r => ({ ...r }));
    for (let ri = selRange.r1 + 1; ri <= selRange.r2; ri++) {
      const viewRow = displayRows[ri];
      if (!viewRow) continue;
      const realIdx = newRows.findIndex(r => r._id === viewRow._id);
      if (realIdx < 0) continue;
      for (let ci = selRange.c1; ci <= selRange.c2; ci++) {
        const col = UPLOAD_COLUMNS[ci];
        if (!col || col.type === 'computed') continue;
        newRows[realIdx] = { ...newRows[realIdx], [col.id]: srcRow[col.id] ?? '', _confidence: { ...newRows[realIdx]._confidence, [col.id]: undefined } };
      }
    }
    pushHistory(newRows);
  }, [selRange, displayRows, rows, pushHistory]);

  // ── Keyboard handler (container) ───────────────────────────────────────────
  const handleContainerKeyDown = useCallback((e) => {
    if (editCell) return; // let edit input handle keys

    const nRows = displayRows.length;
    const nCols = UPLOAD_COLUMNS.length;
    const cur = cursor || { r: 0, c: 0 };

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) { e.preventDefault(); redo(); return; }
    // Copy
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const text = copySelection();
      if (text) navigator.clipboard?.writeText(text).catch(() => {});
      return;
    }
    // Fill down
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); fillDown(); return; }
    // Delete selected cells
    if ((e.key === 'Delete' || e.key === 'Backspace') && selRange) {
      e.preventDefault();
      const newRows = rows.map(r => ({ ...r }));
      for (let ri = selRange.r1; ri <= selRange.r2; ri++) {
        const vr = displayRows[ri]; if (!vr) continue;
        const idx = newRows.findIndex(r => r._id === vr._id); if (idx < 0) continue;
        for (let ci = selRange.c1; ci <= selRange.c2; ci++) {
          const col = UPLOAD_COLUMNS[ci];
          if (!col || col.type === 'computed') continue;
          newRows[idx] = { ...newRows[idx], [col.id]: '' };
        }
      }
      pushHistory(newRows);
      return;
    }
    // Enter edit
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(cur.r, cur.c); return; }

    // Arrow / Tab navigation
    let nr = cur.r, nc = cur.c;
    if (e.key === 'ArrowUp')    { e.preventDefault(); nr = Math.max(0, nr - 1); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); nr = Math.min(nRows - 1, nr + 1); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); nc = Math.max(0, nc - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nc = Math.min(nCols - 1, nc + 1); }
    else if (e.key === 'Tab')        { e.preventDefault(); nc = e.shiftKey ? Math.max(0, nc - 1) : Math.min(nCols - 1, nc + 1); }
    else { return; }

    if (e.shiftKey && e.key !== 'Tab') {
      setCursor({ r: nr, c: nc });
    } else {
      setAnchor({ r: nr, c: nc });
      setCursor({ r: nr, c: nc });
    }
  }, [editCell, cursor, displayRows, rows, selRange, undo, redo, copySelection, fillDown, pushHistory, startEdit]);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); return; }
    if (e.key === 'Enter') {
      commitEdit(e.currentTarget.value);
      e.preventDefault();
      const next = { r: Math.min(displayRows.length - 1, (editCell?.r ?? 0) + 1), c: editCell?.c ?? 0 };
      setAnchor(next); setCursor(next);
      return;
    }
    if (e.key === 'Tab') {
      commitEdit(e.currentTarget.value);
      e.preventDefault();
      const nc = e.shiftKey ? Math.max(0, (editCell?.c ?? 1) - 1) : Math.min(UPLOAD_COLUMNS.length - 1, (editCell?.c ?? 0) + 1);
      const next = { r: editCell?.r ?? 0, c: nc };
      setAnchor(next); setCursor(next);
      setTimeout(() => startEdit(next.r, next.c), 0);
    }
  }, [commitEdit, cancelEdit, editCell, displayRows, startEdit]);

  // Paste event on container
  const handlePaste = useCallback((e) => {
    if (editCell) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text') || '';
    if (text) applyPastedText(text);
  }, [editCell, applyPastedText]);

  const toggleSort = (colId) => {
    setSortBy(prev => {
      if (prev?.col === colId) return prev.asc ? { col: colId, asc: false } : null;
      return { col: colId, asc: true };
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const validationMap = useMemo(() => {
    const m = {};
    rows.forEach(r => { m[r._id] = new Set(validateRow(r)); });
    return m;
  }, [rows]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex-1 overflow-auto outline-none focus:ring-1 focus:ring-blue-300 rounded-lg"
      onKeyDown={handleContainerKeyDown}
      onPaste={handlePaste}
    >
      <table className="border-collapse text-xs w-full select-none" style={{ minWidth: UPLOAD_COLUMNS.reduce((s, c) => s + c.w, 36) }}>
        <thead className="sticky top-0 z-20 bg-[#f1f5f9] border-b-2 border-[#cbd5e1]">
          <tr>
            <th className="sticky left-0 z-30 bg-[#f1f5f9] w-7 px-1 py-2 text-center border-r border-[#e2e8f0]">
              <input type="checkbox" checked={allVisibleChecked}
                onChange={() => onToggleAllChecked?.(displayRows.map(r => r._id), !allVisibleChecked)}
                className="rounded border-[#cbd5e1]" title="Select all visible rows" />
            </th>
            <th className="sticky left-7 z-30 bg-[#f1f5f9] w-9 px-1 py-2 text-center text-[#94a3b8] border-r border-[#e2e8f0]">#</th>
            {UPLOAD_COLUMNS.map((col) => (
              <th key={col.id}
                className="px-2 py-2 text-left font-semibold text-[#475569] whitespace-nowrap cursor-pointer hover:bg-[#e8eef5] border-r border-[#e2e8f0] last:border-r-0"
                style={{ minWidth: col.w, width: col.w }}
                onClick={() => col.type !== 'computed' && toggleSort(col.id)}>
                <span className="flex items-center gap-0.5">
                  {col.label}
                  {sortBy?.col === col.id && <span className="text-[#2563eb]">{sortBy.asc ? '↑' : '↓'}</span>}
                </span>
              </th>
            ))}
            <th className="w-10 px-1 py-2 bg-[#f1f5f9]" />
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, ri) => {
            const errors = validationMap[row._id] || new Set();
            const hasError = errors.size > 0;
            return (
              <tr key={row._id}
                className={`border-b border-[#f1f5f9] ${checkedIds.has(row._id) ? 'bg-blue-50/50' : hasError ? 'bg-rose-50/30' : ''}`}
                onDoubleClick={() => {
                  if (anchor?.r === ri) startEdit(ri, anchor.c);
                }}>
                <td className="sticky left-0 z-10 bg-white px-1 py-0.5 text-center border-r border-[#e2e8f0]">
                  <input type="checkbox" checked={checkedIds.has(row._id)} onChange={() => onToggleChecked?.(row._id)}
                    className="rounded border-[#cbd5e1]" />
                </td>
                <td className="sticky left-7 z-10 bg-white px-1 py-0.5 text-center text-[#94a3b8] border-r border-[#e2e8f0] font-mono text-[10px]">
                  {ri + 1}
                </td>
                {UPLOAD_COLUMNS.map((col, ci) => {
                  const val = col.type === 'computed' ? col.fn(row, calcCtx) : (row[col.id] ?? '');
                  const conf = row._confidence?.[col.id];
                  const isEditing = editCell?.r === ri && editCell?.c === ci;
                  const selected = isSel(ri, ci);
                  const anchorCell = isAnchor(ri, ci);
                  const hasValidationErr = errors.has(col.id);

                  return (
                    <td
                      key={col.id}
                      className={`relative border-r border-[#f1f5f9] last:border-r-0 py-0.5 px-0
                        ${selected ? 'bg-blue-100' : confClass(conf)}
                        ${anchorCell && !isEditing ? 'ring-1 ring-inset ring-[#2563eb]' : ''}
                        ${hasValidationErr ? 'bg-rose-100 ring-1 ring-inset ring-rose-300' : ''}`}
                      style={{ minWidth: col.w, width: col.w }}
                      onClick={(e) => {
                        if (e.shiftKey && anchor) {
                          setCursor({ r: ri, c: ci });
                        } else {
                          setAnchor({ r: ri, c: ci });
                          setCursor({ r: ri, c: ci });
                        }
                        containerRef.current?.focus();
                      }}
                      onDoubleClick={() => startEdit(ri, ci)}
                    >
                      {isEditing ? (
                        col.type === 'select' ? (
                          <select
                            ref={editInputRef}
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={e => commitEdit(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            className="absolute inset-0 w-full h-full px-1 text-xs bg-white border-2 border-[#2563eb] outline-none z-10"
                          >
                            {col.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            ref={editInputRef}
                            autoFocus
                            value={editValue}
                            type={col.type === 'number' ? 'number' : 'text'}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={e => commitEdit(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            className="absolute inset-0 w-full h-full px-1.5 text-xs bg-white border-2 border-[#2563eb] outline-none z-10"
                          />
                        )
                      ) : (
                        <div className="px-1.5 truncate leading-5 max-h-[22px]" style={{ minHeight: 22 }}>
                          {val !== '' && val !== null && val !== undefined ? String(val) : (
                            <span className="text-[#cbd5e1]">{col.type === 'computed' ? '' : '—'}</span>
                          )}
                        </div>
                      )}
                      {!isEditing && confDot(conf)}
                    </td>
                  );
                })}
                <td className="px-1 py-0.5 text-center whitespace-nowrap">
                  <button type="button"
                    className="text-[#94a3b8] hover:text-[#2563eb] text-[10px] px-1 leading-none"
                    onClick={() => duplicateRow(row._id)}
                    title="Duplicate row">
                    ⧉
                  </button>
                  <button type="button"
                    className="text-[#94a3b8] hover:text-rose-500 text-[10px] px-1 leading-none"
                    onClick={() => pushHistory(rows.filter(r => r._id !== row._id))}
                    title="Delete row">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          {displayRows.length === 0 && (
            <tr>
              <td colSpan={UPLOAD_COLUMNS.length + 3} className="py-12 text-center text-[#94a3b8] text-sm">
                {filterText ? 'No rows match the filter.' : 'No rows yet — upload a PDF or add rows manually.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Toolbar: add row — checkbox selection actions (Edit/Duplicate/Delete/Clear) live in the header bar next to Save to Project */}
      <div className="sticky bottom-0 bg-white border-t border-[#e2e8f0] px-3 py-1.5 flex items-center gap-3 z-10 flex-wrap">
        <button type="button" onClick={addRow}
          className="text-xs text-[#2563eb] hover:text-[#1d4ed8] font-medium">
          + Add Row
        </button>
        {checkedIds.size > 0 && (
          <span className="text-xs text-[#475569] font-medium">{checkedIds.size} selected</span>
        )}
        <span className="text-[10px] text-[#94a3b8] ml-auto">
          {rows.length} rows · Double-click or F2 to edit · Ctrl+C copy · Ctrl+V paste · Ctrl+D fill down · Ctrl+Z undo
        </span>
        {rows.some(r => Object.values(r._confidence || {}).some(v => v < 0.5 && v > 0)) && (
          <span className="flex items-center gap-1 text-[10px] text-orange-600">
            <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
            Low-confidence cells highlighted — please review
          </span>
        )}
      </div>
    </div>
  );
});

UploadGrid.displayName = 'UploadGrid';
export default UploadGrid;
