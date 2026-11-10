import { describe, it, expect } from 'vitest';
import { fmtDim, layerLabel } from './CratePackingSchedule';

describe('CratePackingSchedule formatting helpers', () => {
  it('formats a piece dimension as length x width x thickness', () => {
    expect(fmtDim({ length: 79, width: 25.5, thickness: '3CM' })).toBe('79.0" × 25.5" × 3CM');
  });

  it('omits thickness when not provided', () => {
    expect(fmtDim({ length: 49, width: 25.5 })).toBe('49.0" × 25.5"');
  });

  it('falls back to an em dash for missing dimensions', () => {
    expect(fmtDim({})).toBe('— × —');
  });

  it('labels the main layer as Countertop', () => {
    expect(layerLabel('main')).toBe('Countertop');
  });

  it('labels numbered splash layers', () => {
    expect(layerLabel('splash_1')).toBe('Splash (layer 1)');
    expect(layerLabel('splash_2')).toBe('Splash (layer 2)');
  });
});
