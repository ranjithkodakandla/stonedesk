// Pure, DOM-free helpers for the 3D crate view's materials: what base color
// and fleck pattern a slab gets from the project's own material/stone_color
// (never an AI-generated image — a deterministic lookup so the same project
// always renders the same way), and where a sink cutout sits on a slab's
// face. Canvas texture drawing (DOM-dependent) lives in Crate3DPacking.jsx
// and consumes these.

// Heuristic base tone from the color NAME — StoneDesk doesn't store an RGB
// value per stone_color (only density, for weight calc), so this is a
// reasonable approximation grouped by the common naming conventions in the
// existing COLOR_DENSITIES tables (backend/app/services/planning_engine.py),
// not a guess per arbitrary name.
export const baseStoneColor = (stoneColor) => {
  const name = String(stoneColor || '').toLowerCase();
  if (/black|absolute|galaxy|noir|zimbabwe/.test(name)) return '#2e2d2f';
  if (/white|ivory|cream|bianco|carrara|colonial|moon|river|kashmir/.test(name)) return '#e9e7e2';
  if (/gold|brown|tan|beige|noce|mahogany|baltic|imperial/.test(name)) return '#b9a079';
  if (/blue|sapphire|vizag/.test(name)) return '#55707f';
  if (/green|butterfly/.test(name)) return '#55705f';
  return '#9a9ca2'; // generic mid gray — unnamed/unknown color
};

// Granite is natural stone: busy, coarse, multi-tone speckle. Quartz is
// engineered: smoother base with fewer, larger veins, not a speckle field.
export const stoneFleckStyle = (material) => {
  const m = String(material || '').toLowerCase();
  if (m === 'quartz') {
    return { speckleDensity: 0.08, speckleCount: 400, veined: true, roughness: 0.25, metalness: 0.05 };
  }
  return { speckleDensity: 0.3, speckleCount: 2200, veined: false, roughness: 0.55, metalness: 0.08 }; // granite (default)
};

export const WOOD_BASE_COLOR = '#b08968';
export const WOOD_GRAIN_COLOR = '#8a6240';

// A sink cutout's rectangle on a slab's face, in inches, with (0,0) at the
// slab's bottom-left corner. Returns null when the piece has no sink (most
// pieces) or is missing the dimensions needed to place one — never invents
// a cutout from thin air.
export const sinkCutoutRect = (piece, standingHeightIn) => {
  if (!piece || piece.sink_type === 'No Sink' || !piece.sink_type) return null;
  const width = Number(piece.sink_length);
  const height = Number(piece.sink_width);
  if (!(width > 0) || !(height > 0)) return null;
  const x = Math.max(0, Number(piece.sink_offset_left) || 0);
  const y = Math.max(0, (standingHeightIn - height) / 2);
  return { x, y, width, height };
};
