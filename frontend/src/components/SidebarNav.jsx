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
const SidebarNav = ({ items, activeKey, onSelect }) => (
  <nav className="w-full md:w-60 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
    {items.map((item) => {
      const isActive = item.key === activeKey;
      return (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          onClick={() => !item.disabled && onSelect(item.key)}
          title={item.disabled ? item.disabledHint : undefined}
          className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-left transition-all shrink-0 md:shrink md:w-full ${
            isActive
              ? 'bg-[#1d4ed8] text-white shadow-sm'
              : item.disabled
              ? 'text-[#94a3b8] cursor-not-allowed'
              : 'text-[#334155] hover:bg-[#f1f5f9]'
          }`}
        >
          {item.step != null && (
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              isActive ? 'bg-white/20 text-white' : 'bg-[#e2e8f0] text-[#64748b]'
            }`}>
              {item.step}
            </span>
          )}
          <span className="flex-1 whitespace-nowrap md:whitespace-normal">
            <span className="block text-sm font-semibold">{item.label}</span>
            {item.hint && (
              <span className={`block text-[11px] mt-0.5 ${isActive ? 'text-blue-100' : 'text-[#94a3b8]'}`}>
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
