// Single source of truth for thickness-label -> inches, shared by every
// frontend crate/weight calculation. Previously duplicated independently in
// crateEstimator.js, cratePhysicalLayout.js and CrateFilterPlanner.jsx, which
// had drifted: all three had a "4CM" entry the backend
// (planning_engine.THICKNESS_INCHES) lacked, so a piece ever reaching the
// backend with thickness "4CM" would silently fall back to the "Mixed"
// factor there (~60% off) while the frontend displayed the correct value —
// see backend/app/services/planning_engine.py's matching THICKNESS_INCHES,
// which must be kept numerically identical to this table.
export const THICKNESS_INCH = {
  '2CM': 0.79,
  '3CM': 1.18,
  '4CM': 1.57,
  '2.0CM': 0.79,
  '3.0CM': 1.18,
  Mixed: 0.98,
};

export const DEFAULT_THICKNESS_IN = THICKNESS_INCH.Mixed;

// Looks up a thickness label (case/space-insensitive) or, failing that,
// parses a raw numeric string. Falls back to the 3CM value (not Mixed) to
// match the pre-existing behavior of cratePhysicalLayout's parseThicknessIn.
export function parseThicknessIn(t, fallback = THICKNESS_INCH['3CM']) {
  if (!t) return fallback;
  const key = String(t).trim().toUpperCase().replace(' ', '');
  if (THICKNESS_INCH[key] != null) return THICKNESS_INCH[key];
  if (THICKNESS_INCH[String(t).trim()] != null) return THICKNESS_INCH[String(t).trim()];
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : fallback;
}

// Simple label-normalization lookup (no raw-number fallback), matching
// CrateFilterPlanner's and crateEstimator's prior thicknessInches() shape.
export function thicknessInchesFromLabel(t, fallback = THICKNESS_INCH['3CM']) {
  const key = String(t || '').trim().toUpperCase().replace(' ', '');
  return THICKNESS_INCH[key] ?? fallback;
}
