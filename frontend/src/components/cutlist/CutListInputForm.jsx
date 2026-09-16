import React, { useState } from 'react';

/**
 * Shared stock-size/kerf inputs, plus (manual mode only) a CSV paste/upload
 * box matching the "Width (in), Length (in), Qty" shape used by the
 * cutlistoptimizer.com export the shop is replacing.
 */
const CutListInputForm = ({ mode, stock, setStock, csvText, setCsvText, considerMaterial, setConsiderMaterial, onGenerate, generating, error }) => {
  const [fileName, setFileName] = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label-text">Stock Length (in)</label>
          <input type="number" step="0.1" min="0" className="input-field"
            value={stock.stock_length}
            onChange={(e) => setStock((s) => ({ ...s, stock_length: e.target.value }))} />
        </div>
        <div>
          <label className="label-text">Stock Width (in)</label>
          <input type="number" step="0.1" min="0" className="input-field"
            value={stock.stock_width}
            onChange={(e) => setStock((s) => ({ ...s, stock_width: e.target.value }))} />
        </div>
        <div>
          <label className="label-text">Kerf / Blade (in)</label>
          <input type="number" step="0.01" min="0" className="input-field"
            value={stock.kerf}
            onChange={(e) => setStock((s) => ({ ...s, kerf: e.target.value }))} />
        </div>
      </div>

      {mode === 'project' && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={considerMaterial}
            onChange={(e) => setConsiderMaterial(e.target.checked)} />
          Keep different materials/thicknesses/colors on separate sheets (recommended)
        </label>
      )}

      {mode === 'manual' && (
        <div className="space-y-2">
          <label className="label-text">Cut List CSV (Width, Length, Qty)</label>
          <div className="flex items-center gap-3">
            <input type="file" accept=".csv,text/csv" onChange={handleFile}
              className="text-sm text-slate-600" />
            {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          </div>
          <textarea
            className="input-field font-mono text-xs h-40"
            placeholder={'Width (in),Length (in),Sum of Qty\n42,84,2\n4,22,5'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
        </div>
      )}

      {error && <div className="text-sm text-rose-600">{error}</div>}

      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className={`rounded-full px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all ${
          generating ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#1d4ed8] hover:bg-[#1e40af]'
        }`}
      >
        {generating ? 'Nesting…' : 'Generate Cut List'}
      </button>
    </div>
  );
};

export default CutListInputForm;
