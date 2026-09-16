import React from 'react';

/**
 * Vertical navigation list shared by Dashboard and ProjectWorkspace — scales
 * to any number of items without crowding or wrapping the way a horizontal
 * pill row does, and reads clearly for non-technical users since only one
 * label is visible at a time per row (no truncation, no tab-scrolling).
 *
 * items: [{key, label, hint?, disabled?, disabledHint?, step?}]
 * `step` renders a numbered badge — use it for a sequential workflow (e.g.
 * a project's steps) so order is visually obvious; omit it for a flat menu
 * (e.g. dashboard modules) where there's no implied sequence.
 */
const ICONS = {
  projects: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5h5l1.5 2H21v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5Z" />
    </svg>
  ),
  cutlist: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5 shrink-0">
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" strokeLinejoin="round" />
      <path strokeLinecap="round" d="M3.5 9h17M9 20.5V9" />
    </svg>
  ),
  config: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5 shrink-0">
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

const SidebarNav = ({ items, activeKey, onSelect }) => (
  <nav className="w-full md:w-64 shrink-0 flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible">
    {items.map((item) => {
      const isActive = item.key === activeKey;
      return (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          onClick={() => !item.disabled && onSelect(item.key)}
          title={item.disabled ? item.disabledHint : undefined}
          className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all shrink-0 md:shrink md:w-full border ${
            isActive
              ? 'bg-[#111827] text-white border-[#111827] shadow-md'
              : item.disabled
              ? 'text-[#94a3b8] border-transparent cursor-not-allowed'
              : 'text-[#334155] border-transparent hover:bg-white hover:border-[#e2e8f0] hover:shadow-sm'
          }`}
        >
          {item.step != null ? (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              isActive ? 'bg-[#facc15] text-[#111827]' : 'bg-[#e2e8f0] text-[#64748b]'
            }`}>
              {item.step}
            </span>
          ) : (
            ICONS[item.key] && (
              <span className={isActive ? 'text-[#facc15]' : 'text-[#94a3b8] group-hover:text-[#1e293b]'}>
                {ICONS[item.key]}
              </span>
            )
          )}
          <span className="flex-1 whitespace-nowrap md:whitespace-normal">
            <span className="block text-sm font-semibold">{item.label}</span>
            {item.hint && (
              <span className={`block text-[11px] mt-0.5 ${isActive ? 'text-slate-300' : 'text-[#94a3b8]'}`}>
                {item.hint}
              </span>
            )}
          </span>
        </button>
      );
    })}
  </nav>
);

export default SidebarNav;
