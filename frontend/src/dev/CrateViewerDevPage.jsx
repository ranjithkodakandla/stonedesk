/**
 * DEV ONLY — open http://localhost:5173/#crate-viewer-demo for viewer QA / screenshots.
 */
import React, { useState } from 'react';
import CrateOptimizationViewer from '../components/CrateOptimizationViewer';

const MOCK_CRATES = [
  {
    id: 'DC-001',
    crate_class: 'kitchen_vertical',
    part_count: 4,
    total_weight_kg: 1680,
    total_sqft: 42,
    bundles: [
      {
        unit_id: 'fam-k1',
        family_id: 'K-101',
        pieces: [
          { id: 'p1', part: 'Kitchen - Perimeter Tops', part_no: 'KT-01', length: 110, width: 26, thickness: '3CM', weight_kg: 820, sqft: 20, family_id: 'K-101' },
          { id: 'p2', part: 'Kitchen - Back Splash', part_no: 'BS-01', length: 108, width: 4, thickness: '2CM', weight_kg: 180, sqft: 3, family_id: 'K-101' },
          { id: 'p3', part: 'Kitchen - Side Splash', part_no: 'SS-01', length: 26, width: 4, thickness: '2CM', weight_kg: 90, sqft: 1, family_id: 'K-101' },
          { id: 'p4', part: 'Kitchen - Perimeter Tops', part_no: 'KT-02', length: 96, width: 26, thickness: '3CM', weight_kg: 590, sqft: 18, family_id: 'K-101' },
        ],
        part_count: 4,
        total_weight_kg: 1680,
        total_sqft: 42,
      },
    ],
    dimensions: {
      internal_length: 116,
      internal_width: 32,
      internal_height: 8.18,
      external_length: 120,
      external_width: 38,
      external_height: 11.18,
    },
    warnings: [],
  },
  {
    id: 'DC-002',
    crate_class: 'island_vertical',
    part_count: 2,
    total_weight_kg: 1450,
    bundles: [
      {
        unit_id: 'fam-i1',
        family_id: 'I-201',
        pieces: [
          { id: 'i1', part: 'Kitchen - Island Tops', part_no: 'IS-01', length: 110, width: 45, thickness: '2CM', weight_kg: 720, role: 'main' },
          { id: 'i2', part: 'Kitchen - Island Tops', part_no: 'IS-02', length: 108, width: 44, thickness: '2CM', weight_kg: 730, role: 'main' },
        ],
        part_count: 2,
        total_weight_kg: 1450,
      },
    ],
    dimensions: {
      internal_length: 112,
      internal_width: 6.33,
      internal_height: 49.47,
      external_length: 114,
      external_width: 12.33,
      external_height: 62.47,
    },
    warnings: [],
  },
];

export default function CrateViewerDevPage() {
  const [crateId, setCrateId] = useState('DC-001');
  const crate = MOCK_CRATES.find((c) => c.id === crateId) || MOCK_CRATES[0];

  return (
    <div className="min-h-screen bg-slate-200 p-6">
      <div className="mb-4 flex gap-2 items-center">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Dev demo</span>
        {MOCK_CRATES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCrateId(c.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${crateId === c.id ? 'bg-blue-600 text-white' : 'bg-white border'}`}
          >
            {c.id}
          </button>
        ))}
      </div>
      <CrateOptimizationViewer
        crate={crate}
        allCrates={MOCK_CRATES}
        targetWeightKg={1900}
        onApplyPlan={async () => {
          alert('Dev demo — apply blocked (no API)');
          return false;
        }}
      />
    </div>
  );
}
