import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from '../utils/plannerUtils';

const SortToggle = ({ value, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(value === 'asc' ? 'desc' : 'asc')}
    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
      value === 'asc'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-violet-200 bg-violet-50 text-violet-700'
    }`}
    title={value === 'asc' ? 'Ascending — click to reverse' : 'Descending — click to reverse'}
  >
    {value === 'asc' ? '1 → 9 ↑' : '9 → 1 ↓'}
  </button>
);

const ToggleChip = ({ label, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${
      selected
        ? 'border-blue-400 bg-blue-600 text-white shadow-sm'
        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'
    }`}
  >
    {label}
  </button>
);

const DispatchSelectionPanel = ({ projectId, onGenerate, isGenerating }) => {
  const [hierarchy, setHierarchy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [basis, setBasis] = useState('building');

  // Selection state
  const [selectedBuildings, setSelectedBuildings] = useState(['all']);
  const [selectedFloors, setSelectedFloors] = useState(['all']);
  const [selectedFlats, setSelectedFlats] = useState(['all']);

  // Sort order
  const [buildingOrder, setBuildingOrder] = useState('asc');
  const [floorOrder, setFloorOrder] = useState('asc');
  const [flatOrder, setFlatOrder] = useState('asc');

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    axios
      .get(`${API_BASE}/projects/${projectId}/dispatch-hierarchy`)
      .then((res) => setHierarchy(res.data))
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [projectId]);

  // Compute available floors given selected buildings
  const availableFloors = useMemo(() => {
    if (!hierarchy) return [];
    if (selectedBuildings.includes('all')) {
      const all = new Set();
      Object.values(hierarchy.floors_by_building || {}).forEach((fls) => fls.forEach((f) => all.add(f)));
      return [...all].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      });
    }
    const all = new Set();
    selectedBuildings.forEach((b) => (hierarchy.floors_by_building?.[b] || []).forEach((f) => all.add(f)));
    return [...all].sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
  }, [hierarchy, selectedBuildings]);

  // Compute available flats given selected buildings + floors
  const availableFlats = useMemo(() => {
    if (!hierarchy) return [];
    const all = new Set();
    const effBuildings = selectedBuildings.includes('all') ? Object.keys(hierarchy.floors_by_building || {}) : selectedBuildings;
    const effFloors = selectedFloors.includes('all') ? availableFloors : selectedFloors;

    effBuildings.forEach((b) => {
      effFloors.forEach((f) => {
        const key = [b, f].filter(Boolean).join(' / ');
        (hierarchy.flats_by_floor?.[key] || []).forEach((fl) => all.add(fl));
      });
    });
    return [...all].sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
  }, [hierarchy, selectedBuildings, selectedFloors, availableFloors]);

  const toggleAll = (set, setFn, pool) => {
    if (set.includes('all')) {
      setFn([...pool]);
    } else {
      setFn(['all']);
    }
  };

  const toggleOne = (value, set, setFn) => {
    if (set.includes('all')) {
      setFn([value]);
    } else if (set.includes(value)) {
      const next = set.filter((v) => v !== value);
      setFn(next.length ? next : ['all']);
    } else {
      setFn([...set, value]);
    }
  };

  const buildSelectionPayload = () => ({
    basis,
    buildings: selectedBuildings,
    floors: selectedFloors,
    flats: selectedFlats,
    ordering: {
      building: buildingOrder,
      floor: floorOrder,
      flat: flatOrder,
    },
  });

  const handleGenerate = () => {
    onGenerate(buildSelectionPayload());
  };

  if (loading) {
    return (
      <div className="rounded-[28px] border border-[#dbe4f0] bg-white p-6 shadow-sm text-sm text-[#64748b]">
        Loading dispatch hierarchy...
      </div>
    );
  }

  if (!hierarchy) return null;

  const buildings = hierarchy.buildings || [];

  return (
    <div className="rounded-[32px] border border-[#dbe4f0] bg-white p-6 shadow-sm space-y-6">
      {/* Header */}
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-[#64748b]">Step 2 — Dispatch Selection</div>
        <div className="mt-1 text-2xl font-semibold text-[#0f172a]">Choose dispatch sequence</div>
        <div className="mt-1 text-sm text-[#64748b]">
          Select which buildings, floors, and flats to include and set the packing order.
        </div>
      </div>

      {/* Dispatch basis */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b] mb-2">Dispatch basis</div>
        <div className="flex gap-2 flex-wrap">
          {['building', 'floor', 'flat'].map((b) => (
            <ToggleChip
              key={b}
              label={b.charAt(0).toUpperCase() + b.slice(1)}
              selected={basis === b}
              onClick={() => setBasis(b)}
            />
          ))}
        </div>
      </div>

      {/* Buildings */}
      {buildings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Buildings / Pods
            </div>
            <SortToggle value={buildingOrder} onChange={setBuildingOrder} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              label="All"
              selected={selectedBuildings.includes('all')}
              onClick={() => toggleAll(selectedBuildings, setSelectedBuildings, buildings)}
            />
            {buildings.map((b) => (
              <ToggleChip
                key={b}
                label={`Building ${b}`}
                selected={!selectedBuildings.includes('all') && selectedBuildings.includes(b)}
                onClick={() => toggleOne(b, selectedBuildings, setSelectedBuildings)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floors */}
      {availableFloors.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Floors</div>
            <SortToggle value={floorOrder} onChange={setFloorOrder} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              label="All"
              selected={selectedFloors.includes('all')}
              onClick={() => toggleAll(selectedFloors, setSelectedFloors, availableFloors)}
            />
            {availableFloors.map((f) => (
              <ToggleChip
                key={f}
                label={`Floor ${f}`}
                selected={!selectedFloors.includes('all') && selectedFloors.includes(f)}
                onClick={() => toggleOne(f, selectedFloors, setSelectedFloors)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Flats */}
      {availableFlats.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Flats</div>
            <SortToggle value={flatOrder} onChange={setFlatOrder} />
          </div>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
            <ToggleChip
              label="All"
              selected={selectedFlats.includes('all')}
              onClick={() => toggleAll(selectedFlats, setSelectedFlats, availableFlats)}
            />
            {availableFlats.map((fl) => (
              <ToggleChip
                key={fl}
                label={fl}
                selected={!selectedFlats.includes('all') && selectedFlats.includes(fl)}
                onClick={() => toggleOne(fl, selectedFlats, setSelectedFlats)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sequence preview */}
      <div className="rounded-[18px] bg-[#f8fafc] border border-[#e2e8f0] px-4 py-3 text-xs text-[#475569]">
        <span className="font-semibold text-[#0f172a]">Pack order: </span>
        {selectedBuildings.includes('all') ? 'All buildings' : selectedBuildings.join(', ')}
        {' → '}
        {selectedFloors.includes('all') ? 'all floors' : selectedFloors.join(', ')}
        {' → '}
        {selectedFlats.includes('all') ? 'all flats' : selectedFlats.join(', ')}
        {' — '}
        <span className="text-[#1d4ed8]">
          Buildings {buildingOrder}, Floors {floorOrder}, Flats {flatOrder}
        </span>
      </div>

      <button
        type="button"
        disabled={isGenerating}
        onClick={handleGenerate}
        className={`w-full rounded-full bg-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1e40af] ${
          isGenerating ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {isGenerating ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Generating crate plan…
          </span>
        ) : (
          'Generate Crate Plan'
        )}
      </button>
    </div>
  );
};

export default DispatchSelectionPanel;
