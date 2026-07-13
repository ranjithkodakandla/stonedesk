import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import UploadGrid, { blankRow, UPLOAD_COLUMNS } from './UploadGrid';
import PdfReviewModal from './PdfReviewModal';
import { mergeNimRowsForPage } from '../utils/nimUtils';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_OPTIONS  = ['Vanity','Kitchen','Laundry','Island','Splashes','Hearth','Bar','Utility','Other'];
const EDGE_OPTIONS      = ['None','Eased','Bullnose','Bevel','Ogee','Miter','Waterfall','Laminate'];
const SINK_OPTIONS      = ['No Sink','Single Bowl','Double Bowl','Bar Sink','Undermount'];
const THICKNESS_OPTIONS = ['2CM','3CM','Mixed'];

// Map grid row → PieceCreate payload
const rowToPayload = (row) => ({
  part:          row.part      || '',
  part_no:       row.part_no   || '',
  category:      row.category  || 'Other',
  drawing:       row.drawing   || '',
  length:        parseFloat(row.length)  || 0,
  width:         parseFloat(row.width)   || 0,
  qty:           parseInt(row.qty)       || 1,
  unit:          row.unit      || '',
  building:      row.building  || '',
  floor:         row.floor     || '',
  flat:          row.flat      || '',
  sink_type:     row.sink_type || 'No Sink',
  sink_cut:      row.sink_cut  || '-',
  tap_holes:     row.tap_holes || '-',
  grooves:       row.grooves   || '-',
  fragility:     'Standard',
  orientation:   'Auto',
  delivery_priority: 'Standard',
  stack_preference:  'Auto',
  weight_override:
    parseFloat(row.weight_kg) ||
    parseFloat(row.weight_override) ||
    parseFloat(row['Weight (kg)']) ||
    0,
  edge:          row.edge      || 'None',
  edge_area:     row.edge_area || '',
  edge_polish_machine: 0,
  edge_map:      {},
  edge_polish_manual: '',
  radius:        row.radius    || '-',
  radius_value:  '',
  radius_corners:{},
  shape_type:    '',
  notes:         row.notes     || '',
});

// ── File entry ──────────────────────────────────────────────────────────────
const FileEntry = ({ file, status, progress, rowCount, confidence, onRemove }) => {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 text-sm font-bold shrink-0">PDF</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1e293b] truncate">{file.name}</p>
        <p className="text-xs text-[#94a3b8]">{(file.size / 1024).toFixed(0)} KB</p>
        {status === 'parsing' && (
          <div className="mt-1.5 h-1.5 rounded-full bg-[#e2e8f0] overflow-hidden w-full">
            <div className="h-full bg-[#2563eb] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {status === 'done' && (
          <p className="text-xs text-[#059669] mt-0.5">{rowCount} rows extracted · {Math.round(confidence * 100)}% avg confidence</p>
        )}
        {status === 'error' && <p className="text-xs text-rose-500 mt-0.5">Parse failed — try manually or check PDF format</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {status === 'done'    && <span className="text-[#059669] text-lg">✓</span>}
        {status === 'parsing' && <span className="h-4 w-4 rounded-full border-2 border-[#2563eb] border-t-transparent animate-spin" />}
        {status === 'error'   && <span className="text-rose-500 text-lg">✗</span>}
        {status === 'pending' && (
          <button type="button" onClick={onRemove} className="text-[#94a3b8] hover:text-rose-500 text-sm">✕</button>
        )}
      </div>
    </div>
  );
};

// ── BulkEdit panel ───────────────────────────────────────────────────────────
const BulkEditPanel = ({ selectionCount, onApply }) => {
  const [field, setField]   = useState('category');
  const [value, setValue]   = useState('');

  const BULK_FIELDS = [
    { id: 'category',  label: 'Category',  type: 'select', options: CATEGORY_OPTIONS },
    { id: 'building',  label: 'Building',  type: 'text' },
    { id: 'floor',     label: 'Floor',     type: 'text' },
    { id: 'flat',      label: 'Flat',      type: 'text' },
    { id: 'thickness', label: 'Thickness', type: 'select', options: THICKNESS_OPTIONS },
    { id: 'edge',      label: 'Edge',      type: 'select', options: EDGE_OPTIONS },
    { id: 'sink_type', label: 'Sink',      type: 'select', options: SINK_OPTIONS },
    { id: 'qty',       label: 'Qty',       type: 'number' },
    { id: 'notes',     label: 'Notes',     type: 'text' },
  ];
  const activeField = BULK_FIELDS.find(f => f.id === field);

  return (
    <div className="border-t border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#475569] shrink-0">
          Bulk Edit{selectionCount ? ` — ${selectionCount} row${selectionCount !== 1 ? 's' : ''} in view` : ' (no rows match)'}
        </span>
        <select value={field} onChange={e => { setField(e.target.value); setValue(''); }}
          className="rounded border border-[#cbd5e1] bg-white px-2 py-1 text-xs text-[#334155]">
          {BULK_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {activeField?.type === 'select' ? (
          <select value={value} onChange={e => setValue(e.target.value)}
            className="rounded border border-[#cbd5e1] bg-white px-2 py-1 text-xs text-[#334155] min-w-[120px]">
            <option value="">— pick value —</option>
            {activeField.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input value={value} onChange={e => setValue(e.target.value)}
            type={activeField?.type === 'number' ? 'number' : 'text'}
            placeholder={`New ${activeField?.label || ''}...`}
            className="rounded border border-[#cbd5e1] bg-white px-2 py-1 text-xs text-[#334155] w-32" />
        )}
        <button type="button"
          disabled={!value || !selectionCount}
          onClick={() => { if (value && selectionCount) { onApply(field, value); setValue(''); } }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all
            ${value && selectionCount
              ? 'bg-[#1e293b] text-white hover:bg-[#0f172a]'
              : 'bg-[#e2e8f0] text-[#94a3b8] cursor-not-allowed'}`}>
          Apply to Selection
        </button>
      </div>
    </div>
  );
};

// ── Draft list item ──────────────────────────────────────────────────────────
const DraftItem = ({ draft, onResume, onDelete }) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3">
    <div>
      <p className="text-sm font-medium text-[#1e293b]">{draft.name}</p>
      <p className="text-xs text-[#94a3b8]">{draft.row_count} rows · {new Date(draft.updated_at).toLocaleDateString()}</p>
    </div>
    <div className="flex gap-2">
      <button type="button" onClick={() => onResume(draft)}
        className="rounded-full border border-[#2563eb] px-3 py-1 text-xs font-medium text-[#2563eb] hover:bg-blue-50">
        Resume
      </button>
      <button type="button" onClick={() => onDelete(draft.id)}
        className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#94a3b8] hover:text-rose-500">
        Delete
      </button>
    </div>
  </div>
);

// ── Main UploadWorkspace ──────────────────────────────────────────────────────
const UploadWorkspace = ({ project, onDataChange, onSwitchToManual }) => {
  const [step, setStep]               = useState('upload'); // 'upload' | 'review' | 'saved'
  const [files, setFiles]             = useState([]);       // {file, status, progress, rowCount, confidence}
  const [rows, setRows]               = useState([]);
  const [draftId, setDraftId]         = useState(null);
  const [draftName, setDraftName]     = useState('');
  const [drafts, setDrafts]           = useState([]);
  const [showDrafts, setShowDrafts]   = useState(false);
  const [isDraftsLoading, setIsDraftsLoading] = useState(false);
  const [filterText, setFilterText]   = useState('');
  const [isSaving, setIsSaving]       = useState(false);
  const [saveResult, setSaveResult]   = useState(null);
  const [similarDrawing, setSimilarDrawing] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const [reviewData, setReviewData]   = useState(null);
  const [showReview, setShowReview]   = useState(false);
  const [pdfFileMeta, setPdfFileMeta] = useState([]); // [{file: File, pageCount: number}]
  const [aiMode, setAiMode]           = useState(false);
  const [aiProgress, setAiProgress]   = useState(null); // {current, total, label} | null
  const [checkedIds, setCheckedIds]   = useState(() => new Set()); // row checkbox selection, lifted so Edit/Duplicate/Delete/Clear can sit next to Save to Project
  const fileInputRef = useRef(null);
  const dropRef      = useRef(null);
  const gridRef      = useRef(null);
  const aiCancelRef  = useRef(false);

  const editableIds = useMemo(() => UPLOAD_COLUMNS.filter(c => c.type !== 'computed').map(c => c.id), []);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.remove('border-[#2563eb]', 'bg-blue-50');
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (dropped.length) addFiles(dropped);
  }, []);

  const onDragOver = (e) => { e.preventDefault(); dropRef.current?.classList.add('border-[#2563eb]', 'bg-blue-50'); };
  const onDragLeave = () => { dropRef.current?.classList.remove('border-[#2563eb]', 'bg-blue-50'); };

  const addFiles = (newFiles) => {
    setFiles(prev => [...prev, ...newFiles.map(f => ({ file: f, status: 'pending', progress: 0, rowCount: 0, confidence: 0 }))]);
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // ── Full-PDF AI parse pass (used when "Parse with AI" is checked) ──────────
  // Loops the same per-page NIM endpoint used by "Re-parse with AI" in the
  // review modal, across every page of every uploaded file, replacing the
  // traditional parser's rows for each page as results come in. Each page
  // takes ~60-150s, so this can take a long time on multi-page PDFs -- runs
  // with visible progress and can be cancelled; any page that fails keeps its
  // traditional-parser result instead of losing data.
  const runAiParsePass = async (initialRows, fileMetas) => {
    aiCancelRef.current = false;
    const totalPages = fileMetas.reduce((sum, m) => sum + m.pageCount, 0);
    if (!totalPages) return;

    let currentRows = initialRows;
    let done = 0;
    setAiProgress({ current: 0, total: totalPages, label: 'Starting AI parse…' });

    for (const meta of fileMetas) {
      for (let localIdx = 0; localIdx < meta.pageCount; localIdx++) {
        if (aiCancelRef.current) { setAiProgress(null); return; }
        const pageNum = localIdx + 1;
        setAiProgress({
          current: done, total: totalPages,
          label: `Parsing ${meta.file.name} — page ${pageNum} of ${meta.pageCount}…`,
        });
        try {
          const fd = new FormData();
          fd.append('file', meta.file);
          const res = await axios.post(
            `${API_BASE}/projects/${project.id}/upload-pdf/parse-page-nim/?page_index=${localIdx}`,
            fd,
            { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }
          );
          const nimRows = res.data.rows || [];
          if (nimRows.length) {
            currentRows = mergeNimRowsForPage(currentRows, nimRows, pageNum);
            // UploadGrid only syncs its internal row state from the initialRows
            // prop once, on mount -- pushing straight through its own imperative
            // setRows (like the bulk-edit and template-apply flows already do)
            // is what actually keeps the visible grid, Download CSV, Save Draft,
            // and Save to Project in sync with each page as AI results land.
            if (gridRef.current?.setRows) {
              gridRef.current.setRows(currentRows);
            } else {
              setRows(currentRows);
            }
          }
        } catch (err) {
          setParseErrors(prev => [...prev,
            `AI parse failed for ${meta.file.name} page ${pageNum}: ` +
            `${err.response?.data?.detail || err.message} (kept traditional result for this page)`]);
        }
        done += 1;
      }
    }
    setAiProgress(null);
  };

  const cancelAiParse = () => { aiCancelRef.current = true; };

  // ── Parse PDFs ─────────────────────────────────────────────────────────────
  const parsePDFs = async () => {
    if (!files.length || !project.id) return;
    setParseErrors([]);
    const allRows = [];
    const errs = [];
    const fileMetasLocal = []; // built alongside setPdfFileMeta so it's usable immediately

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry.status !== 'pending') continue;

      // Mark as parsing
      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'parsing', progress: 0.2 } : f));

      try {
        const fd = new FormData();
        fd.append('file', entry.file);
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 0.5 } : f));
        const res = await axios.post(`${API_BASE}/projects/${project.id}/upload-pdf/`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setFiles(prev => prev.map((f, idx) => idx === i ? {
          ...f, status: 'done', progress: 1,
          rowCount: res.data.row_count || 0,
          confidence: res.data.overall_confidence || 0,
        } : f));
        allRows.push(...(res.data.rows || []));
        if (res.data.similar_drawing && !similarDrawing) {
          setSimilarDrawing(res.data.similar_drawing);
        }
        if (res.data.review_data?.pages?.length) {
          const pageCount = res.data.review_data.pages.length;
          fileMetasLocal.push({ file: entry.file, pageCount });
          setPdfFileMeta(prev => [...prev, { file: entry.file, pageCount }]);
          setReviewData(prev => {
            if (!prev) return res.data.review_data;
            // Merge pages from multiple PDFs
            return { pages: [...prev.pages, ...res.data.review_data.pages] };
          });
        }
      } catch (err) {
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', progress: 0 } : f));
        errs.push(`${entry.file.name}: ${err.response?.data?.detail || err.message}`);
      }
    }

    let normalizedRows = [];
    if (allRows.length > 0) {
      normalizedRows = allRows.map((r, i) => {
        const wo = r.weight_override ?? r.weight_kg ?? r['Weight (kg)'];
        const weightKg =
          wo !== undefined && wo !== null && wo !== ''
            ? String(wo).trim()
            : '';
        return { ...blankRow(), ...r, weight_kg: weightKg || r.weight_kg || '', _id: i + 1 };
      });
      setRows(normalizedRows);
      setStep('review');
    } else if (errs.length === 0) {
      errs.push('No rows could be extracted. The PDF format may not be supported — please review the file or add rows manually.');
      setStep('review');
    }
    setParseErrors(errs);

    if (aiMode && normalizedRows.length && fileMetasLocal.length) {
      runAiParsePass(normalizedRows, fileMetasLocal); // not awaited -- runs in background, updates rows as it goes
    }
  };

  // ── Download extracted data as CSV (client-side, no backend round-trip) ─────
  const downloadCSV = () => {
    const currentRows = gridRef.current?.getRows() || rows;
    if (!currentRows.length) return;
    const calcCtx = { material: project.material, thickness: project.thickness };
    const escapeCell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cellValue = (c, r) => (c.type === 'computed' ? c.fn(r, calcCtx) : r[c.id]);
    const lines = [
      UPLOAD_COLUMNS.map(c => escapeCell(c.label)).join(','),
      ...currentRows.map(r => UPLOAD_COLUMNS.map(c => escapeCell(cellValue(c, r))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (project.name || 'stonedesk-export').replace(/[^a-z0-9-_]+/gi, '_');
    a.download = `${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Draft operations ───────────────────────────────────────────────────────
  const loadDrafts = async () => {
    if (!project.id) return;
    setIsDraftsLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/projects/${project.id}/drafts/`);
      setDrafts(res.data || []);
    } finally {
      setIsDraftsLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!project.id) return;
    const currentRows = gridRef.current?.getRows() || rows;
    const name = draftName || `Upload Draft ${new Date().toLocaleDateString()}`;
    try {
      if (draftId) {
        await axios.put(`${API_BASE}/drafts/${draftId}`, { name, rows: currentRows });
      } else {
        const res = await axios.post(`${API_BASE}/projects/${project.id}/drafts/`, {
          name, rows: currentRows, file_names: files.map(f => f.file?.name || ''),
        });
        setDraftId(res.data.id);
      }
      alert(`Draft "${name}" saved. You can resume it anytime.`);
    } catch (err) {
      alert('Failed to save draft: ' + (err.response?.data?.detail || err.message));
    }
  };

  const resumeDraft = (draft) => {
    setRows(draft.rows || []);
    setDraftId(draft.id);
    setDraftName(draft.name);
    setShowDrafts(false);
    setStep('review');
  };

  const deleteDraft = async (id) => {
    await axios.delete(`${API_BASE}/drafts/${id}`);
    setDrafts(prev => prev.filter(d => d.id !== id));
  };

  // ── Save to project ────────────────────────────────────────────────────────
  const saveToProject = async () => {
    const currentRows = gridRef.current?.getRows() || rows;
    const valid = currentRows.filter(r => r.part || r.part_no).filter(r => parseFloat(r.length) > 0 && parseFloat(r.width) > 0);
    if (!valid.length) {
      alert('No valid rows to save. Each row needs a Description (or Part #) and dimensions (Length × Width).');
      return;
    }
    setIsSaving(true);
    try {
      const payloads = valid.map(rowToPayload);
      await axios.post(`${API_BASE}/projects/${project.id}/pieces/batch`, payloads);
      setSaveResult({ created: valid.length, skipped: currentRows.length - valid.length });
      setStep('saved');
      onDataChange?.();
      // clean up draft if one exists
      if (draftId) {
        axios.delete(`${API_BASE}/drafts/${draftId}`).catch(() => {});
        setDraftId(null);
      }
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Bulk apply (from BulkEditPanel) ───────────────────────────────────────
  // Applies to whatever the grid is currently filtered to (the search box)
  // so "Apply to Selection" only touches the rows visibly in scope instead of
  // silently rewriting the entire table.
  const bulkTargetText = (filterText || '').toLowerCase();
  const matchesBulkTarget = useCallback((r) => {
    if (!bulkTargetText) return true;
    return editableIds.some(id => String(r[id] || '').toLowerCase().includes(bulkTargetText));
  }, [bulkTargetText, editableIds]);

  const bulkMatchCount = useMemo(() => rows.filter(matchesBulkTarget).length, [rows, matchesBulkTarget]);

  const handleBulkApply = (field, value) => {
    const current = gridRef.current?.getRows() || rows;
    const updated = current.map(r => matchesBulkTarget(r)
      ? { ...r, [field]: value, _confidence: { ...r._confidence, [field]: undefined } }
      : r);
    gridRef.current?.setRows(updated);
    setRows(updated);
  };

  // ── Row checkbox selection (mirrors PiecesTable's search + checkbox + Edit/Delete Selected/Clear Selection) ──
  // Lifted here (rather than owned inside UploadGrid) so the action buttons can
  // sit in the header bar next to Save to Project instead of a second toolbar.
  const toggleChecked = useCallback((id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAllChecked = useCallback((ids, checked) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  }, []);

  const clearChecked = useCallback(() => setCheckedIds(new Set()), []);

  // Drop stale checkbox ids once their rows are gone (deleted / re-parsed away)
  useEffect(() => {
    setCheckedIds(prev => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(rows.map(r => r._id));
      const next = new Set([...prev].filter(id => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const duplicateChecked = () => {
    if (checkedIds.size === 0) return;
    const current = gridRef.current?.getRows() || rows;
    const next = [];
    current.forEach(r => {
      next.push(r);
      if (checkedIds.has(r._id)) next.push({ ...r, _id: Date.now() + Math.random() });
    });
    gridRef.current?.setRows(next);
    setRows(next);
    clearChecked();
  };

  const deleteChecked = () => {
    if (checkedIds.size === 0) return;
    const current = gridRef.current?.getRows() || rows;
    const next = current.filter(r => !checkedIds.has(r._id));
    gridRef.current?.setRows(next);
    setRows(next);
    clearChecked();
  };

  // ── Reset / start over ─────────────────────────────────────────────────────
  const resetAll = () => {
    setStep('upload'); setFiles([]); setRows([]); setDraftId(null);
    setDraftName(''); setParseErrors([]); setSimilarDrawing(null); setFilterText('');
    setSaveResult(null); setReviewData(null); setShowReview(false);
  };

  // ── Step: Upload ───────────────────────────────────────────────────────────
  if (step === 'upload') {
    const hasPending = files.some(f => f.status === 'pending');
    const isParsing  = files.some(f => f.status === 'parsing');

    return (
      <div className="max-w-2xl mx-auto py-4 space-y-5">
        {/* Hero */}
        <div className="text-center pb-2">
          <h2 className="text-xl font-bold text-[#0f172a]">Automated Upload</h2>
          <p className="text-sm text-[#64748b] mt-1">Upload CAD-generated PDFs. We extract parts automatically — you review and correct in a spreadsheet.</p>
        </div>

        {/* Drag & Drop zone */}
        <div
          ref={dropRef}
          onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-8 py-12 text-center transition-all hover:border-[#2563eb] hover:bg-blue-50">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-sm font-semibold text-[#334155]">Drop PDF files here, or click to browse</p>
          <p className="text-xs text-[#94a3b8] mt-1">CAD-generated digital PDFs · Multiple files supported · Max 20 MB each</p>
          <input
            ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <FileEntry key={i} {...f} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        {/* AI parse mode toggle */}
        {files.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={aiMode}
              onChange={e => setAiMode(e.target.checked)}
              disabled={isParsing || !!aiProgress}
              className="mt-0.5 h-4 w-4 rounded border-[#cbd5e1] text-[#7c3aed] focus:ring-[#7c3aed]"
            />
            <span>
              <span className="block text-sm font-medium text-[#334155]">✦ Parse with AI (slower, more accurate)</span>
              <span className="block text-xs text-[#94a3b8] mt-0.5">
                Runs every page through the AI vision model instead of the fast coordinate parser.
                ~60-150s per page — a 19-page PDF can take 20-40+ minutes. Best for drawings where the
                fast parser tends to misread complex multi-piece pages.
              </span>
            </span>
          </label>
        )}

        {/* Error list */}
        {parseErrors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 space-y-0.5">
            {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        {/* Drafts */}
        <div>
          <button type="button"
            onClick={() => { setShowDrafts(s => !s); if (!showDrafts) loadDrafts(); }}
            className="text-xs text-[#2563eb] hover:underline">
            {showDrafts ? '▲ Hide drafts' : '▼ Resume a saved draft'}
          </button>
          {showDrafts && (
            <div className="mt-2 space-y-2">
              {isDraftsLoading && <p className="text-xs text-[#94a3b8]">Loading drafts…</p>}
              {!isDraftsLoading && drafts.length === 0 && <p className="text-xs text-[#94a3b8]">No saved drafts for this project.</p>}
              {drafts.map(d => (
                <DraftItem key={d.id} draft={d} onResume={resumeDraft} onDelete={deleteDraft} />
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-2">
          <button type="button"
            onClick={() => { setRows([]); setStep('review'); }}
            className="text-xs text-[#64748b] hover:text-[#334155] underline">
            Skip upload — enter rows manually
          </button>
          <div className="flex gap-3">
            {files.length > 0 && !isParsing && (
              <button type="button" onClick={() => setFiles([])}
                className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-sm text-[#334155] hover:bg-[#f1f5f9]">
                Clear All
              </button>
            )}
            <button
              type="button"
              disabled={(!hasPending && files.length > 0) || isParsing || !project.id}
              onClick={files.length ? parsePDFs : () => { setRows([]); setStep('review'); }}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white transition-all
                ${isParsing || (!hasPending && files.length > 0 && !parseErrors.length)
                  ? 'bg-[#94a3b8] cursor-not-allowed'
                  : 'bg-[#2563eb] hover:bg-[#1d4ed8]'}`}>
              {isParsing && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              {isParsing ? 'Parsing PDFs…' : files.length ? 'Parse PDFs →' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Review ───────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <>
      <div className="flex flex-col" style={{ height: 'calc(100vh - 420px)', minHeight: 360 }}>
        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#edf2f7]">
          <div className="flex items-center gap-3">
            <button type="button" onClick={resetAll}
              className="text-xs text-[#64748b] hover:text-[#334155]">← Back to Upload</button>
            <h3 className="text-sm font-bold text-[#0f172a]">Review & Edit Extracted Data</h3>
            {rows.length > 0 && <span className="text-xs text-[#94a3b8]">{rows.length} rows</span>}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Review Shapes button */}
            {reviewData?.pages?.length > 0 && (
              <button type="button" onClick={() => setShowReview(true)}
                className="rounded-full border border-[#2563eb] px-3 py-1.5 text-xs font-medium text-[#2563eb] hover:bg-blue-50">
                Review Shapes
              </button>
            )}
            {/* Download CSV button */}
            {rows.length > 0 && (
              <button type="button" onClick={downloadCSV}
                className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]">
                ⬇ Download CSV
              </button>
            )}
            {/* Filter */}
            <input
              value={filterText} onChange={e => setFilterText(e.target.value)}
              placeholder="Search…"
              className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs text-[#334155] w-32 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
            {filterText && (
              <span className="text-xs text-[#94a3b8]">{bulkMatchCount} of {rows.length}</span>
            )}
            {/* Draft name */}
            <input
              value={draftName} onChange={e => setDraftName(e.target.value)}
              placeholder="Draft name (optional)"
              className="rounded border border-[#cbd5e1] bg-white px-2 py-1.5 text-xs text-[#334155] w-36 focus:outline-none"
            />
            <button type="button" onClick={saveDraft}
              className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]">
              💾 Save Draft
            </button>
            {/* Checkbox-selection actions — same Duplicate/Delete Selected/Clear Selection pattern as Manual Entry's saved-pieces table.
                No "Edit" here: double-click any cell to edit inline. Bulk destination/spec edits happen after
                Save to Project, in Manual Entry, which already has the mature matrix + technical-details editor. */}
            {checkedIds.size > 0 && (
              <>
                <span className="text-xs text-[#475569] font-medium">{checkedIds.size} selected</span>
                <button type="button" onClick={duplicateChecked}
                  className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]">
                  Duplicate Selected ({checkedIds.size})
                </button>
                <button type="button" onClick={deleteChecked}
                  className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">
                  Delete Selected ({checkedIds.size})
                </button>
                <button type="button" onClick={clearChecked}
                  className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium text-[#64748b] hover:bg-[#f1f5f9]">
                  Clear Selection
                </button>
              </>
            )}
            <button
              type="button"
              disabled={isSaving || !project.id}
              onClick={saveToProject}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold text-white transition-all
                ${isSaving ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#059669] hover:bg-[#047857]'}`}>
              {isSaving && <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              {isSaving ? 'Saving…' : '✓ Save to Project'}
            </button>
          </div>
        </div>

        {/* AI parse progress -- runs in background while this review screen is open */}
        {aiProgress && (
          <div className="rounded-xl border border-[#7c3aed]/30 bg-[#f5f3ff] px-4 py-3 my-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-[#5b21b6]">
                ✦ {aiProgress.label || `Parsed ${aiProgress.current} of ${aiProgress.total} pages…`}
              </p>
              <button type="button" onClick={cancelAiParse}
                className="text-[10px] text-[#7c3aed] hover:underline shrink-0">
                Cancel AI parse
              </button>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#ede9fe] overflow-hidden">
              <div className="h-full bg-[#7c3aed] transition-all"
                   style={{ width: `${aiProgress.total ? (aiProgress.current / aiProgress.total) * 100 : 0}%` }} />
            </div>
            <p className="text-[10px] text-[#94a3b8] mt-1">
              {aiProgress.current} / {aiProgress.total} pages — rows below update as each page finishes; you can review/edit already-parsed pages now.
            </p>
          </div>
        )}

        {/* Similar drawing suggestion */}
        {similarDrawing && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 my-2 flex items-center justify-between gap-4">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Similar drawing found:</span> "{similarDrawing}" already exists in this project. Use it as a template?
            </p>
            <button type="button"
              onClick={async () => {
                try {
                  const res = await axios.get(`${API_BASE}/projects/${project.id}/drawings/`);
                  const match = res.data.find(d => d.drawing === similarDrawing);
                  if (match?.unique_parts?.length) {
                    const templateRows = match.unique_parts.map((p, i) => ({
                      ...blankRow(), _id: i + 1,
                      part_no: p.part_no || '', part: p.part || '',
                      length: String(p.length || ''), width: String(p.width || ''),
                      edge: p.edge || 'None', edge_area: p.edge_area || '',
                      radius: p.radius || '-', notes: p.notes || '',
                    }));
                    gridRef.current?.setRows(templateRows);
                    setRows(templateRows);
                  }
                } catch { /* ignore */ }
                setSimilarDrawing(null);
              }}
              className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 shrink-0">
              Use as Template
            </button>
            <button type="button" onClick={() => setSimilarDrawing(null)} className="text-amber-400 hover:text-amber-700 text-sm">✕</button>
          </div>
        )}

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 my-1 text-xs text-rose-700">
            {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        {/* Spreadsheet */}
        <div className="flex-1 rounded-xl border border-[#e2e8f0] overflow-hidden flex flex-col mt-2" style={{ minHeight: 0 }}>
          <UploadGrid
            ref={gridRef}
            initialRows={rows}
            onChange={setRows}
            filterText={filterText}
            material={project.material}
            thickness={project.thickness}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onToggleAllChecked={toggleAllChecked}
          />
        </div>

        {/* Bulk edit panel — scoped to the current search / Drawing # filter */}
        <BulkEditPanel selectionCount={bulkMatchCount} onApply={handleBulkApply} />

        {/* Footer hint */}
        <p className="text-[10px] text-[#94a3b8] mt-2 text-center">
          Orange cells = low confidence — please verify · All edits save locally until you click "Save to Project"
        </p>
      </div>

      {/* PDF Review Modal */}
      {showReview && (
        <PdfReviewModal
          rows={gridRef.current?.getRows() || rows}
          reviewData={reviewData}
          pdfFileMeta={pdfFileMeta}
          projectId={project.id}
          onClose={() => setShowReview(false)}
          onSave={(corrected) => {
            gridRef.current?.setRows(corrected);
            setRows(corrected);
          }}
        />
      )}
      </>
    );
  }

  // ── Step: Saved ────────────────────────────────────────────────────────────
  if (step === 'saved' && saveResult) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center space-y-5">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-bold text-[#0f172a]">Saved Successfully</h2>
        <p className="text-sm text-[#64748b]">
          <span className="font-semibold text-[#059669]">{saveResult.created}</span> parts added to the project.
          {saveResult.skipped > 0 && ` (${saveResult.skipped} incomplete rows skipped)`}
        </p>
        <div className="rounded-xl border border-[#a78bfa]/30 bg-violet-50 px-4 py-3 text-left">
          <p className="text-xs font-semibold text-violet-700">Need to fix a drawing's building/floor/flat layout or sink, edge, radius details?</p>
          <p className="text-xs text-violet-600 mt-1">
            Go to Manual Entry, search the Part # or Drawing # below, select it, and click Edit — that loads the
            whole drawing into the same destination-matrix and technical-details editor Manual Entry always uses,
            whether the parts came from a PDF upload or manual entry.
          </p>
        </div>
        <div className="flex justify-center gap-3 pt-2">
          <button type="button" onClick={resetAll}
            className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-medium text-[#334155] hover:bg-[#f1f5f9]">
            Upload More PDFs
          </button>
          <button type="button" onClick={() => onSwitchToManual?.()}
            className="rounded-full bg-[#7c3aed] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6d28d9]">
            Go to Manual Entry →
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default UploadWorkspace;
