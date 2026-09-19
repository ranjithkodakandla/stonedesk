import React, { useEffect, useRef, useState } from 'react';

// Excel-style AutoFilter dropdown: search box + checkbox list + select all/clear.
// `selected` = [] means "all" (nothing excluded). `options` is the full available
// list for this dimension given the *other* active filters (cascading is computed
// by the caller) — pass either plain values or {value, count} pairs to show how
// many parts each option matches given the other active filters.
const NONE_SENTINEL_PREFIX = '__nomatch__';
const isSentinel = (v) => typeof v === 'string' && v.startsWith(NONE_SENTINEL_PREFIX);

export default function MultiSelectDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Normalize options to {value, count}; count is null when the caller didn't supply it.
  const normOptions = options.map((o) => (o && typeof o === 'object' ? o : { value: o, count: null }));

  // The sentinel from "Clear" marks "nothing checked" without colliding with the
  // [] = "all" convention — strip it out of anything shown or compared to real values.
  const realSelected = selected.filter((v) => !isSentinel(v));
  const isAll = selected.length === 0;
  const filteredOptions = search
    ? normOptions.filter((o) => String(o.value).toLowerCase().includes(search.toLowerCase()))
    : normOptions;

  const toggle = (value) => {
    if (realSelected.includes(value)) {
      onChange(realSelected.filter((v) => v !== value));
    } else {
      onChange([...realSelected, value]);
    }
  };

  const summary = isAll
    ? 'All'
    : realSelected.length === 1
      ? realSelected[0]
      : `${realSelected.length} selected`;

  return (
    <div className="relative" ref={rootRef}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#64748b] mb-1">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full min-w-[140px] flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
          isAll
            ? 'border-[#e2e8f0] bg-white text-[#475569]'
            : 'border-blue-300 bg-blue-50 text-blue-700'
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-[#94a3b8]">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg flex flex-col">
          <div className="p-2 border-b border-[#f1f5f9]">
            <input
              autoFocus
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[#e2e8f0] px-2 py-1 text-[12px] focus:outline-none focus:border-blue-300"
            />
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#f1f5f9] text-[11px]">
            <button type="button" className="text-blue-600 font-semibold" onClick={() => onChange([])}>
              Select all
            </button>
            <button
              type="button"
              className="text-[#94a3b8] font-semibold"
              onClick={() => onChange(normOptions.length ? [`${NONE_SENTINEL_PREFIX}${Math.random()}`] : [])}
            >
              Clear
            </button>
          </div>
          <div className="overflow-y-auto p-1">
            {filteredOptions.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-[#94a3b8]">No matches</div>
            )}
            {filteredOptions.map(({ value: opt, count }) => {
              const checked = isAll || realSelected.includes(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#f8fafc] cursor-pointer text-[12px] text-[#334155]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => (isAll ? onChange(normOptions.map((o) => o.value).filter((v) => v !== opt)) : toggle(opt))}
                    className="rounded border-[#cbd5e1]"
                  />
                  <span className="truncate flex-1">{opt}</span>
                  {count != null && <span className="text-[#94a3b8] text-[10px] tabular-nums">{count}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
