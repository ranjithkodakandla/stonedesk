# Crate optimization viewer — UI examples

## V2 — Engineering board presentation (current)

Captured from production build: `http://localhost:4173/?crateDemo=1#crate-viewer-demo`

| File | Description |
|------|-------------|
| `v2-engineering-hero-board.png` | Hero isometric crate with **visible parts inside**, embedded metrics spec, dimension arrows |
| `v2-cutaway-section.png` | Engineering section view — per-piece thickness, foam gaps, layer labels |
| `v2-exploded-factory-board.png` | Factory stack board — L1 TOPS → L2 SPACER → L3 BACK SPLASH with part cards |

Dev demo (hot reload): `http://localhost:5175/#crate-viewer-demo`

Production path: **Planner → Step 3 → View Details**

## V1 — Initial Phase 1 (before presentation pass)

| File | Description |
|------|-------------|
| `crate-viewer-engineering.png` | Three-column dashboard layout, small schematic |
| `crate-viewer-exploded-stack.png` | Accordion-style exploded layers |
| `crate-viewer-validation-errors.png` | Validation panel with stack violation |
