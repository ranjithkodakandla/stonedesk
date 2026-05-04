import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

const CrateGrid = ({ pieces, crates, assignments, project, onDataChange }) => {
  const [strategy, setStrategy] = useState('type');
  const [maxWeight, setMaxWeight] = useState(1000);

  const autoGenerate = async () => {
    try {
      await axios.post(`${API_BASE}/projects/${project.id}/crates/auto-generate`, { group_by: strategy, max_weight: maxWeight });
      onDataChange();
      alert('Crates generated successfully');
    } catch (e) {
      alert('Error generating crates');
    }
  };

  const deleteCrate = async (crateId) => {
    await axios.delete(`${API_BASE}/crates/${crateId}`);
    onDataChange();
  };

  const getWeight = (p) => {
    const factors = { Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 }, Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 }, Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 } };
    const factor = (factors[project.material] || factors['Granite'])[project.thickness] || 6.5;
    return ((p.length * p.width) / 144) * factor * p.qty;
  };

  const unassigned = pieces.filter(p => !assignments[p.id]);
  const cratesWithItems = crates.map(c => ({ ...c, items: pieces.filter(p => assignments[p.id] === c.id), totalWeight: pieces.filter(p => assignments[p.id] === c.id).reduce((s, p) => s + getWeight(p), 0) }));

  return (
    <div className="mt-6 text-[#475569]">
      <div className="bg-white shadow-sm rounded-lg p-5 border border-[#e2e8f0] flex flex-wrap gap-x-5 gap-y-4 items-end mb-6">
        <div><label className="label-text">Group By</label><select className="input-field w-48" value={strategy} onChange={(e)=>setStrategy(e.target.value)}><option value="type">Type (Vanity/Kitchen)</option><option value="unit">Flat/Building</option></select></div>
        <div><label className="label-text">Max Weight (kg)</label><input type="number" className="input-field w-32" value={maxWeight} onChange={(e)=>setMaxWeight(Number(e.target.value))} /></div>
        <button onClick={autoGenerate} className="btn-primary mb-[2px]">Auto-Generate Crates</button>
      </div>

      {unassigned.length > 0 && (
        <div className="mb-6 bg-white shadow-sm rounded-lg border border-[#e2e8f0] overflow-hidden">
          <div className="p-4 border-b border-[#e2e8f0] text-[#1e293b] font-semibold bg-[#f8fafc]">Unassigned Pieces ({unassigned.length})</div>
          <div className="p-3 max-h-48 overflow-y-auto space-y-2">
            {unassigned.map(p => (
              <div key={p.id} className="flex justify-between items-center bg-white p-3 rounded-md border border-[#e2e8f0]">
                <span><span className="text-[#1e293b] font-medium">{p.part}</span> <span className="text-[#64748b] text-xs ml-2">{p.drawing} {p.building ? `B${p.building} F${p.floor} Fl${p.flat}` : ''}</span></span>
                <span className="text-sm font-medium text-[#475569]">{getWeight(p).toFixed(1)} kg</span>
                <select className="bg-white border border-[#cbd5e1] rounded text-sm p-1.5 outline-none focus:border-[#3b82f6]" onChange={async (e) => {
                   if (e.target.value) { await axios.post(`${API_BASE}/crates/assign`, { piece_id: p.id, crate_id: parseInt(e.target.value) }); onDataChange(); }
                }}>
                  <option value="">Assign to...</option>
                  {crates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cratesWithItems.map(c => {
          const percent = (c.totalWeight / c.max_weight) * 100;
          return (
            <div key={c.id} className="bg-white shadow-sm border border-[#e2e8f0] border-t-4 border-t-[#334155] rounded-lg flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[#f1f5f9] flex justify-between items-start bg-[#f8fafc]">
                <div><div className="font-bold text-[#1e293b]">{c.name}</div><div className="text-xs text-[#2563eb] font-medium mt-1">{c.crate_id}</div></div>
                <button onClick={() => deleteCrate(c.id)} className="text-xs text-[#dc2626] hover:text-[#991b1b] bg-[#fef2f2] hover:bg-[#fee2e2] border border-[#fecaca] px-3 py-1 rounded-md transition-colors">Delete</button>
              </div>
              <div className="p-4 bg-white">
                <div className="h-2.5 w-full bg-[#f1f5f9] rounded-full overflow-hidden"><div className="h-full bg-[#3b82f6] rounded-full" style={{ width: `${Math.min(percent, 100)}%` }}></div></div>
                <div className="flex justify-between text-xs font-medium text-[#64748b] mt-2"><span>{c.totalWeight.toFixed(1)} / {c.max_weight} kg</span><span>{c.items.length} items</span></div>
              </div>
              <div className="p-4 flex-1 overflow-y-auto max-h-48 space-y-2 border-t border-[#f1f5f9]">
                {c.items.map(p => <div key={p.id} className="text-sm flex justify-between border-b border-[#f8fafc] pb-2"><span>{p.part} <span className="text-[#94a3b8] text-xs ml-1">{p.building ? `B${p.building}` : ''}</span></span><span className="text-[#475569] font-medium">{getWeight(p).toFixed(1)} kg</span></div>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CrateGrid;
