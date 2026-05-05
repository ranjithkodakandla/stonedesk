import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const CrateGrid = ({ pieces, crates, assignments, project, onDataChange }) => {
  const [strategy, setStrategy] = useState('smart');
  const [maxWeight, setMaxWeight] = useState(1000);
  const [insights, setInsights] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
      }
    };
  }, []);

  const autoGenerate = async () => {
    if (isGenerating) return;
    try {
      setIsGenerating(true);
      setShowSpinner(false);
      spinnerTimerRef.current = setTimeout(() => {
        setShowSpinner(true);
      }, 3000);
      await axios.post(`${API_BASE}/projects/${project.id}/crates/auto-generate`, { group_by: strategy, max_weight: maxWeight });
      onDataChange();
      alert('Crates generated successfully');
    } catch (e) {
      alert('Error generating crates');
    } finally {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      setShowSpinner(false);
      setIsGenerating(false);
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

  const { pieceWeights, unassigned, cratesWithItems } = useMemo(() => {
    const derivedPieceWeights = {};
    const derivedPiecesByCrate = {};
    const derivedUnassigned = [];

    crates.forEach((crate) => {
      derivedPiecesByCrate[crate.id] = [];
    });

    pieces.forEach((piece) => {
      const weight = getWeight(piece);
      derivedPieceWeights[piece.id] = weight;
      const crateId = assignments[piece.id];
      if (crateId && derivedPiecesByCrate[crateId]) {
        derivedPiecesByCrate[crateId].push(piece);
      } else {
        derivedUnassigned.push(piece);
      }
    });

    const derivedCratesWithItems = crates.map((crate) => {
      const items = derivedPiecesByCrate[crate.id] || [];
      const totalWeight = items.reduce((sum, piece) => sum + (derivedPieceWeights[piece.id] || 0), 0);
      return { ...crate, items, totalWeight };
    });

    return {
      pieceWeights: derivedPieceWeights,
      piecesByCrate: derivedPiecesByCrate,
      unassigned: derivedUnassigned,
      cratesWithItems: derivedCratesWithItems,
    };
  }, [assignments, crates, pieces, project.material, project.thickness]);
  const hasCrates = cratesWithItems.length > 0;
  const getFillState = (percent) => {
    if (percent < 80) return { label: 'Underload', bar: 'bg-gradient-to-r from-[#ef4444] to-[#fb7185]', card: 'bg-gradient-to-br from-[#fff1f2] to-[#ffffff] border-[#fecdd3]', text: 'text-[#b91c1c]', badge: 'bg-[#fee2e2] text-[#b91c1c]' };
    if (percent <= 95) return { label: 'Balanced', bar: 'bg-gradient-to-r from-[#22c55e] to-[#4ade80]', card: 'bg-gradient-to-br from-[#f0fdf4] to-[#ffffff] border-[#bbf7d0]', text: 'text-[#166534]', badge: 'bg-[#dcfce7] text-[#166534]' };
    return { label: 'Overload', bar: 'bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]', card: 'bg-gradient-to-br from-[#fffbeb] to-[#ffffff] border-[#fde68a]', text: 'text-[#b45309]', badge: 'bg-[#fef3c7] text-[#b45309]' };
  };

  const fetchInsights = async () => {
    try {
      const res = await axios.get(`${API_BASE}/projects/${project.id}/crates/insights`);
      setInsights(res.data);
    } catch (error) {
      console.error('Failed to load crate insights', error);
    }
  };

  React.useEffect(() => {
    if (hasCrates) {
      fetchInsights();
    } else {
      setInsights(null);
    }
  }, [pieces, crates, assignments, project.id, hasCrates]);

  return (
    <div className="mt-6 text-[#475569]">
      <div className="bg-white shadow-sm rounded-lg p-5 border border-[#e2e8f0] flex flex-wrap gap-x-5 gap-y-4 items-end mb-6">
        <div>
          <label className="label-text">Packing Mode</label>
          <select className="input-field w-56" value={strategy} onChange={(e)=>setStrategy(e.target.value)}>
            <option value="smart">Smart Mixed Pack</option>
            <option value="apartment">By Apartment / Destination</option>
            <option value="family">By Product Family</option>
          </select>
        </div>
        <div><label className="label-text">Max Weight (kg)</label><input type="number" className="input-field w-32" value={maxWeight} onChange={(e)=>setMaxWeight(Number(e.target.value))} /></div>
        <div className="relative">
          <button onClick={autoGenerate} disabled={isGenerating} className={`btn-primary mb-[2px] inline-flex items-center gap-2 ${isGenerating ? 'opacity-70 cursor-not-allowed' : ''}`}>
            {showSpinner && (
              <span className="inline-flex h-4 w-4 items-center justify-center">
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              </span>
            )}
            <span>{showSpinner ? 'Generating...' : 'Auto-Generate Crates'}</span>
          </button>
          {showSpinner && (
            <div className="absolute left-0 top-full mt-2 rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs text-[#475569] shadow-sm">
              Building crate plan...
            </div>
          )}
        </div>
      </div>

      {insights && hasCrates && (
        <div className="mb-6 bg-white shadow-sm rounded-lg border border-[#e2e8f0] p-5 max-h-[34rem] overflow-y-auto">
          <div className="flex flex-wrap justify-between gap-4 items-start sticky top-0 bg-white pb-4">
            <div>
              <div className="text-sm text-[#64748b]">Packing Insights</div>
              <div className="text-lg font-bold text-[#1e293b]">{insights.crate_count} crates, {insights.average_utilization.toFixed(1)}% average fill</div>
              <div className="text-sm mt-1 text-[#475569]">
                Booking action: <span className="font-semibold text-[#1e293b]">{insights.container_plan?.booking_action || 'Book 1 x 40ft'}</span>
              </div>
              <div className="text-sm mt-1 text-[#475569]">{insights.container_plan?.reason}</div>
              {insights.container_plan?.next_step && (
                <div className="text-sm mt-1 text-[#475569]">{insights.container_plan.next_step}</div>
              )}
            </div>
            <div className="text-sm text-[#475569]">
              <div>Project weight: <span className="font-semibold text-[#1e293b]">{insights.total_weight.toFixed(1)} kg</span></div>
              <div>Target fill: <span className="font-semibold text-[#1e293b]">{insights.recommended_utilization_target}%</span></div>
              <div>Families: <span className="font-semibold text-[#1e293b]">{insights.distinct_families}</span></div>
              <div>Destinations: <span className="font-semibold text-[#1e293b]">{insights.distinct_destinations}</span></div>
            </div>
          </div>
          {insights.container_plan?.alternatives?.length > 0 && (
            <div className="mt-4 text-sm text-[#475569]">
              <div className="font-semibold text-[#1e293b] mb-1">Container reference</div>
              <ul className="space-y-1">
                {insights.container_plan.alternatives.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          )}
          {insights.underfilled_crates?.length > 0 && (
            <div className="mt-4 grid gap-3">
              {insights.underfilled_crates.map((crate) => (
                <div key={crate.crate_id} className={`rounded-md border p-4 shadow-sm ${getFillState(crate.utilization).card}`}>
                  <div className="flex flex-wrap justify-between gap-3 items-center">
                    <div className="font-semibold text-[#1e293b]">{crate.name} <span className="text-xs text-[#64748b] ml-2">{crate.utilization}% full</span></div>
                    <div className="text-sm text-[#475569]">Spare capacity: {crate.spare_capacity.toFixed(0)} kg</div>
                  </div>
                  <p className="text-sm text-[#475569] mt-2">{crate.suggestion}</p>
                  {crate.merge_candidates?.length > 0 && (
                    <p className="text-xs text-[#2563eb] mt-2">Merge candidates: {crate.merge_candidates.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {insights.underfilled_crates?.length === 0 && (
            <div className="mt-4 text-sm text-[#059669]">All crates are at or above the target fill level.</div>
          )}
          {insights.container_plan?.recommended === 'consolidate' && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Hold the booking until the crate mix is tighter. For stone export, that usually means merging same-family items until fill gets closer to 85-95% and the crate count drops enough to make the container decision obvious.
            </div>
          )}
        </div>
      )}
      {!hasCrates && (
        <div className="mb-6 bg-white shadow-sm rounded-lg border border-dashed border-[#cbd5e1] p-5 text-sm text-[#64748b]">
          Generate crates to see packing insights, fill colors, and container guidance.
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mb-6 bg-white shadow-sm rounded-lg border border-[#e2e8f0] overflow-hidden">
          <div className="p-4 border-b border-[#e2e8f0] text-[#1e293b] font-semibold bg-[#f8fafc]">Unassigned Pieces ({unassigned.length})</div>
          <div className="p-3 max-h-48 overflow-y-auto space-y-2">
            {unassigned.map(p => (
              <div key={p.id} className="flex justify-between items-center bg-white p-3 rounded-md border border-[#e2e8f0]">
                <span><span className="text-[#1e293b] font-medium">{p.part}</span> <span className="text-[#64748b] text-xs ml-2">{p.drawing} {p.building ? `B${p.building} F${p.floor} Fl${p.flat}` : ''}</span></span>
                <span className="text-sm font-medium text-[#475569]">{(pieceWeights[p.id] || 0).toFixed(1)} kg</span>
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
          const fillState = getFillState(percent);
          return (
            <div key={c.id} className={`shadow-sm border rounded-lg flex flex-col overflow-hidden ${fillState.card}`}>
              <div className="p-4 border-b border-[#f1f5f9] flex justify-between items-start bg-[#f8fafc]">
                <div>
                  <div className="font-bold text-[#1e293b]">{c.name}</div>
                  <div className="text-xs text-[#2563eb] font-medium mt-1">{c.crate_id}</div>
                  <div className={`text-[10px] uppercase tracking-wide mt-1 inline-flex px-2 py-1 rounded-full ${fillState.badge}`}>{fillState.label}</div>
                </div>
                <button onClick={() => deleteCrate(c.id)} className="text-xs text-[#dc2626] hover:text-[#991b1b] bg-[#fef2f2] hover:bg-[#fee2e2] border border-[#fecaca] px-3 py-1 rounded-md transition-colors">Delete</button>
              </div>
              <div className="p-4 bg-white">
                <div className="h-2.5 w-full bg-[#f1f5f9] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${fillState.bar}`} style={{ width: `${Math.min(percent, 100)}%` }}></div>
                </div>
                <div className="flex justify-between text-xs font-medium text-[#64748b] mt-2"><span>{c.totalWeight.toFixed(1)} / {c.max_weight} kg</span><span>{c.items.length} items</span></div>
                <div className={`text-xs mt-2 ${fillState.text}`}>
                  {percent < 80
                    ? `Underload by ${(80 - percent).toFixed(0)} points. If the next crate is the same family, merge it first before booking the container.`
                    : percent <= 95
                      ? 'Perfect planning band for this MVP.'
                      : `Overload by ${(percent - 95).toFixed(0)} points. Move pieces out before fixing the plan.`}
                </div>
              </div>
              <div className="p-4 flex-1 overflow-y-auto max-h-48 space-y-2 border-t border-[#f1f5f9]">
                {c.items.map(p => <div key={p.id} className="text-sm flex justify-between border-b border-[#f8fafc] pb-2"><span>{p.part} <span className="text-[#94a3b8] text-xs ml-1">{p.building ? `B${p.building}` : ''}</span></span><span className="text-[#475569] font-medium">{(pieceWeights[p.id] || 0).toFixed(1)} kg</span></div>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CrateGrid;
