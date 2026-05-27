# Crate optimization viewer — architecture

## Viewer architecture

The Step 3 **View Details** experience uses a **single SVG engineering compositor** (`CrateEngineeringCompositor.jsx`), mounted by a thin shell (`CrateOptimizationViewer.jsx`).

All presentation — hero crate, metrics, annotations, insets, and figure modes — lives on one poster canvas. Editing, validation, and persistence remain in the shell and engine layers; they are not part of the compositor.

## Design philosophy

**Engineering poster model, not dashboard UI.**

The viewer should read like a factory specification board: one full-bleed drawing with embedded callouts and a compact control dock. Card columns, KPI widgets, and multi-panel dashboard layouts were intentionally rejected to keep visualization primary and editing secondary.

## Figure system

| Figure | Role |
|--------|------|
| **FIG A** | Main engineering view — isometric open-bay crate, in-crate stack, dimension arrows, bottom insets |
| **FIG B** | Section / cutaway — vertical or depth section with foam gaps and layer labels |
| **FIG C** | Exploded stack — factory build order (L1 → spacer → L3 …) with reorder affordances |

All three figures share the same board background, title band, typography, and embedded metrics panel.

## Rendering principles

- **Leaning supported load (all categories)** — stone leans ~15° into A-frame rear support; pallet base, perimeter foam, bottom foam bed. Nothing stands unsupported.
- **Packing patterns** — island = slab cassette; kitchen = top-centric family bundle; vanity = compact family bundle.
- **Hero crate dominance** — crate occupies ~72–75% of the hero zone; shrink secondary elements first on narrow viewports.
- **Contents inside crate** — parts drawn inside crate geometry with lean contact, not as external lists or flat horizontal layer cakes.
- **Embedded metrics panel** — spec block is SVG-native (monospace, formulas), not a floating React widget.
- **Engineering annotations** — dimension arrows, forklift clearance, load axis, operational callouts.
- **Bottom dock editing** — FIG switch, spacer, collapsed parts editor, Apply / Discard; visualization stays primary.

## Estimator ↔ compositor axis mapping (locked)

All figures consume `preview.dimensions` from `estimateDraftCrateDimensions` — the compositor does not recompute crate math.

| Estimator axis | Physical meaning | Compositor (FIG A isometric) |
|----------------|------------------|------------------------------|
| **L** (`internal_length`) | Long edge on pallet / crate length | Slab span along **x**; pallet length arrows |
| **H** (`internal_height`) | Short edge standing height × cos(15°) + pallet + headroom | Leaning panel **y** height; external height arrows |
| **D** (`internal_width`) | Tops + inter-slab foam + splash depths | **z** depth accumulation (family) or cassette stack (island) |
| **Lean ~15°** | A-frame supported contact | Top of slab shifts +z via `slabH × tan(15°)` |

**Kitchen / vanity:** long edge horizontal; short edge drives load height; splashes add depth behind tops.  
**Island:** unchanged cassette model — depth-stacked slabs leaning into rear support with poly film between faces.

FIG B family section shows a **leaning depth section** (not a horizontal layer cake). FIG C is labeled **sequence view — not physical elevation**.

## Why dashboard/card layout was avoided

Earlier iterations used three-column cards and accordion stacks. That pattern pulled attention away from the crate, duplicated metrics in widget form, and invited SaaS-style UI drift. The compositor approach locks presentation to one visual system and keeps logic out of the renderer.

**Do not reintroduce dashboard layouts without an explicit product decision.**
