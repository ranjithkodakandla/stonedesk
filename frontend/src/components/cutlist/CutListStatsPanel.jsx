import React from 'react';

const StatRow = ({ label, value }) => (
  <div className="flex items-center justify-between py-1.5 text-sm">
    <span className="text-slate-500">{label}</span>
    <span className="font-medium text-slate-800">{value}</span>
  </div>
);

/** Right-hand sidebar: Global statistics (whole job), Sheet statistics for
 * whichever pattern is currently selected (with </> paging through every
 * pattern), and that pattern's Cuts table — mirrors the reference tool's
 * on-screen layout so the shop sees the same numbers in the same place. */
const CutListStatsPanel = ({ summary, patterns, selectedIndex, onSelect }) => {
  const pattern = patterns[selectedIndex];
  const sheet = pattern?.sheet;
  const usedStockSheets = patterns.length;

  return (
    <div className="w-80 shrink-0 space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="font-semibold text-slate-700 mb-2">Global statistics</div>
        <StatRow label="Used stock sheets" value={usedStockSheets} />
        <StatRow label="Total used area" value={`${summary.total_used_area}  ${summary.total_used_pct}%`} />
        <StatRow label="Total wasted area" value={`${summary.total_wasted_area}  ${Math.round((100 - summary.total_used_pct) * 10) / 10}%`} />
        <StatRow label="Total cuts" value={summary.total_cuts} />
        <StatRow label="Total cut length" value={summary.total_cut_length} />
        <StatRow label="Cut / blade / kerf thickness" value={summary.kerf} />
        {summary.total_unplaced_pieces > 0 && (
          <div className="mt-2 text-xs text-rose-600 font-medium">
            {summary.total_unplaced_pieces} piece(s) didn't fit in the available stock
          </div>
        )}
      </div>

      {pattern && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-700">Sheet statistics</span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <button type="button" disabled={selectedIndex === 0}
                onClick={() => onSelect(selectedIndex - 1)}
                className="disabled:opacity-30">◂</button>
              {selectedIndex + 1} / {patterns.length}
              <button type="button" disabled={selectedIndex === patterns.length - 1}
                onClick={() => onSelect(selectedIndex + 1)}
                className="disabled:opacity-30">▸</button>
            </span>
          </div>
          <StatRow label="Stock sheet" value={`${sheet.stock_length}×${sheet.stock_width}`} />
          <StatRow label="Qty" value={pattern.qty} />
          <StatRow label="Used area" value={`${sheet.used_area}  ${sheet.used_pct}%`} />
          <StatRow label="Wasted area" value={`${sheet.wasted_area}  ${Math.round((100 - sheet.used_pct) * 10) / 10}%`} />
          <StatRow label="Cuts" value={sheet.cuts_table.length} />
          <StatRow label="Panels" value={sheet.placements.length} />
          <StatRow label="Wasted panels" value={sheet.cuts_table.filter((c) => (c.note || '').includes('surplus')).length} />
        </div>
      )}

      {pattern && sheet.cuts_table.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold text-slate-700 mb-2">Cuts</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="text-left font-medium py-1">#</th>
                <th className="text-left font-medium py-1">Panel</th>
                <th className="text-left font-medium py-1">Cut</th>
                <th className="text-left font-medium py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {sheet.cuts_table.map((c) => (
                <tr key={c.n} className="border-b border-slate-50">
                  <td className="py-1">{c.n}</td>
                  <td className="py-1">{c.panel}</td>
                  <td className="py-1">{c.cut}</td>
                  <td className="py-1">{c.result}{c.note && c.note !== '-' ? ` \\ ${c.note}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CutListStatsPanel;
