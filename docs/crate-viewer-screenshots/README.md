# Crate optimization viewer — UI examples

## V3 — Single SVG engineering poster compositor (current)

Captured from production build: `http://localhost:4173/?crateDemo=1#crate-viewer-demo`

| File | Description |
|------|-------------|
| `v3-fig-a-main-board.png` | **FIG A** — Hero isometric crate (~72% zone), parts inside geometry, dense dim arrows, embedded spec panel, bottom insets |
| `v3-fig-b-section.png` | **FIG B** — Vertical stack section with foam hatching, part labels on surfaces, layer tags |
| `v3-fig-c-exploded.png` | **FIG C** — Exploded factory stack L1→L5 with spacer bands and reorder affordances |
| `v3-comparison-old-dashboard-vs-poster.png` | Side-by-side: v1 dashboard vs v3 poster compositor |

Dev demo (hot reload): `http://localhost:5173/#crate-viewer-demo`  
Screenshot script: `frontend/scripts/capture-crate-screenshots.mjs` (requires preview on :4173)

Production path: **Planner → Step 3 → View Details**

## V2 — Engineering board presentation (superseded)

| File | Description |
|------|-------------|
| `v2-engineering-hero-board.png` | Hero isometric crate with visible parts inside, embedded metrics spec, dimension arrows |
| `v2-cutaway-section.png` | Engineering section view — per-piece thickness, foam gaps, layer labels |
| `v2-exploded-factory-board.png` | Factory stack board — L1 TOPS → L2 SPACER → L3 BACK SPLASH with part cards |

## V1 — Initial Phase 1 (before presentation pass)

| File | Description |
|------|-------------|
| `crate-viewer-engineering.png` | Three-column dashboard layout, small schematic |
| `crate-viewer-exploded-stack.png` | Accordion-style exploded layers |
| `crate-viewer-validation-errors.png` | Validation panel with stack violation |
