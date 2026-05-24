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

- **Hero crate dominance** — crate occupies ~72–75% of the hero zone; shrink secondary elements first on narrow viewports.
- **Contents inside crate** — kitchen/vanity flat-lay and island vertical slabs are drawn inside crate geometry, not as external lists.
- **Embedded metrics panel** — spec block is SVG-native (monospace, formulas), not a floating React widget.
- **Engineering annotations** — dimension arrows, forklift clearance, load axis, operational callouts.
- **Bottom dock editing** — FIG switch, spacer, collapsed parts editor, Apply / Discard; visualization stays primary.

## Why dashboard/card layout was avoided

Earlier iterations used three-column cards and accordion stacks. That pattern pulled attention away from the crate, duplicated metrics in widget form, and invited SaaS-style UI drift. The compositor approach locks presentation to one visual system and keeps logic out of the renderer.

**Do not reintroduce dashboard layouts without an explicit product decision.**
