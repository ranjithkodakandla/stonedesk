import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../../utils/plannerUtils';
import CutListInputForm from './CutListInputForm';
import CutListSheetView from './CutListSheetView';

/** Parses "Width (in), Length (in), Qty[, ...]" CSV text into piece rows.
 * Tolerant of a header row, extra trailing columns (e.g. sft), and a
 * trailing "Grand Total" row — matches the shape exported by the tool
 * this feature replaces. */
function parseCutListCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',').map((c) => c.trim());
    const width = parseFloat(cols[0]);
    const length = parseFloat(cols[1]);
    const qty = parseInt(cols[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(length) || !Number.isFinite(qty)) continue; // header/footer row
    rows.push({ width, length, qty, material: 'Stone', thickness: '', stone_color: '' });
  }
  return rows;
}

const DEFAULT_STOCK = { stock_length: 126, stock_width: 63, kerf: 0.125 };

/** mode: 'project' (pulls pieces from the given projectId) | 'manual' (CSV paste/upload). */
const CutListScreen = ({ projectId, mode = 'project' }) => {
  const [stock, setStock] = useState(DEFAULT_STOCK);
  const [csvText, setCsvText] = useState('');
  const [considerMaterial, setConsiderMaterial] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState(null);
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    setError('');
    const stockLength = parseFloat(stock.stock_length);
    const stockWidth = parseFloat(stock.stock_width);
    const kerf = parseFloat(stock.kerf);
    if (!stockLength || !stockWidth) {
      setError('Enter a valid stock length and width.');
      return;
    }

    const body = {
      source: mode,
      stock_length: stockLength,
      stock_width: stockWidth,
      kerf: Number.isFinite(kerf) ? kerf : 0.125,
      allow_rotate: true,
      consider_material: considerMaterial,
    };
    if (mode === 'project') {
      body.project_id = projectId;
    } else {
      const pieces = parseCutListCsv(csvText);
      if (!pieces.length) {
        setError('Paste or upload a CSV with Width, Length, Qty columns first.');
        return;
      }
      body.pieces = pieces;
    }

    setGenerating(true);
    try {
      const res = await axios.post(`${API_BASE}/cutlist/generate`, body);
      setRunId(res.data.run_id);
      setResult(res.data.result);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to generate cut list.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!runId) return;
    window.open(`${API_BASE}/cutlist/${runId}/pdf`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Cut List Optimizer</h2>
        <p className="text-sm text-slate-500 mb-4">
          {mode === 'project'
            ? 'Nests this project’s parts onto stock slabs to minimize waste.'
            : 'Paste or upload a cut list CSV to nest parts onto stock slabs, without a project.'}
        </p>
        <CutListInputForm
          mode={mode}
          stock={stock}
          setStock={setStock}
          csvText={csvText}
          setCsvText={setCsvText}
          considerMaterial={considerMaterial}
          setConsiderMaterial={setConsiderMaterial}
          onGenerate={handleGenerate}
          generating={generating}
          error={error}
        />
      </div>

      {result && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-6 text-sm">
              <div><span className="text-slate-500">Sheets used:</span> <span className="font-semibold">{result.summary.total_sheets}</span></div>
              <div><span className="text-slate-500">Material used:</span> <span className="font-semibold">{result.summary.total_used_pct}%</span></div>
              <div><span className="text-slate-500">Total cuts:</span> <span className="font-semibold">{result.summary.total_cuts}</span></div>
            </div>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="rounded-full border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] transition-all"
            >
              ↓ Download PDF
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {result.groups.flatMap((group, gi) =>
              group.sheets.map((sheet, si) => (
                <CutListSheetView
                  key={`${gi}-${si}`}
                  sheet={sheet}
                  sheetNo={si + 1}
                  groupLabel={[group.material, group.thickness, group.stone_color].filter(Boolean).join(' ') || 'Stone'}
                />
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CutListScreen;
