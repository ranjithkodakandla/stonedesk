import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import PiecesGrid, { newRow, calcEdge, calcEdgeFromMap, edgeAreaFromMap, reindexAutoPartNos, MASTER_DESCRIPTIONS, DEFAULT_THICKNESS_MAP } from './PiecesGrid';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const parseCommaList = (str) => {
  const parts = (str || '').toString().split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [''];
};

const normalizeCellKey = (building, floor) => `${String(building).trim()}__${String(floor).trim()}`;

const parseFlatTokens = (text) =>
  String(text || '')
    .replace(/\r/g, '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);

// Flat # entry is always free-form (manual): 3-digit, 4-digit, or alphanumeric —
// no auto-chopping. Only delimiter normalization happens here, comma stays the separator.
const formatFlatDraft = (text) => String(text || '').replace(/[\r\n\t]+/g, ',').replace(/\s+/g, '');

const getThicknessHint = (part = '', category = '') => {
  const text = `${part || ''} ${category || ''}`.trim();
  if (/window sill/i.test(text)) return '2CM';
  if (/back splash/i.test(text)) return '2CM';
  if (/side splash/i.test(text)) return '2CM';
  if (/full height splash/i.test(text)) return '2CM';
  if (/splash/i.test(text)) return '2CM';
  if (/kitchen/i.test(text)) return '3CM';
  if (/island/i.test(text)) return '3CM';
  if (/vanity/i.test(text)) return '3CM';
  return '';
};

const inferMirrorThickness = (parts = [], fallback = '') => {
  const hints = parts.map(p => String(p?.thickness || '').trim()).filter(Boolean);
  if (!hints.length) return fallback || '';
  const unique = [...new Set(hints)];
  return unique.length === 1 ? unique[0] : 'Mixed';
};

const getNextNumericPartNo = (rows = [], drawingNo = '') => {
  const prefix = drawingNo ? `${drawingNo}-` : '';
  if (!prefix) return '';
  let maxValue = 0;
  let width = 2;
  rows.forEach(row => {
    const partNo = String(row?.part_no || '').trim();
    if (!partNo.startsWith(prefix)) return;
    const suffix = partNo.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    maxValue = Math.max(maxValue, Number(suffix));
    width = Math.max(width, suffix.length);
  });
  return `${prefix}${String(maxValue + 1).padStart(width, '0')}`;
};

// ── Matrix Cell with bulk comma entry ──────────────────────────────────────
const MatrixCell = ({ cellKey, entries, onSetEntries, onUpdateEntry, onRemoveEntry, buildingIdx, floorIdx, onMatrixPaste }) => {
  const [bulkText, setBulkText] = useState('');
  const [bulkQty, setBulkQty] = useState(1);

  const commit = () => {
    const raw = bulkText.trim();
    if (!raw) return;
    const parsed = parseFlatTokens(raw);
    if (!parsed.length) return;
    const existing = new Set(entries.map(e => String(e.flat).trim()));
    const toAdd = parsed.filter(f => !existing.has(f));
    if (toAdd.length) {
      onSetEntries(cellKey, [...entries, ...toAdd.map(f => ({ flat: f, qty: bulkQty }))]);
    }
    setBulkText('');
    setBulkQty(1);
  };

  return (
    <div className="p-1 min-w-[160px]">
      {/* Chips */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {entries.map((entry, idx) => (
            <span key={idx} className="inline-flex items-center gap-0.5 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
              <span className="font-mono text-xs text-blue-800">{entry.flat}</span>
              <span className="text-[10px] text-blue-300">×</span>
              <input
                type="number" min="1" value={entry.qty}
                onChange={e => onUpdateEntry(cellKey, idx, 'qty', Number(e.target.value) || 1)}
                className="w-7 text-xs text-center bg-transparent border-0 outline-none text-blue-700 font-semibold"
                title="Qty for this flat"
              />
              <button type="button" onClick={() => onRemoveEntry(cellKey, idx)}
                className="text-[10px] text-blue-300 hover:text-rose-500 leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      {/* Bulk input */}
      <div className="flex items-center gap-1">
        <input
          value={bulkText}
          onChange={e => setBulkText(formatFlatDraft(e.target.value))}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          onPaste={e => {
            const t = e.clipboardData.getData('text');
            if (t.includes('\n') || t.includes('\t')) {
              e.preventDefault();
              onMatrixPaste(buildingIdx, floorIdx, t);
              return;
            }
            e.preventDefault();
            setBulkText(formatFlatDraft(t));
          }}
          className="input-field py-0.5 text-xs flex-1 min-w-0 font-mono"
          placeholder={entries.length ? 'Add more…' : '101,102,103'}
        />
        <input
          type="number" min="1" value={bulkQty}
          onChange={e => setBulkQty(Number(e.target.value) || 1)}
          className="input-field py-0.5 text-xs w-10 text-center"
          title="Default qty for new entries"
        />
      </div>
    </div>
  );
};

// ── Searchable stone color picker with inline "add new color" ─────────────
const StoneColorPicker = ({ material, value, onSelect }) => {
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDensity, setNewDensity] = useState('');
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_BASE}/stone-colors`, { params: { material } })
      .then(res => { if (!cancelled) setOptions(res.data?.[material] || []); })
      .catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; };
  }, [material]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setAdding(false); }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const trimmedQuery = query.trim();
  const filtered = options.filter(o => o.name.toLowerCase().includes(trimmedQuery.toLowerCase()));
  const exactMatch = options.some(o => o.name.toLowerCase() === trimmedQuery.toLowerCase());

  const pick = (name) => {
    onSelect(name);
    setQuery(name);
    setOpen(false);
    setAdding(false);
  };

  const submitNewColor = async () => {
    if (!trimmedQuery) return;
    const density = Number(newDensity);
    if (!density || density <= 0) { setError('Enter a valid density (kg/m³).'); return; }
    try {
      const res = await axios.post(`${API_BASE}/stone-colors`, { material, name: trimmedQuery, density_kg_m3: density });
      setOptions(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      pick(res.data.name);
      setNewDensity('');
      setError('');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to add color.');
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        className="input-field"
        value={query}
        placeholder="Search or select color…"
        onChange={e => { setQuery(e.target.value); setOpen(true); setAdding(false); setError(''); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-[#e2e8f0] rounded-md shadow-lg text-sm">
          {filtered.map(o => (
            <button key={o.name} type="button"
              onClick={() => pick(o.name)}
              className={`block w-full text-left px-3 py-1.5 hover:bg-blue-50 ${o.name === value ? 'bg-blue-50 font-semibold' : ''}`}>
              {o.name}
            </button>
          ))}
          {filtered.length === 0 && !trimmedQuery && (
            <div className="px-3 py-2 text-xs text-slate-400">No colors for {material}</div>
          )}
          {trimmedQuery && !exactMatch && !adding && (
            <button type="button" onClick={() => setAdding(true)}
              className="block w-full text-left px-3 py-1.5 text-blue-600 font-medium hover:bg-blue-50 border-t border-[#f1f5f9]">
              + Add "{trimmedQuery}" as new color
            </button>
          )}
          {adding && (
            <div className="p-3 border-t border-[#f1f5f9] space-y-2">
              <label className="text-xs text-slate-500">Density (kg/m³) for "{trimmedQuery}"</label>
              <input type="number" min="1" step="1" value={newDensity}
                onChange={e => setNewDensity(e.target.value)}
                className="input-field text-sm" placeholder="e.g., 2650" autoFocus />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={submitNewColor} className="btn-primary text-xs px-2 py-1">Save color</button>
                <button type="button" onClick={() => { setAdding(false); setError(''); }} className="text-xs text-slate-500 px-2 py-1">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Mirror Existing Modal ───────────────────────────────────────────────────
const MirrorModal = ({ drawings, loading, onClose, onApply }) => {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [opts, setOpts] = useState({ parts: true, specs: true, matrix: false });

  const filtered = drawings.filter(d =>
    !filter || d.drawing.toLowerCase().includes(filter.toLowerCase()) ||
    (d.category || '').toLowerCase().includes(filter.toLowerCase())
  );

  const toggleOpt = (k) => setOpts(p => ({ ...p, [k]: !p[k] }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf2f7]">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a]">Mirror Existing Drawing</h3>
            <p className="text-xs text-[#64748b] mt-0.5">Select a saved drawing to copy into this workspace</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#94a3b8] hover:text-[#334155] text-lg leading-none">×</button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-[#edf2f7]">
          <input
            value={filter} onChange={e => setFilter(e.target.value)}
            className="input-field w-full text-sm" placeholder="Search drawing # or category…"
            autoFocus
          />
        </div>

        {/* Drawing list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {loading && <p className="text-sm text-[#94a3b8] text-center py-6">Loading drawings…</p>}
          {!loading && filtered.length === 0 && <p className="text-sm text-[#94a3b8] text-center py-6">No drawings found</p>}
          {!loading && filtered.map(d => (
            <button
              key={d.drawing} type="button"
              onClick={() => setSelected(d)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all
                ${selected?.drawing === d.drawing
                  ? 'border-[#2563eb] bg-blue-50 ring-1 ring-[#2563eb]'
                  : 'border-[#e2e8f0] hover:border-[#cbd5e1] hover:bg-[#f8fafc]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1e293b] font-mono">{d.drawing}</span>
                <span className="text-xs text-[#94a3b8]">{d.piece_count} pcs</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-medium text-[#475569] bg-[#f1f5f9] px-1.5 py-0.5 rounded">{d.category || 'No Category'}</span>
                {d.unit && <span className="text-[10px] text-[#64748b]">{d.unit}</span>}
                {d.destination_summary?.length > 0 && (
                  <span className="text-[10px] text-[#94a3b8] truncate max-w-[200px]">{d.destination_summary.slice(0, 3).join(', ')}{d.destination_summary.length > 3 ? '…' : ''}</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Options */}
        <div className="px-5 py-3 border-t border-[#edf2f7] bg-[#f8fafc]">
          <p className="text-xs font-semibold text-[#475569] mb-2">Copy from selected drawing:</p>
          <div className="flex flex-wrap gap-3">
            {[['parts', 'Part rows'], ['specs', 'Tech specs (edge/sink/radius)'], ['matrix', 'Copy matrix destinations']].map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={opts[k]} onChange={() => toggleOpt(k)}
                  className="rounded text-[#2563eb]" />
                <span className="text-xs text-[#334155]">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#edf2f7]">
          <button type="button" onClick={onClose} className="rounded-full border border-[#cbd5e1] bg-white px-4 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9]">Cancel</button>
          <button type="button" disabled={!selected} onClick={() => onApply(selected, opts)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${selected ? 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]' : 'bg-[#e2e8f0] text-[#94a3b8] cursor-not-allowed'}`}>
            Apply Mirror
          </button>
        </div>
      </div>
    </div>
  );
};

// Per-project density override (kg/m³) — overrides the shared/global stone color
// density for this project only. Every weight calc (summary, dispatch inventory,
// crate planning) recalculates live once this is saved.
function DensityOverrideControl({ project, onDataChange }) {
  const [value, setValue] = useState(project.density_override_kg_m3 ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(project.density_override_kg_m3 ?? '');
  }, [project.id, project.density_override_kg_m3]);

  const save = async (nextValue) => {
    setSaving(true);
    try {
      await axios.patch(`${API_BASE}/projects/${project.id}/density-override`, {
        density_kg_m3: nextValue === '' ? null : Number(nextValue),
      });
      onDataChange?.();
    } catch (err) {
      console.error('Failed to save density override', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="label-text">Density Override (kg/m³)</label>
      <div className="flex gap-1.5">
        <input
          type="number"
          min="1"
          placeholder="Global default"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => save(value)}
          className="input-field"
        />
        {project.density_override_kg_m3 != null && (
          <button
            type="button"
            disabled={saving}
            onClick={() => { setValue(''); save(''); }}
            className="rounded-lg border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50 whitespace-nowrap"
            title="Clear override, use global density again"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">This project only — leave blank to use the global color density.</p>
    </div>
  );
}

function WeightMultiplierControl({ project, onDataChange }) {
  const [value, setValue] = useState(project.weight_multiplier_kg_per_sqft ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(project.weight_multiplier_kg_per_sqft ?? '');
  }, [project.id, project.weight_multiplier_kg_per_sqft]);

  const save = async (nextValue) => {
    setSaving(true);
    try {
      await axios.patch(`${API_BASE}/projects/${project.id}/weight-multiplier`, {
        weight_multiplier_kg_per_sqft: nextValue === '' ? null : Number(nextValue),
      });
      onDataChange?.();
    } catch (err) {
      console.error('Failed to save weight multiplier', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="label-text">Weight Multiplying Factor (kg/sqft)</label>
      <div className="flex gap-1.5">
        <input
          type="number"
          min="0.1"
          step="0.01"
          placeholder="e.g., 7.75"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => save(value)}
          className="input-field"
        />
        {project.weight_multiplier_kg_per_sqft != null && (
          <button
            type="button"
            disabled={saving}
            onClick={() => { setValue(''); save(''); }}
            className="rounded-lg border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50 whitespace-nowrap"
            title="Clear override, use density-based weight again"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        Overrides density entirely: weight = sqft × this factor. Leave blank to use color density instead.
      </p>
    </div>
  );
}

const EntryForm = ({ project, setProject, onDataChange, loadedDrawing, onLoadedDrawingClear }) => {
  const thicknessAutoLockRef = useRef(false);
  const loadedPieceIdsRef = useRef([]);
  const loadedDrawingNoRef = useRef('');
  // ── Drawing Context (shared metadata) ──
  const [drawingCtx, setDrawingCtx] = useState({
    drawing: '', unit: '', category: 'Vanity', thickness: project.thickness || '3CM', building: '', floor: '', flat: '', notes: '',
    fragility: 'Standard', orientation: 'Auto', delivery_priority: 'Standard',
    stack_preference: 'Auto', weight_override: '',
    useProjectMaterialColor: true, material: project.material || 'Granite', stone_color: project.stone_color || '',
  });

  // ── Pieces Grid rows ──
  const [pieceRows, setPieceRows] = useState([newRow()]);

  // ── Destination Mode ──
  const [destMode, setDestMode] = useState('single'); // 'single' | 'matrix'
  const [matrixData, setMatrixData] = useState({ buildings: '', floors: '', cells: {} });

  // ── Clipboard state ──
  const [copiedParts, setCopiedParts] = useState(null);
  const [clipboardMatrix, setClipboardMatrix] = useState(null);

  // ── Mirror modal ──
  const [showMirrorModal, setShowMirrorModal] = useState(false);
  const [mirrorDrawings, setMirrorDrawings] = useState([]);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [mirrorMessage, setMirrorMessage] = useState('');
  const [editBanner, setEditBanner] = useState('');

  // ── Crate wood types (managed on the Configuration screen) ──
  const [woodTypes, setWoodTypes] = useState([]);
  useEffect(() => {
    axios.get(`${API_BASE}/crate-wood-types`)
      .then(res => setWoodTypes(res.data || []))
      .catch(() => setWoodTypes([]));
  }, []);

  // ── UI state ──
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef(null);

  useEffect(() => () => { if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current); }, []);

  useEffect(() => {
    if (!loadedDrawing) return;

    const nextThickness = loadedDrawing.thickness || inferMirrorThickness(loadedDrawing.unique_parts || [], project.thickness || '3CM') || '3CM';
    loadedDrawingNoRef.current = loadedDrawing.drawing || '';
    loadedPieceIdsRef.current = (loadedDrawing.pieces || []).map((piece) => piece.id).filter(Boolean);
    thicknessAutoLockRef.current = true;

    setEditBanner(`Editing existing drawing ${loadedDrawing.drawing || ''}`);
    setDrawingCtx(prev => ({
      ...prev,
      drawing: loadedDrawing.drawing || '',
      unit: loadedDrawing.unit || '',
      category: loadedDrawing.category || 'Vanity',
      thickness: nextThickness,
      fragility: loadedDrawing.fragility || 'Standard',
      orientation: loadedDrawing.orientation || 'Auto',
      delivery_priority: loadedDrawing.delivery_priority || 'Standard',
      stack_preference: loadedDrawing.stack_preference || 'Auto',
      weight_override: loadedDrawing.weight_override || '',
      building: '',
      floor: '',
      flat: '',
    }));
    setProject(prev => prev.thickness === nextThickness ? prev : { ...prev, thickness: nextThickness });

    const uniqueParts = loadedDrawing.unique_parts || [];
    const rows = uniqueParts.length > 0
      ? uniqueParts.map((p) => {
        const r = newRow(nextThickness);
        r.part_no = p.part_no || '';
        r._partNoAuto = true;
        r.part = p.part || '';
        r.length = p.length || '';
        r.width = p.width || '';
        r.thickness = p.thickness || nextThickness;
        r.qty = p.qty || 1;
        r.sink_type = p.sink_type || 'No Sink';
        r.sink_cut = p.sink_cut || '-';
        r.tap_holes = p.tap_holes || '-';
        r.grooves = p.grooves || '-';
        r.edge = p.edge || 'None';
        r.edge_area = p.edge_area || '';
        r.edge_map = p.edge_map ? { ...r.edge_map, ...p.edge_map } : { ...r.edge_map };
        r.edge_polish_manual = p.edge_polish_manual || '';
        r.radius = p.radius || '-';
        r.radius_value = p.radius_value || '';
        r.radius_corners = p.radius_corners ? { ...r.radius_corners, ...p.radius_corners } : { ...r.radius_corners };
        r.shape_type = p.shape_type || '';
        r.notes = p.notes || '';
        return r;
      })
      : [newRow(nextThickness)];

    setPieceRows(rows);
    setMatrixData({
      buildings: (loadedDrawing.buildings || []).join(','),
      floors: (loadedDrawing.floors || []).join(','),
      cells: loadedDrawing.cells || {},
    });
    setDestMode((loadedDrawing.buildings || []).length && (loadedDrawing.floors || []).length ? 'matrix' : 'single');
    setMirrorMessage('');
  }, [loadedDrawing, setProject]);

  // ── Handlers ──
  const handleCtx = (e) => {
    const { name, value } = e.target;
    setDrawingCtx(prev => ({ ...prev, [name]: value }));
    // When Drawing # changes, regenerate auto part_nos (respects splash → letter / other → number)
    if (name === 'drawing') {
      setPieceRows(prev => reindexAutoPartNos(prev, value, { forceReassign: true }));
    }
    if (name === 'category') {
      const hint = getThicknessHint('', value);
      if (hint && !thicknessAutoLockRef.current) {
        setDrawingCtx(prev => ({ ...prev, thickness: hint }));
        setProject(prev => prev.thickness === hint ? prev : { ...prev, thickness: hint });
      }
    }
    if (name === 'thickness') {
      thicknessAutoLockRef.current = true;
      setProject(prev => prev.thickness === value ? prev : { ...prev, thickness: value });
    }
  };

  const handleProjectChange = (e) => {
    const { name, value } = e.target;
    setProject(prev => ({ ...prev, [name]: value }));
  };

  const handleProjectBlur = async (e) => {
    if (!project.id) return;
    try {
      await axios.put(`${API_BASE}/projects/${project.id}`, { ...project, [e.target.name]: e.target.value });
      onDataChange?.();
    } catch (err) { console.error('Failed to save project details', err); }
  };

  // ── Matrix helpers ──
  const matrixConfig = useMemo(() => ({
    buildings: parseCommaList(matrixData.buildings).filter(Boolean),
    floors: parseCommaList(matrixData.floors).filter(Boolean),
  }), [matrixData.buildings, matrixData.floors]);

  const getCellEntries = (key) => matrixData.cells[key] || [];
  const setCellEntries = (key, entries) =>
    setMatrixData(prev => ({ ...prev, cells: { ...prev.cells, [key]: entries } }));
  const addCellEntry = (key) =>
    setCellEntries(key, [...getCellEntries(key), { flat: '', qty: 1 }]);
  const updateCellEntry = (key, idx, field, value) => {
    const arr = getCellEntries(key).map((e, i) => i === idx ? { ...e, [field]: value } : e);
    setCellEntries(key, arr);
  };
  const removeCellEntry = (key, idx) =>
    setCellEntries(key, getCellEntries(key).filter((_, i) => i !== idx));

  // Paste from Excel: rows → floors, columns → buildings.
  const handleMatrixPaste = (startBldgIdx, startFloorIdx, text) => {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(r => r.split('\t'));
    if (!lines.length) return;
    setMatrixData(prev => {
      const nextCells = { ...prev.cells };
      lines.forEach((row, ri) => {
        const floor = matrixConfig.floors[startFloorIdx + ri];
        if (!floor) return;
        row.forEach((val, ci) => {
          const building = matrixConfig.buildings[startBldgIdx + ci];
          if (!building) return;
          const key = normalizeCellKey(building, floor);
          const entries = parseFlatTokens(val).map(s => ({ flat: s, qty: 1 }));
          if (entries.length) nextCells[key] = entries;
        });
      });
      return { ...prev, cells: nextCells };
    });
  };

  const handleDescriptionThicknessChange = async (description, newThickness) => {
    const newMap = { ...DEFAULT_THICKNESS_MAP, ...(project.description_thickness_map || {}), [description]: newThickness };
    setProject(prev => ({ ...prev, description_thickness_map: newMap }));
    // Update any existing rows that use this description immediately
    setPieceRows(prev => prev.map(r => r.part === description ? { ...r, thickness: newThickness } : r));
    if (!project.id) return;
    try { await axios.put(`${API_BASE}/projects/${project.id}`, { ...project, description_thickness_map: newMap }); }
    catch (err) { console.error('Failed to save thickness map', err); }
  };

  // ── Quick Actions ──────────────────────────────────────────────────────────
  const handleDuplicateDrawing = () => {
    setDrawingCtx(prev => ({ ...prev, drawing: '', unit: '' }));
  };

  const handleCopyParts = () => {
    setCopiedParts(pieceRows.map(r => ({ ...r })));
  };

  const handlePasteParts = () => {
    if (!copiedParts) return;
    const freshRows = copiedParts.map(r => {
      const fresh = newRow();
      return { ...fresh, ...r, _id: fresh._id, _partNoAuto: true };
    });
    setPieceRows(reindexAutoPartNos(freshRows, drawingCtx.drawing));
  };

  const handleCopyMatrix = () => {
    setClipboardMatrix(JSON.parse(JSON.stringify(matrixData)));
  };

  const handlePasteMatrix = () => {
    if (!clipboardMatrix) return;
    setMatrixData(clipboardMatrix);
    setDestMode('matrix');
  };

  const handleClearMatrix = () => {
    setMatrixData(prev => ({ ...prev, cells: {} }));
  };

  const handleOpenMirror = async () => {
    if (!project.id) return;
    setShowMirrorModal(true);
    setMirrorLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/projects/${project.id}/drawings/`);
      setMirrorDrawings(res.data || []);
    } catch (err) {
      console.error('Failed to load drawings', err);
    } finally {
      setMirrorLoading(false);
    }
  };

  const handleApplyMirror = (d, opts) => {
    const mirroredThickness = inferMirrorThickness(d.unique_parts || [], project.thickness || '');
    if (mirroredThickness) {
      thicknessAutoLockRef.current = false;
      setDrawingCtx(prev => ({ ...prev, thickness: mirroredThickness }));
      setProject(prev => prev.thickness === mirroredThickness ? prev : { ...prev, thickness: mirroredThickness });
    }
    if (opts.specs) {
      setDrawingCtx(prev => ({
        ...prev,
        drawing: '',
        unit: '',
        category: d.category || prev.category,
        fragility: d.fragility || prev.fragility,
        orientation: d.orientation || prev.orientation,
        delivery_priority: d.delivery_priority || prev.delivery_priority,
        stack_preference: d.stack_preference || prev.stack_preference,
        weight_override: d.weight_override || '',
      }));
    }
    if (opts.parts && (d.unique_parts || []).length > 0) {
      // Drawing # is cleared after mirror — mark rows as auto so they pick up the new Drawing # when entered
      const rows = d.unique_parts.map((p, idx) => {
        const r = newRow();
        r._partNoAuto = true;
        r.part_no = ''; // will auto-fill once user enters a Drawing #
        r.part = p.part || '';
        r.length = p.length || '';
        r.width = p.width || '';
        r.thickness = p.thickness || mirroredThickness || project.thickness || '3CM';
        r.qty = 1;
        if (opts.specs) {
          r.sink_type = p.sink_type || 'No Sink';
          r.sink_cut = p.sink_cut || '-';
          r.tap_holes = p.tap_holes || '-';
          r.grooves = p.grooves || '-';
          r.edge = p.edge || 'None';
          r.edge_area = p.edge_area || '';
          r.edge_map = p.edge_map ? { ...r.edge_map, ...p.edge_map } : { ...r.edge_map };
          r.edge_polish_manual = p.edge_polish_manual || '';
          r.radius = p.radius || '-';
          r.radius_value = p.radius_value || '';
          r.radius_corners = p.radius_corners ? { ...r.radius_corners, ...p.radius_corners } : { ...r.radius_corners };
          r.shape_type = p.shape_type || '';
          r.notes = p.notes || '';
        }
        return r;
      });
      setPieceRows(rows);
    }
    if (opts.matrix) {
      setMatrixData({
        buildings: (d.buildings || []).join(','),
        floors: (d.floors || []).join(','),
        cells: d.cells || {},
      });
      setDestMode('matrix');
    } else {
      setMatrixData({ buildings: '', floors: '', cells: {} });
    }
    setMirrorMessage('Parts/specs copied. Destination matrix cleared for fresh assignment.');
    setShowMirrorModal(false);
  };

  // ── Build destinations ──
  const buildDestinations = () => {
    if (destMode === 'single') {
      const buildings = parseCommaList(drawingCtx.building).filter(Boolean);
      const floors = parseCommaList(drawingCtx.floor).filter(Boolean);
      const flats = parseCommaList(drawingCtx.flat).filter(Boolean);
      if (!buildings.length && !floors.length && !flats.length) return [{ building: '', floor: '', flat: '', matrixQty: null }];
      const dests = [];
      for (const b of (buildings.length ? buildings : [''])) {
        for (const fl of (floors.length ? floors : [''])) {
          for (const ft of (flats.length ? flats : [''])) {
            dests.push({ building: b, floor: fl, flat: ft, matrixQty: null });
          }
        }
      }
      return dests;
    }
    const dests = [];
    matrixConfig.buildings.forEach(building => {
      matrixConfig.floors.forEach(floor => {
        const key = normalizeCellKey(building, floor);
        getCellEntries(key).filter(e => e.flat.trim()).forEach(e => {
          dests.push({ building, floor, flat: e.flat.trim(), matrixQty: Number(e.qty) || 1 });
        });
      });
    });
    return dests.length ? dests : [{ building: '', floor: '', flat: '', matrixQty: null }];
  };

  const destinations = useMemo(() => buildDestinations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destMode, drawingCtx.building, drawingCtx.floor, drawingCtx.flat, matrixData, matrixConfig]);

  useEffect(() => {
    const nextThickness = drawingCtx.thickness || project.thickness || '3CM';
    const thicknessMap = { ...DEFAULT_THICKNESS_MAP, ...(project.description_thickness_map || {}) };
    setPieceRows(prev => {
      let changed = false;
      const nextRows = prev.map(row => {
        // Leave rows alone if their description already drives thickness
        if (row.part && thicknessMap[row.part]) return row;
        if (row.thickness === nextThickness) return row;
        changed = true;
        return { ...row, thickness: nextThickness };
      });
      return changed ? nextRows : prev;
    });
  }, [drawingCtx.thickness, project.thickness, project.description_thickness_map]);

  const activeDests = destinations.filter(d => d.building || d.floor || d.flat);
  const destCount = activeDests.length || 1;

  const validRows = pieceRows.filter(r => (r.part_no || r.part) && r.length && r.width);
  const totalPieces = validRows.reduce((total, row) => {
    if (!activeDests.length) return total + (Number(row.qty) || 1);
    return total + activeDests.reduce((s, dest) => {
      const destKey = [dest.building, dest.floor, dest.flat].filter(Boolean).join('/');
      const qty = dest.matrixQty != null ? dest.matrixQty
        : (row.dest_qty_overrides?.[destKey] != null ? Number(row.dest_qty_overrides[destKey]) : Number(row.qty) || 1);
      return s + qty;
    }, 0);
  }, 0) || 0;

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validRows.length) { alert('Add at least one piece with Part # or Description, Length, and Width filled.'); return; }

    const piecesToCreate = [];
    for (const dest of destinations) {
      for (const row of validRows) {
        const destKey = [dest.building, dest.floor, dest.flat].filter(Boolean).join('/');
        const effectiveQty = dest.matrixQty != null
          ? dest.matrixQty
          : (row.dest_qty_overrides?.[destKey] != null)
            ? Number(row.dest_qty_overrides[destKey])
            : Number(row.qty) || 1;

        const hasEdgeMap = Object.values(row.edge_map || {}).some(v => v !== 'none');
        const computedEdgeArea = hasEdgeMap ? edgeAreaFromMap(row.edge_map) : (row.edge_area || '');
        const computedEdgeMachine = hasEdgeMap
          ? calcEdgeFromMap(row.length, row.width, row.edge_map)
          : calcEdge(row.length, row.width, row.edge_area);

        const activeCorners = Object.values(row.radius_corners || {}).filter(Boolean).length;
        const radiusValue = activeCorners > 0 ? String(activeCorners) : (row.radius || '-');

        for (let i = 0; i < effectiveQty; i++) {
          piecesToCreate.push({
            part: row.part || '',
            part_no: row.part_no || '',
            category: drawingCtx.category,
            drawing: drawingCtx.drawing || '',
            length: row.length,
            width: row.width,
            thickness: row.thickness || drawingCtx.thickness || project.thickness || '3CM',
            material: drawingCtx.useProjectMaterialColor ? '' : (drawingCtx.material || ''),
            stone_color: drawingCtx.useProjectMaterialColor ? '' : (drawingCtx.stone_color || ''),
            unit: drawingCtx.unit || '',
            sink_type: row.sink_type || 'No Sink',
            sink_cut: row.sink_cut || '-',
            tap_holes: row.tap_holes || '-',
            grooves: row.grooves || '-',
            fragility: drawingCtx.fragility || 'Standard',
            orientation: drawingCtx.orientation || 'Auto',
            delivery_priority: drawingCtx.delivery_priority || 'Standard',
            stack_preference: drawingCtx.stack_preference || 'Auto',
            weight_override: Number(drawingCtx.weight_override) || 0,
            edge: row.edge || 'None',
            edge_area: computedEdgeArea,
            edge_polish_machine: computedEdgeMachine,
            edge_map: row.edge_map || {},
            edge_polish_manual: row.edge_polish_manual || '',
            radius: radiusValue,
            radius_value: row.radius_value || '',
            radius_corners: row.radius_corners || {},
            shape_type: row.shape_type || '',
            notes: row.notes || '',
            qty: 1,
            building: dest.building,
            floor: dest.floor,
            flat: dest.flat,
          });
        }
      }
    }

    try {
      setIsSubmitting(true);
      setShowSpinner(false);
      spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 2000);
      const isEditingExisting = loadedPieceIdsRef.current.length > 0;
      if (isEditingExisting) {
        const existingIds = [...loadedPieceIdsRef.current];
        const matchCount = Math.min(existingIds.length, piecesToCreate.length);
        // Update 1:1 by position
        for (let i = 0; i < matchCount; i++) {
          await axios.put(`${API_BASE}/pieces/${existingIds[i]}`, piecesToCreate[i]);
        }
        // Flats were added — create the extra pieces
        if (piecesToCreate.length > existingIds.length) {
          await axios.post(
            `${API_BASE}/projects/${project.id}/pieces/batch`,
            piecesToCreate.slice(existingIds.length),
          );
        }
        // Flats were removed — delete orphaned pieces
        if (existingIds.length > piecesToCreate.length) {
          await Promise.all(
            existingIds.slice(piecesToCreate.length).map((id) => axios.delete(`${API_BASE}/pieces/${id}`)),
          );
        }
      } else {
        await axios.post(`${API_BASE}/projects/${project.id}/pieces/batch`, piecesToCreate);
      }
      const nextPartNo = getNextNumericPartNo(validRows, drawingCtx.drawing);
      const [freshRow] = reindexAutoPartNos([{
        ...newRow(drawingCtx.thickness || project.thickness || '3CM'),
        part_no: nextPartNo,
        _partNoAuto: true,
      }], drawingCtx.drawing);
      setPieceRows([freshRow]);
      if (isEditingExisting) {
        alert(`${piecesToCreate.length} pieces updated successfully!`);
        onLoadedDrawingClear?.();
        loadedPieceIdsRef.current = [];
        loadedDrawingNoRef.current = '';
        setEditBanner('');
      } else {
        alert(`${piecesToCreate.length} pieces saved successfully!`);
      }
      onDataChange();
    } catch (error) {
      console.error(error);
      alert('Error adding pieces');
    } finally {
      if (spinnerTimerRef.current) { clearTimeout(spinnerTimerRef.current); spinnerTimerRef.current = null; }
      setShowSpinner(false);
      setIsSubmitting(false);
    }
  };

  const clearDrawing = () => {
    setDrawingCtx({ drawing: '', unit: '', category: 'Vanity', building: '', floor: '', flat: '', notes: '',
      thickness: project.thickness || '3CM',
      fragility: 'Standard', orientation: 'Auto', delivery_priority: 'Standard', stack_preference: 'Auto', weight_override: '',
      useProjectMaterialColor: true, material: project.material || 'Granite', stone_color: project.stone_color || '' });
    thicknessAutoLockRef.current = false;
    setPieceRows([newRow(drawingCtx.thickness || project.thickness || '3CM')]);
    setMatrixData({ buildings: '', floors: '', cells: {} });
    setMirrorMessage('');
    setEditBanner('');
    loadedPieceIdsRef.current = [];
    loadedDrawingNoRef.current = '';
    onLoadedDrawingClear?.();
  };

  const handleStoneColorSelect = async (colorName) => {
    setProject(prev => ({ ...prev, stone_color: colorName }));
    if (!project.id) return;
    try {
      await axios.put(`${API_BASE}/projects/${project.id}`, { ...project, stone_color: colorName });
      onDataChange?.();
    } catch (err) { console.error('Failed to save stone color', err); }
  };

  // ── Render ──
  return (
    <div className="mb-6">
      {/* Mirror modal */}
      {showMirrorModal && (
        <MirrorModal
          drawings={mirrorDrawings}
          loading={mirrorLoading}
          onClose={() => setShowMirrorModal(false)}
          onApply={handleApplyMirror}
        />
      )}

      {/* ── Project Details ── */}
      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0] p-5 mb-6">
        <h2 className="text-lg font-bold text-[#1e293b] mb-4">Project Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
          <div><label className="label-text">Project Name</label><input name="name" value={project.name || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Material</label><select name="material" value={project.material} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>Granite</option><option>Quartz</option><option>Marble</option></select></div>
          <div>
            <label className="label-text">Stone Color</label>
            <StoneColorPicker
              material={project.material}
              value={project.stone_color || ''}
              onSelect={handleStoneColorSelect}
            />
          </div>
          <div><label className="label-text">Crate Wood</label><select name="crate_wood_type" value={project.crate_wood_type || 'Pine'} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field">{woodTypes.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}</select></div>
          <div><label className="label-text">Wood Thick. (in)</label><input type="number" step="0.125" min="0.5" name="crate_wood_thickness" value={project.crate_wood_thickness ?? 1.25} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Customer</label><input name="customer" value={project.customer || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Job #</label><input name="job_number" value={project.job_number || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Date</label><input type="date" name="date" value={project.date || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <DensityOverrideControl project={project} onDataChange={onDataChange} />
          <WeightMultiplierControl project={project} onDataChange={onDataChange} />
        </div>

        {/* ── Thickness Mapping ── */}
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-8 gap-4">
          <div className="md:col-span-8">
            <label className="label-text">Default Thickness per Part Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 mt-1.5">
              {MASTER_DESCRIPTIONS.map(desc => {
                const map = { ...DEFAULT_THICKNESS_MAP, ...(project.description_thickness_map || {}) };
                const current = map[desc] || '3CM';
                return (
                  <div key={desc} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 truncate flex-1 min-w-0" title={desc}>{desc}</span>
                    <div className="flex gap-0.5 shrink-0">
                      {['2CM', '3CM'].map(t => (
                        <button key={t} type="button"
                          onClick={() => handleDescriptionThicknessChange(desc, t)}
                          className={`px-1.5 py-0.5 text-[10px] rounded border font-medium transition-colors
                            ${current === t ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Drawing Workspace ── */}
      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0]">
        <form onSubmit={handleSubmit}>

          {/* Drawing Header */}
          <div className="px-5 pt-5 pb-3 border-b border-[#edf2f7]">
            <div className="flex items-start justify-between mb-3 gap-4">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Drawing Workspace</h3>
                <p className="text-xs text-[#64748b]">Enter drawing-level info once, then add all pieces below.</p>
              </div>
              {/* ── Quick Actions Bar ── */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button type="button" onClick={handleDuplicateDrawing}
                  className="inline-flex items-center gap-1 rounded border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9] hover:border-[#94a3b8] transition-colors"
                  title="Clone this drawing (clears Drawing # and Unit)">
                  ⧉ Duplicate
                </button>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={handleCopyParts}
                    className="inline-flex items-center gap-1 rounded border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9] transition-colors"
                    title="Copy all piece rows to clipboard">
                    ⊕ Copy Parts
                  </button>
                  <button type="button" onClick={handlePasteParts} disabled={!copiedParts}
                    className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors
                      ${copiedParts ? 'border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f1f5f9]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#cbd5e1] cursor-not-allowed'}`}
                    title="Paste copied piece rows">
                    ⊞ Paste Parts
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={handleCopyMatrix}
                    className="inline-flex items-center gap-1 rounded border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9] transition-colors"
                    title="Copy matrix to clipboard">
                    ⊕ Copy Matrix
                  </button>
                  <button type="button" onClick={handlePasteMatrix} disabled={!clipboardMatrix}
                    className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors
                      ${clipboardMatrix ? 'border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f1f5f9]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#cbd5e1] cursor-not-allowed'}`}
                    title="Paste matrix from clipboard">
                    ⊞ Paste Matrix
                  </button>
                  <button type="button" onClick={handleClearMatrix}
                    className="inline-flex items-center gap-1 rounded border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-colors"
                    title="Clear all matrix entries">
                    ✕ Clear Matrix
                  </button>
                </div>
                <button type="button" onClick={handleOpenMirror} disabled={!project.id}
                  className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors
                    ${project.id ? 'border-[#a78bfa] bg-violet-50 text-violet-700 hover:bg-violet-100' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#cbd5e1] cursor-not-allowed'}`}
                  title="Mirror an existing saved drawing">
                  ↗ Mirror Existing
                </button>
                <button type="button" onClick={clearDrawing}
                  className="text-xs text-[#94a3b8] hover:text-[#64748b] underline px-1">
                  Clear All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-8 gap-3">
              <div><label className="label-text">Drawing #</label><input name="drawing" value={drawingCtx.drawing} onChange={handleCtx} className="input-field" placeholder="1041-01" /></div>
              <div><label className="label-text">Unit Name</label><input name="unit" value={drawingCtx.unit} onChange={handleCtx} className="input-field" placeholder="1A Unit" /></div>
              <div><label className="label-text">Category</label>
                <select name="category" value={drawingCtx.category} onChange={handleCtx} className="input-field">
                  <option>Vanity</option><option>Kitchen</option><option>Laundry</option><option>Island</option><option>Splashes</option><option>Hearth</option><option>Bar</option><option>Utility</option><option>Other</option>
                </select>
              </div>
<div><label className="label-text">Fragility</label><select name="fragility" value={drawingCtx.fragility} onChange={handleCtx} className="input-field"><option>Standard</option><option>Fragile</option><option>High</option></select></div>
              <div><label className="label-text">Orientation</label><select name="orientation" value={drawingCtx.orientation} onChange={handleCtx} className="input-field"><option>Auto</option><option>No Rotate</option><option>Long Edge Vertical</option><option>Finished Face Protected</option></select></div>
              <div><label className="label-text">Priority</label><select name="delivery_priority" value={drawingCtx.delivery_priority} onChange={handleCtx} className="input-field"><option>Standard</option><option>First Off</option><option>Last Off</option><option>Rush</option></select></div>
              <div><label className="label-text">Stacking</label><select name="stack_preference" value={drawingCtx.stack_preference} onChange={handleCtx} className="input-field"><option>Auto</option><option>No Stack</option><option>Stack Allowed</option></select></div>
              <div className="col-span-2 md:col-span-3 lg:col-span-4 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="useProjectMaterialColor"
                  checked={drawingCtx.useProjectMaterialColor}
                  onChange={(e) => setDrawingCtx(prev => ({ ...prev, useProjectMaterialColor: e.target.checked }))}
                  className="rounded border-[#cbd5e1]"
                />
                <label htmlFor="useProjectMaterialColor" className="text-xs font-medium text-[#475569]">
                  Use project material &amp; color for this drawing
                </label>
              </div>
              <div>
                <label className="label-text">Material {drawingCtx.useProjectMaterialColor && <span className="text-[#94a3b8]">(project)</span>}</label>
                <select
                  name="material"
                  value={drawingCtx.useProjectMaterialColor ? (project.material || 'Granite') : drawingCtx.material}
                  onChange={handleCtx}
                  disabled={drawingCtx.useProjectMaterialColor}
                  className="input-field disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
                >
                  <option>Granite</option><option>Quartz</option><option>Marble</option>
                </select>
              </div>
              <div>
                <label className="label-text">Stone Color {drawingCtx.useProjectMaterialColor && <span className="text-[#94a3b8]">(project)</span>}</label>
                {drawingCtx.useProjectMaterialColor ? (
                  <input className="input-field disabled:bg-[#f8fafc] disabled:text-[#94a3b8]" value={project.stone_color || ''} disabled />
                ) : (
                  <StoneColorPicker
                    material={drawingCtx.material}
                    value={drawingCtx.stone_color || ''}
                    onSelect={(colorName) => setDrawingCtx(prev => ({ ...prev, stone_color: colorName }))}
                  />
                )}
              </div>
              <div><label className="label-text">Wt Override (kg)</label><input name="weight_override" type="number" step="0.1" value={drawingCtx.weight_override} onChange={handleCtx} className="input-field" placeholder="Optional" /></div>
            </div>
          </div>

          {/* Mirror message banner */}
          {mirrorMessage && (
            <div className="px-5 py-2 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
              <span className="text-xs text-violet-700 font-medium">{mirrorMessage}</span>
              <button type="button" onClick={() => setMirrorMessage('')} className="text-violet-400 hover:text-violet-600 ml-3 text-base leading-none">×</button>
            </div>
          )}
          {editBanner && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
              <span className="text-xs text-amber-700 font-medium">{editBanner}</span>
              <button type="button" onClick={() => { setEditBanner(''); loadedPieceIdsRef.current = []; loadedDrawingNoRef.current = ''; onLoadedDrawingClear?.(); }} className="text-amber-400 hover:text-amber-600 ml-3 text-base leading-none">×</button>
            </div>
          )}

          {/* Destination Section */}
          <div className="px-5 py-3 border-b border-[#edf2f7] bg-[#f8fafc]">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-sm font-semibold text-[#334155]">Destination</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => setDestMode('single')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${destMode === 'single' ? 'bg-[#1e293b] text-white' : 'bg-white border border-[#cbd5e1] text-[#475569]'}`}>
                  Single / Comma-List
                </button>
                <button type="button" onClick={() => setDestMode('matrix')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${destMode === 'matrix' ? 'bg-[#1e293b] text-white' : 'bg-white border border-[#cbd5e1] text-[#475569]'}`}>
                  Matrix Grid
                </button>
              </div>
            </div>

            {destMode === 'single' && (
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label-text">Building</label><input name="building" value={drawingCtx.building} onChange={handleCtx} className="input-field" placeholder="e.g., 13 or A,B" /></div>
                <div><label className="label-text">Floor</label><input name="floor" value={drawingCtx.floor} onChange={handleCtx} className="input-field" placeholder="e.g., 1,2,3" /></div>
                <div><label className="label-text">Flat</label><input name="flat" value={drawingCtx.flat} onChange={handleCtx} className="input-field" placeholder="e.g., 101,102,201" /></div>
              </div>
            )}

            {destMode === 'matrix' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label-text">Buildings (comma-separated)</label><input value={matrixData.buildings} onChange={e => setMatrixData(p => ({ ...p, buildings: e.target.value }))} className="input-field" placeholder="1,2,3,4" /></div>
                  <div><label className="label-text">Floors (comma-separated)</label><input value={matrixData.floors} onChange={e => setMatrixData(p => ({ ...p, floors: e.target.value }))} className="input-field" placeholder="1,2,3" /></div>
                </div>
                {matrixConfig.buildings.length > 0 && matrixConfig.floors.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-[#cbd5e1] bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-[#f1f5f9]">
                        <tr>
                          <th className="p-2 text-left sticky left-0 bg-[#f1f5f9] z-10 text-[#475569]">Floor \ Bldg</th>
                          {matrixConfig.buildings.map(b => (
                            <th key={b} className="p-2 text-left min-w-[190px] text-[#475569]">Bldg {b}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixConfig.floors.map(floor => (
                          <tr key={floor} className="border-t border-[#e2e8f0]">
                            <td className="p-2 font-semibold text-[#1e293b] sticky left-0 bg-white whitespace-nowrap">
                              Floor {floor}
                            </td>
                            {matrixConfig.buildings.map(building => {
                              const key = normalizeCellKey(building, floor);
                              const entries = getCellEntries(key);
                              return (
                                <td key={key} className="align-top border-l border-[#f1f5f9]">
                                  <MatrixCell
                                    cellKey={key}
                                    entries={entries}
                                    onSetEntries={setCellEntries}
                                    onUpdateEntry={updateCellEntry}
                                    onRemoveEntry={removeCellEntry}
                                    buildingIdx={matrixConfig.buildings.indexOf(building)}
                                    floorIdx={matrixConfig.floors.indexOf(floor)}
                                    onMatrixPaste={handleMatrixPaste}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="text-[10px] text-[#94a3b8]">
                  Type comma-separated flats (101,102,103) + qty, then press Enter or Tab. Paste from Excel to fill flat numbers (rows → floors, columns → buildings).
                </div>
              </div>
            )}
          </div>

          {/* Pieces Grid */}
          <div className="px-5 py-4">
              <PiecesGrid
              rows={pieceRows}
              setRows={setPieceRows}
              material={project.material}
              thickness={drawingCtx.thickness || project.thickness}
              defaultThickness={drawingCtx.thickness || project.thickness}
              category={drawingCtx.category}
              onCategoryDetected={(cat) => setDrawingCtx(prev => ({ ...prev, category: cat }))}
              onThicknessSuggested={(hint) => {
                if (!hint || thicknessAutoLockRef.current) return;
                setDrawingCtx(prev => ({ ...prev, thickness: hint }));
                setProject(prev => prev.thickness === hint ? prev : { ...prev, thickness: hint });
              }}
              destinations={destinations}
              drawingNo={drawingCtx.drawing}
              masterDescriptions={MASTER_DESCRIPTIONS}
              descriptionThicknessMap={{ ...DEFAULT_THICKNESS_MAP, ...(project.description_thickness_map || {}) }}
            />
          </div>

          {/* Footer */}
          <div className="border-t border-[#edf2f7] px-5 py-4 bg-[#f8fafc] rounded-b-lg flex justify-between items-center flex-wrap gap-3">
            <div className="text-sm text-[#475569] font-medium">
              {validRows.length > 0 ? (
                <>
                  <span className="text-[#2563eb] font-bold">{validRows.length}</span> piece type{validRows.length !== 1 ? 's' : ''}
                  {destCount > 1 && <> × <span className="text-[#2563eb] font-bold">{destCount}</span> flat{destCount !== 1 ? 's' : ''}</>}
                  {' = '}
                  <span className="text-[#059669] font-bold">{totalPieces}</span> total records
                </>
              ) : (
                <span className="text-[#94a3b8]">Add pieces above to save</span>
              )}
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={isSubmitting || !validRows.length}
                className={`btn-primary inline-flex items-center gap-2 ${isSubmitting || !validRows.length ? 'opacity-60 cursor-not-allowed' : ''}`}>
                {showSpinner && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                {showSpinner ? 'Saving...' : `Save Drawing (${totalPieces} pcs)`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EntryForm;
