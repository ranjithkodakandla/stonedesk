import React, { useState, useMemo } from 'react';

// ── Colour scheme ─────────────────────────────────────────────────────────────
const COLORS = {
  slab:           { fill: '#dbeafe', stroke: '#2563eb' },
  splash:         { fill: '#dcfce7', stroke: '#16a34a' },
  selected_slab:  { fill: '#bfdbfe', stroke: '#1d4ed8' },
  selected_splash:{ fill: '#bbf7d0', stroke: '#15803d' },
  no_dims:        { fill: '#fef9c3', stroke: '#ca8a04' },
};

function shapeColor(shape, selected) {
  if (!shape.dims_assigned) return selected ? COLORS.selected_slab   : COLORS.no_dims;
  const isSplash = shape.category === 'Splashes';
  if (selected) return isSplash ? COLORS.selected_splash : COLORS.selected_slab;
  return isSplash ? COLORS.splash : COLORS.slab;
}

// ── PageDiagram ───────────────────────────────────────────────────────────────
const PageDiagram = ({ pageData, selectedKey, onSelect }) => {
  const W = 580, H = 380;
  if (!pageData) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-[#94a3b8]">
        No shape data for this page
      </div>
    );
  }

  const { page_width: pw, page_height: ph, shapes = [] } = pageData;
  const scale = Math.min(W / pw, H / ph);
  const offsetX = (W - pw * scale) / 2;
  const offsetY = (H - ph * scale) / 2;

  const sx = (x) => offsetX + x * scale;
  const sy = (y) => offsetY + y * scale;

  return (
    <svg
      width={W} height={H}
      style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}
    >
      {/* Page outline */}
      <rect
        x={offsetX} y={offsetY}
        width={pw * scale} height={ph * scale}
        fill="white" stroke="#cbd5e1" strokeWidth={1}
      />

      {/* Detected shapes */}
      {shapes.map((shape, i) => {
        const [x0, y0, x1, y1] = shape.bbox;
        const key = shape.bbox.join(',');
        const sel = key === selectedKey;
        const { fill, stroke } = shapeColor(shape, sel);
        const rw = (x1 - x0) * scale;
        const rh = (y1 - y0) * scale;
        const fontSize = Math.max(6, Math.min(10, rw / 7));

        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={() => onSelect(key)}>
            <rect
              x={sx(x0)} y={sy(y0)}
              width={rw} height={rh}
              fill={fill} stroke={stroke}
              strokeWidth={sel ? 2 : 1}
              rx={2}
            />
            {rw > 30 && rh > 12 && (
              <text
                x={sx(x0) + rw / 2} y={sy(y0) + rh / 2}
                textAnchor="middle" dominantBaseline="middle"
                fill={stroke} fontSize={fontSize} fontWeight="600"
                style={{ pointerEvents: 'none' }}
              >
                {shape.part_no || shape.part?.slice(0, 10)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ── PieceEditor ───────────────────────────────────────────────────────────────
const CATEGORIES = ['Vanity','Kitchen','Laundry','Island','Splashes','Hearth','Bar','Utility','Other'];

const PieceEditor = ({ piece, onChange }) => {
  const update = (field, val) => onChange({ ...piece, [field]: val });
  const field = (label, key, type = 'text') => (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-[#64748b] w-24 shrink-0">{label}</span>
      {type === 'select' ? (
        <select
          value={piece[key] || ''}
          onChange={e => update(key, e.target.value)}
          className="flex-1 rounded border border-[#cbd5e1] px-2 py-0.5 text-xs text-[#334155]"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <input
          type={type} value={piece[key] || ''}
          onChange={e => update(key, e.target.value)}
          className="flex-1 rounded border border-[#cbd5e1] px-2 py-0.5 text-xs text-[#334155]"
        />
      )}
    </div>
  );

  return (
    <div className="p-4 border-b border-[#e2e8f0] bg-[#f8fafc]">
      <p className="text-xs font-bold text-[#0f172a] mb-2">Edit Piece</p>
      {field('Part #',      'part_no')}
      {field('Description', 'part')}
      {field('Category',    'category', 'select')}
      {field('Length (in)', 'length',   'number')}
      {field('Width (in)',  'width',    'number')}
      {field('Unit',        'unit')}
    </div>
  );
};

// ── PdfReviewModal ─────────────────────────────────────────────────────────────
const PdfReviewModal = ({ rows, reviewData, onClose, onSave }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedKey, setSelectedKey]  = useState(null);
  const [editedRows, setEditedRows]    = useState(() => rows.map(r => ({ ...r })));

  const pages = reviewData?.pages || [];
  const pageData = pages[currentPage] || null;

  // Map bbox key → row indices (one shape can correspond to many rows when expanded)
  const bboxToRowIdxs = useMemo(() => {
    const m = {};
    editedRows.forEach((r, i) => {
      const bbox = r._shape_bbox;
      if (bbox?.length === 4) {
        const k = bbox.join(',');
        if (!m[k]) m[k] = [];
        m[k].push(i);
      }
    });
    return m;
  }, [editedRows]);

  const selectedRowIdx = selectedKey ? (bboxToRowIdxs[selectedKey]?.[0] ?? null) : null;
  const selectedRow    = selectedRowIdx !== null ? editedRows[selectedRowIdx] : null;

  const updateRow = (updated) => {
    setEditedRows(prev => {
      const next = [...prev];
      // Propagate description / part_no edits to ALL rows sharing the same shape
      const idxs = bboxToRowIdxs[selectedKey] || [selectedRowIdx];
      idxs.forEach(i => {
        next[i] = {
          ...next[i],
          part:     updated.part,
          part_no:  updated.part_no,
          category: updated.category,
          length:   updated.length,
          width:    updated.width,
          unit:     updated.unit,
        };
      });
      return next;
    });
  };

  // Unique pieces for the right-side list (one row per shape bbox)
  const uniquePieces = useMemo(() => {
    const seen = new Set();
    return editedRows.filter(r => {
      const k = r._shape_bbox?.join(',') || `idx-${r._id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [editedRows]);

  const pageCount = pages.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-6xl flex flex-col shadow-2xl"
           style={{ height: '92vh' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#e2e8f0] shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#0f172a]">Review Extracted Data</h2>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              Blue = slab · Green = splash · Yellow = no dimensions assigned · Click a shape to edit
            </p>
          </div>
          <button onClick={onClose} className="text-[#94a3b8] hover:text-[#334155] text-xl leading-none">✕</button>
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex">

          {/* Left: Page schematic */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#f1f5f9] gap-3">
            <PageDiagram
              pageData={pageData}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />

            {/* Page navigation */}
            {pageCount > 1 && (
              <div className="flex items-center gap-3">
                <button
                  disabled={currentPage === 0}
                  onClick={() => { setCurrentPage(p => p - 1); setSelectedKey(null); }}
                  className="rounded-full border border-[#cbd5e1] px-3 py-1 text-xs disabled:opacity-40 hover:bg-white">
                  ← Prev
                </button>
                <span className="text-xs text-[#64748b]">
                  Page {currentPage + 1} / {pageCount}
                </span>
                <button
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => { setCurrentPage(p => p + 1); setSelectedKey(null); }}
                  className="rounded-full border border-[#cbd5e1] px-3 py-1 text-xs disabled:opacity-40 hover:bg-white">
                  Next →
                </button>
              </div>
            )}

            <p className="text-[10px] text-[#94a3b8]">
              {pageData?.shapes?.length ?? 0} unique shapes detected on this page
            </p>
          </div>

          {/* Right: Piece list + editor */}
          <div className="w-80 border-l border-[#e2e8f0] flex flex-col">
            {/* Editor for selected piece */}
            {selectedRow && (
              <PieceEditor piece={selectedRow} onChange={updateRow} />
            )}

            {/* Piece list */}
            <div className="flex-1 overflow-auto divide-y divide-[#e2e8f0]">
              {uniquePieces.length === 0 && (
                <p className="text-xs text-[#94a3b8] p-4 text-center">No pieces extracted yet</p>
              )}
              {uniquePieces.map((row, i) => {
                const k = row._shape_bbox?.join(',') || `idx-${row._id}`;
                const sel = k === selectedKey;
                const isSplash = row.category === 'Splashes';
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedKey(k)}
                    className={`px-3 py-2 cursor-pointer transition-colors
                      ${sel ? 'bg-blue-50' : 'hover:bg-[#f8fafc]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#1e293b] truncate">{row.part_no}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                        ${isSplash ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isSplash ? 'Splash' : 'Slab'}
                      </span>
                    </div>
                    <p className="text-xs text-[#475569] truncate mt-0.5">{row.part}</p>
                    <p className="text-[10px] text-[#94a3b8]">
                      {row.length || '?'}" × {row.width || '?'}"
                      {row.unit ? ` · ${row.unit}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#e2e8f0] shrink-0">
          <p className="text-xs text-[#94a3b8]">
            {editedRows.length} total rows · {uniquePieces.length} unique pieces
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-full border border-[#cbd5e1] px-4 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9]">
              Cancel
            </button>
            <button
              onClick={() => { onSave(editedRows); onClose(); }}
              className="rounded-full bg-[#2563eb] px-5 py-1.5 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
              Apply Corrections →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfReviewModal;
