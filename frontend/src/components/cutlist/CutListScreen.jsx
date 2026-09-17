import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../../utils/plannerUtils';
import CutListGrid, { newGridRow } from './CutListGrid';
import CutListOptions from './CutListOptions';
import CutListPatternDiagram from './CutListPatternDiagram';
import CutListStatsPanel from './CutListStatsPanel';
import { buildPatternList } from './cutlistPatterns';

const DEFAULT_OPTIONS = {
  kerf: 0.125,
  labelsOnPanels: true,
  useOnlyOneSheetFromStock: false,
  considerMaterial: true,
  edgeBanding: false,
  considerGrainDirection: false,
};

const defaultStockRow = () => ({ ...newGridRow(), length: 126, width: 63, qty: 0 });

const toGridRows = (arr) => (Array.isArray(arr) && arr.length ? arr.map((r) => ({ ...newGridRow(), ...r })) : []);
const toApiRows = (rows) => rows
  .filter((r) => Number(r.length) > 0 && Number(r.width) > 0)
  .map((r) => ({
    length: Number(r.length), width: Number(r.width), qty: Math.max(1, parseInt(r.qty, 10) || 1),
    material: r.material || '', label: r.label || '',
  }));

/** mode: 'project' (auto-imports the given project's parts into the grid, draft keyed by projectId) |
 * 'manual' (blank grid, CSV import, draft keyed by cutlistId — one of the saved standalone Cut Lists). */
const CutListScreen = ({ projectId, cutlistId, mode = 'project' }) => {
  const draftParams = mode === 'project' ? { project_id: projectId } : { cutlist_id: cutlistId };
  const draftKey = mode === 'project' ? projectId : cutlistId;

  const [panels, setPanels] = useState([]);
  const [stockSheets, setStockSheets] = useState([defaultStockRow()]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState(null);
  const [result, setResult] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const saveTimer = useRef(null);

  // Load the saved draft (or, for a fresh project workspace, auto-import
  // that project's parts once) on mount / when switching projects.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/cutlist/draft`, { params: draftParams });
        if (cancelled) return;
        if (data?.panels?.length || data?.stock_sheets?.length) {
          setPanels(toGridRows(data.panels));
          setStockSheets(data.stock_sheets?.length ? toGridRows(data.stock_sheets) : [defaultStockRow()]);
          setOptions({ ...DEFAULT_OPTIONS, ...(data.options || {}) });
        } else if (mode === 'project' && projectId) {
          const res = await axios.get(`${API_BASE}/projects/${projectId}/pieces/`);
          if (cancelled) return;
          const imported = (res.data || []).map((p) => ({
            ...newGridRow(),
            length: p.length ?? '', width: p.width ?? '', qty: p.qty ?? 1,
            material: p.material || '', label: p.part_no || p.part || '',
          }));
          setPanels(imported);
          setStockSheets([defaultStockRow()]);
        } else {
          setPanels([newGridRow()]);
        }
      } catch {
        setPanels((prev) => (prev.length ? prev : [newGridRow()]));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, mode, projectId]);

  // Debounced autosave — any manual edit to the grids or options persists,
  // so it's there next time this project/cut list is opened and can be
  // downloaded later, same as the rest of the project's data.
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      axios.put(`${API_BASE}/cutlist/draft`, {
        ...draftParams,
        panels: panels.map(({ id, ...r }) => r),
        stock_sheets: stockSheets.map(({ id, ...r }) => r),
        options,
      }).then(() => setSavedAt(new Date())).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, stockSheets, options, loaded, draftKey]);

  const handleGenerate = useCallback(async () => {
    setError('');
    const stockRows = toApiRows(stockSheets);
    if (!stockRows.length) {
      setError('Add at least one stock sheet with a length and width.');
      return;
    }
    const pieceRows = toApiRows(panels);
    if (!pieceRows.length) {
      setError('Add at least one panel with a length and width.');
      return;
    }

    setGenerating(true);
    try {
      const res = await axios.post(`${API_BASE}/cutlist/generate`, {
        source: 'manual',
        ...draftParams,
        stock_sheets: stockRows,
        kerf: Number(options.kerf) || 0.125,
        allow_rotate: true,
        consider_material: !!options.considerMaterial,
        labels_on_panels: !!options.labelsOnPanels,
        use_only_one_sheet_from_stock: !!options.useOnlyOneSheetFromStock,
        edge_banding: !!options.edgeBanding,
        consider_grain_direction: !!options.considerGrainDirection,
        pieces: pieceRows,
      });
      setRunId(res.data.run_id);
      setResult(res.data.result);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to generate cut list.');
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, stockSheets, options, mode, projectId, cutlistId]);

  // Once the shop has generated a cut list at least once, treat it as a live
  // view of the current panels/stock/options — any further edit (including a
  // CSV import) re-runs the nest after a short debounce, so the displayed
  // slab count/diagrams never silently go stale relative to what's typed in
  // the grids above. Before the first click, do nothing (nobody's asked for
  // a result yet, so there's nothing to keep in sync).
  const hasResult = !!result;
  useEffect(() => {
    if (!loaded || !hasResult) return;
    const t = setTimeout(() => { handleGenerate(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, stockSheets, options, loaded, hasResult]);

  const handleDownloadPdf = () => {
    if (!runId) return;
    window.open(`${API_BASE}/cutlist/${runId}/pdf`, '_blank');
  };

  const patterns = useMemo(() => (result ? buildPatternList(result) : []), [result]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const patternRefs = useRef([]);
  const resultsRef = useRef(null);
  useEffect(() => {
    setSelectedIndex(0);
    patternRefs.current = [];
    // Jump straight to the results the moment they're ready — with a large
    // panel list above it, the results card can render far below the fold
    // and look like nothing happened otherwise.
    if (result) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const selectPattern = (idx) => {
    setSelectedIndex(idx);
    patternRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Cut List Optimizer</h2>
            <p className="text-sm text-slate-500">
              {mode === 'project'
                ? 'Nests this project’s parts onto stock slabs to minimize waste. Imported from the project — edit freely below.'
                : 'Add panels and stock sheets below to nest parts onto slabs, without a project.'}
            </p>
          </div>
          {savedAt && <span className="text-xs text-slate-400">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>

        <CutListGrid title="Panels" icon="▤" rows={panels} setRows={setPanels} allowCsvImport />
        <CutListGrid title="Stock sheets" icon="◆" rows={stockSheets} setRows={setStockSheets} />
        <CutListOptions options={options} setOptions={setOptions} />

        {error && <div className="text-sm text-rose-600">{error}</div>}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={`rounded-full px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all ${
            generating ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#1d4ed8] hover:bg-[#1e40af]'
          }`}
        >
          {generating ? 'Nesting…' : 'Generate Cut List'}
        </button>
      </div>

      {result && patterns.length > 0 && (
        <div ref={resultsRef} className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-slate-500">
              {result.summary.total_sheets} physical sheet{result.summary.total_sheets !== 1 ? 's' : ''} · {patterns.length} pattern{patterns.length !== 1 ? 's' : ''}
            </div>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] transition-all"
            >
              ↓ Download PDF
            </button>
          </div>

          <div className="flex gap-6 items-start">
            {/* Main canvas — every pattern stacked vertically, scrollable,
                same as the reference tool's single continuous sheet view. */}
            <div className="flex-1 min-w-0 max-h-[720px] overflow-y-auto space-y-10 pr-2">
              {patterns.map((pattern, i) => (
                <div
                  key={i}
                  ref={(el) => { patternRefs.current[i] = el; }}
                  onClick={() => setSelectedIndex(i)}
                  className={`cursor-pointer rounded-lg p-2 transition-colors ${
                    i === selectedIndex ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-medium text-slate-500 mb-1">
                    {[pattern.group.material, pattern.group.thickness, pattern.group.stone_color].filter(Boolean).join(' ') || 'Stone'} — Pattern {i + 1}
                  </div>
                  <CutListPatternDiagram pattern={pattern} />
                </div>
              ))}
            </div>

            {/* Sticky stats sidebar. */}
            <CutListStatsPanel
              summary={result.summary}
              patterns={patterns}
              selectedIndex={selectedIndex}
              onSelect={selectPattern}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CutListScreen;
