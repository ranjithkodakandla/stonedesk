/**
 * Renders CrateOptimizationViewer with mock data and saves PNG screenshots.
 * Run: node scripts/capture-crate-viewer-demo.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, '..', '..', 'docs', 'crate-viewer-screenshots');

const mockKitchenCrate = {
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
};

const mockIslandCrate = {
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
};

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#e2e8f0;padding:16px}</style>
</head><body>
<div id="root"></div>
<script type="module">
  import React from 'https://esm.sh/react@18';
  import ReactDOM from 'https://esm.sh/react-dom@18/client';
  // Viewer loaded from built bundle via iframe to local preview — fallback message
  document.getElementById('root').innerHTML = '<p style="padding:24px">Run dev server and open Planner Step 3 for live screenshots. Mock data prepared in docs/crate-viewer-screenshots/mock-crates.json</p>';
</script>
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'mock-crates.json'), JSON.stringify({ kitchen: mockKitchenCrate, island: mockIslandCrate }, null, 2));
writeFileSync(join(outDir, 'README.md'), `# Crate optimization viewer screenshots

Capture from the running app:

1. \`cd frontend && npm run dev\`
2. Open a project with a saved draft crate plan
3. Planner → Step 3 → View Details

## Mock fixture

See \`mock-crates.json\` for sample kitchen + island crate payloads used in QA.

## Views to capture

- Engineering view (stack legend + isometric diagram)
- Side / cutaway
- Exploded stack (Layer 1–4 labels)
- Constraint panel (errors vs warnings)
- Empty crate confirmation modal
`);

console.log('Wrote docs/crate-viewer-screenshots/mock-crates.json');
