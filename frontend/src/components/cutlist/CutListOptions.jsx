import React, { useState } from 'react';

const Toggle = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
      checked ? 'bg-blue-600' : 'bg-slate-300'
    }`}
  >
    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
      checked ? 'translate-x-5' : 'translate-x-1'
    }`} />
  </button>
);

/**
 * Options panel matching the reference tool's toggle set. Only Kerf,
 * Consider material, and Consider grain direction currently change the
 * packing result (grain → disables rotation); Labels on panels only
 * affects the PDF; Use only one sheet from stock caps the matching Stock
 * sheets row's Qty; Edge banding is captured but has no packing effect yet.
 */
const CutListOptions = ({ options, setOptions, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const set = (k, v) => setOptions((prev) => ({ ...prev, [k]: v }));

  const toggles = [
    { key: 'labelsOnPanels', label: 'Labels on panels' },
    { key: 'useOnlyOneSheetFromStock', label: 'Use only one sheet from stock' },
    { key: 'considerMaterial', label: 'Consider material' },
    { key: 'edgeBanding', label: 'Edge banding' },
    { key: 'considerGrainDirection', label: 'Consider grain direction' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors">
        <span className="flex items-center gap-2 font-semibold text-slate-700">⚙ Options</span>
        <span className="text-slate-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-4 bg-white">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-600">Cut / blade / kerf thickness</label>
            <input type="number" step="0.001" min="0" value={options.kerf}
              onChange={(e) => set('kerf', e.target.value)}
              className="input-field w-28 text-right" />
          </div>
          {toggles.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <label className="text-sm text-slate-600">{label}</label>
              <Toggle checked={!!options[key]} onChange={(v) => set(key, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CutListOptions;
