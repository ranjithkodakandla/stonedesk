import React, { useState } from 'react';

const WEIGHT_PRESETS = [1800, 1900, 2000];

export default function TargetWeightControl({ value, onChange }) {
  const [custom, setCustom] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));

  const isPreset = WEIGHT_PRESETS.includes(value);

  const applyCustom = () => {
    const n = Number(inputVal);
    if (n > 0) onChange(n);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#94a3b8] self-center">Target weight</span>
      <div className="flex items-center gap-1">
        {WEIGHT_PRESETS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => { onChange(w); setCustom(false); }}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
              value === w && !custom
                ? 'bg-[#0f172a] text-white border border-[#0f172a]'
                : 'border border-[#e2e8f0] bg-white text-[#475569] hover:border-[#94a3b8]'
            }`}
          >
            {w.toLocaleString()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setCustom((s) => !s); setInputVal(String(value)); }}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
            !isPreset || custom
              ? 'bg-[#0f172a] text-white border border-[#0f172a]'
              : 'border border-[#e2e8f0] bg-white text-[#475569] hover:border-[#94a3b8]'
          }`}
        >
          Custom
        </button>
      </div>
      {(!isPreset || custom) && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={100}
            max={5000}
            step={50}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            className="w-24 rounded-xl border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] font-medium text-[#0f172a] focus:border-[#0f172a] focus:outline-none"
          />
          <span className="text-[11px] text-[#94a3b8]">kg</span>
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-full border border-[#0f172a] bg-[#0f172a] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#1e293b]"
          >
            Set
          </button>
        </div>
      )}
    </div>
  );
}
