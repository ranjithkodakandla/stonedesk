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
      internal_width: 10.94,
      internal_height: 35.12,
      external_length: 120,
      external_width: 16.94,
      external_height: 48.12,
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
  {
    id: 'DC-003',
    crate_class: 'vanity_vertical',
    part_count: 3,
    total_weight_kg: 920,
    bundles: [
      {
        unit_id: 'fam-v1',
        family_id: 'V-301',
        pieces: [
          { id: 'v1', part: 'Vanity - Top', part_no: 'VT-01', length: 72, width: 22, thickness: '3CM', weight_kg: 680, family_id: 'V-301' },
          { id: 'v2', part: 'Vanity - Back Splash', part_no: 'VBS-01', length: 70, width: 4, thickness: '2CM', weight_kg: 140, family_id: 'V-301' },
          { id: 'v3', part: 'Vanity - Side Splash', part_no: 'VSS-01', length: 22, width: 4, thickness: '2CM', weight_kg: 100, family_id: 'V-301' },
        ],
        part_count: 3,
        total_weight_kg: 920,
      },
    ],
    dimensions: {
      internal_length: 78,
      internal_width: 8.75,
      internal_height: 31.25,
      external_length: 82,
      external_width: 14.75,
      external_height: 44.25,
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
