import { describe, it, expect } from 'vitest';
import { THICKNESS_INCH, parseThicknessIn, thicknessInchesFromLabel } from './thicknessConstants';
import { parseThicknessIn as fromCratePhysicalLayout } from './cratePhysicalLayout';

describe('thicknessConstants (single source of truth)', () => {
  it('matches the backend THICKNESS_INCHES values for every canonical label', () => {
    // backend/app/services/planning_engine.py THICKNESS_INCHES — kept
    // numerically identical by test_thickness_consistency.py on the backend.
    expect(THICKNESS_INCH['2CM']).toBe(0.79);
    expect(THICKNESS_INCH['3CM']).toBe(1.18);
    expect(THICKNESS_INCH['4CM']).toBe(1.57);
    expect(THICKNESS_INCH['Mixed']).toBe(0.98);
  });

  it('cratePhysicalLayout.js re-exports the same function (no second copy)', () => {
    expect(fromCratePhysicalLayout).toBe(parseThicknessIn);
  });

  it('parseThicknessIn handles labels, unit aliases, and raw numbers consistently', () => {
    expect(parseThicknessIn('2cm')).toBe(0.79);
    expect(parseThicknessIn('4CM')).toBe(1.57);
    expect(parseThicknessIn('')).toBe(THICKNESS_INCH['3CM']);
    expect(parseThicknessIn('1.5')).toBe(1.5);
  });

  it('thicknessInchesFromLabel falls back to 3CM for an unrecognized label', () => {
    expect(thicknessInchesFromLabel('unknown')).toBe(THICKNESS_INCH['3CM']);
  });
});
